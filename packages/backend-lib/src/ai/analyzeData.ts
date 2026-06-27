import { generateText, stepCountIs, tool } from "ai";
import { eq } from "drizzle-orm";
import {
  AnalyzeDataErrorTypeEnum,
  ChannelType,
} from "isomorphic-lib/src/types";
import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { getChartData, getSummarizedData } from "../analysis";
import * as schema from "../db/schema";
import { searchDeliveries, searchDeliveriesCount } from "../deliveries";
import { findManyJourneyResourcesUnsafe } from "../journeys";
import logger from "../logger";
import { findMessageTemplates } from "../messaging";
import { findManyPartialSegments } from "../segments";
import { findAllUserProperties } from "../userProperties";
import { getUsers, getUsersCount } from "../users";
import { getLanguageModel, LlmConfigError } from "./provider";
import { getWorkspaceLlmConfig } from "./settings";

export { AnalyzeDataErrorTypeEnum as AnalyzeDataErrorType };

export interface AnalyzeDataError {
  type: AnalyzeDataErrorTypeEnum;
  message: string;
}

export interface AnalysisChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnalyzeDataParams {
  workspaceId: string;
  messages: AnalysisChatMessage[];
  // Current time (ISO), so the model can resolve relative dates like "last week".
  now: string;
}

export interface AnalyzeDataResult {
  text: string;
  toolsUsed: string[];
}

// Bounds the agent loop so a single question can't run away on tool calls / cost.
const MAX_STEPS = 8;

const channelSchema = z.enum(["Email", "Sms", "MobilePush", "Webhook"]);

function toChannelType(value: string): ChannelType | undefined {
  return Object.values(ChannelType).find((c) => c === value);
}

function toChannelTypes(values?: string[]): ChannelType[] | undefined {
  if (!values) {
    return undefined;
  }
  return values
    .map(toChannelType)
    .filter((c): c is ChannelType => c !== undefined);
}

function buildSystemPrompt(now: string): string {
  return [
    "You are a data analyst embedded in Dittofeed, an omni-channel customer",
    "engagement platform. Help the user understand their messaging performance",
    "and audience by calling the provided tools to fetch real numbers.",
    "",
    `The current date/time is ${now}. Resolve relative dates (e.g. "last week")`,
    "against it and pass absolute ISO dates to tools.",
    "",
    "Guidelines:",
    "- Never invent numbers. Only state figures returned by tools.",
    "- Resolve names to ids with the list_* tools before filtering by id.",
    "- For questions about a specific user: if given an internal user id use",
    "  get_user; if given an attribute like an email, first call",
    "  list_user_properties to get the property id, then find_users to locate",
    "  them, then get_user / get_user_deliveries for detail.",
    "- Be concise: lead with the answer, then the supporting figures.",
    "- If the data is empty or a tool errors, say so plainly.",
    "- You cannot modify anything; these tools are read-only.",
  ].join("\n");
}

function buildTools(workspaceId: string) {
  return {
    list_journeys: tool({
      description: "List the workspace's journeys (id, name, status).",
      inputSchema: z.object({}),
      execute: async () => {
        const journeys = await findManyJourneyResourcesUnsafe(
          eq(schema.journey.workspaceId, workspaceId),
        );
        return journeys.map((j) => ({
          id: j.id,
          name: j.name,
          status: j.status,
        }));
      },
    }),
    list_templates: tool({
      description:
        "List the workspace's message templates (id, name, channel).",
      inputSchema: z.object({}),
      execute: async () => {
        const templates = await findMessageTemplates({ workspaceId });
        return templates.map((t) => ({
          id: t.id,
          name: t.name,
          channel: t.type,
        }));
      },
    }),
    list_segments: tool({
      description: "List the workspace's segments (id, name).",
      inputSchema: z.object({}),
      execute: async () => {
        const segments = await findManyPartialSegments({ workspaceId });
        return segments.map((s) => ({ id: s.id, name: s.name }));
      },
    }),
    list_user_properties: tool({
      description: "List the workspace's user properties (id, name).",
      inputSchema: z.object({}),
      execute: async () => {
        const properties = await findAllUserProperties({ workspaceId });
        return properties.map((p) => ({ id: p.id, name: p.name }));
      },
    }),
    count_users: tool({
      description:
        "Count users in the workspace, optionally restricted to a segment.",
      inputSchema: z.object({
        segmentId: z
          .string()
          .optional()
          .describe("Restrict the count to members of this segment id."),
      }),
      execute: async ({ segmentId }) => {
        const result = await getUsersCount({
          workspaceId,
          segmentFilter: segmentId ? [segmentId] : undefined,
        });
        if (result.isErr()) {
          return { error: result.error.message };
        }
        return { userCount: result.value.userCount };
      },
    }),
    get_message_summary: tool({
      description:
        "Get aggregate message stats (sent, deliveries, opens, clicks, bounces) over a date range, with optional filters.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive ISO start date."),
        endDate: z.string().describe("Inclusive ISO end date."),
        journeyIds: z.array(z.string()).optional(),
        broadcastIds: z.array(z.string()).optional(),
        templateIds: z.array(z.string()).optional(),
        channel: channelSchema.optional(),
        providers: z.array(z.string()).optional(),
      }),
      execute: async ({
        startDate,
        endDate,
        journeyIds,
        broadcastIds,
        templateIds,
        channel,
        providers,
      }) => {
        const response = await getSummarizedData({
          workspaceId,
          startDate,
          endDate,
          filters: {
            journeyIds,
            broadcastIds,
            templateIds,
            channel: channel ? toChannelType(channel) : undefined,
            providers,
          },
        });
        return response.summary;
      },
    }),
    get_message_timeseries: tool({
      description:
        "Get a time series of a message metric over a date range, optionally grouped (e.g. by journey or channel).",
      inputSchema: z.object({
        startDate: z.string(),
        endDate: z.string(),
        granularity: z
          .enum(["1hour", "6hours", "12hours", "1day", "7days", "30days"])
          .optional(),
        groupBy: z
          .enum([
            "journey",
            "broadcast",
            "messageTemplate",
            "channel",
            "provider",
            "messageState",
          ])
          .optional(),
        journeyIds: z.array(z.string()).optional(),
        broadcastIds: z.array(z.string()).optional(),
        templateIds: z.array(z.string()).optional(),
        channels: z.array(channelSchema).optional(),
      }),
      execute: async ({
        startDate,
        endDate,
        granularity,
        groupBy,
        journeyIds,
        broadcastIds,
        templateIds,
        channels,
      }) => {
        const response = await getChartData({
          workspaceId,
          startDate,
          endDate,
          granularity: granularity ?? "1day",
          groupBy,
          filters: {
            journeyIds,
            broadcastIds,
            templateIds,
            channels: toChannelTypes(channels),
          },
        });
        // Cap the number of points returned to keep token usage bounded.
        return {
          granularity: response.granularity,
          truncated: response.data.length > 200,
          data: response.data.slice(0, 200),
        };
      },
    }),
    count_deliveries: tool({
      description:
        "Count individual message deliveries matching filters (e.g. how many bounced for a journey).",
      inputSchema: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        journeyId: z.string().optional(),
        broadcastId: z.string().optional(),
        templateIds: z.array(z.string()).optional(),
        channels: z.array(channelSchema).optional(),
        statuses: z.array(z.string()).optional(),
      }),
      execute: async ({
        startDate,
        endDate,
        journeyId,
        broadcastId,
        templateIds,
        channels,
        statuses,
      }) => {
        const count = await searchDeliveriesCount({
          workspaceId,
          startDate,
          endDate,
          journeyId,
          broadcastId,
          templateIds,
          channels: toChannelTypes(channels),
          statuses,
        });
        return { count };
      },
    }),
    get_user: tool({
      description:
        "Look up a single user by id: their user properties, segment memberships, and subscriptions.",
      inputSchema: z.object({
        userId: z.string().describe("The internal user id."),
      }),
      execute: async ({ userId }) => {
        const result = await getUsers({
          workspaceId,
          userIds: [userId],
          includeSubscriptions: true,
          limit: 1,
        });
        if (result.isErr()) {
          return { error: result.error.message };
        }
        const user = result.value.users[0];
        if (!user) {
          return { found: false };
        }
        return { found: true, user };
      },
    }),
    find_users: tool({
      description:
        "Find users by a user-property value and/or segment membership. To search by a known attribute like email, first call list_user_properties to get the propertyId.",
      inputSchema: z.object({
        propertyId: z
          .string()
          .optional()
          .describe(
            "Id of the user property to match (from list_user_properties).",
          ),
        values: z
          .array(z.string())
          .optional()
          .describe("Accepted values for the property."),
        segmentId: z.string().optional(),
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ propertyId, values, segmentId, limit }) => {
        const result = await getUsers({
          workspaceId,
          userPropertyFilter:
            propertyId && values ? [{ id: propertyId, values }] : undefined,
          segmentFilter: segmentId ? [segmentId] : undefined,
          limit: limit ?? 10,
        });
        if (result.isErr()) {
          return { error: result.error.message };
        }
        return { users: result.value.users };
      },
    }),
    get_user_deliveries: tool({
      description: "List recent message deliveries sent to a specific user.",
      inputSchema: z.object({
        userId: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ userId, limit }) => {
        const response = await searchDeliveries({
          workspaceId,
          userId,
          limit: limit ?? 20,
        });
        return {
          items: response.items.map((d) => ({
            sentAt: d.sentAt,
            status: d.status,
            channel: "variant" in d ? d.variant.type : undefined,
            templateId: d.templateId,
            journeyId: d.journeyId,
            broadcastId: d.broadcastId,
          })),
        };
      },
    }),
  };
}

/**
 * Answers a natural-language question about a workspace's data by letting the
 * LLM call read-only analytics tools. `workspaceId` is injected into every tool
 * server-side, so the model can never read another workspace's data. Stateless:
 * the caller passes the full conversation history each turn.
 */
export async function analyzeData({
  workspaceId,
  messages,
  now,
}: AnalyzeDataParams): Promise<Result<AnalyzeDataResult, AnalyzeDataError>> {
  const llmConfig = await getWorkspaceLlmConfig(workspaceId);

  let model;
  try {
    model = getLanguageModel({
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
    });
  } catch (e) {
    if (e instanceof LlmConfigError) {
      return err({ type: AnalyzeDataErrorTypeEnum.Config, message: e.message });
    }
    throw e;
  }

  try {
    const result = await generateText({
      model,
      system: buildSystemPrompt(now),
      messages,
      tools: buildTools(workspaceId),
      stopWhen: stepCountIs(MAX_STEPS),
      temperature: llmConfig.temperature,
    });

    const toolsUsed = Array.from(
      new Set(
        result.steps.flatMap((step) =>
          step.toolCalls.map((call) => call.toolName),
        ),
      ),
    );

    return ok({ text: result.text, toolsUsed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown analysis error";
    logger().error({ err: e, workspaceId }, "AI data analysis failed");
    return err({ type: AnalyzeDataErrorTypeEnum.Generation, message });
  }
}
