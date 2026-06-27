import { generateObject } from "ai";
import { schemaValidateWithErr } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { GenerateJourneyErrorTypeEnum } from "isomorphic-lib/src/types";
import { err, ok, Result } from "neverthrow";

import logger from "../logger";
import { findMessageTemplates } from "../messaging";
import { findManyPartialSegments } from "../segments";
import { JourneyDefinition } from "../types";
import { compileJourneyPlan } from "./compileJourneyPlan";
import {
  JourneyAiPlan,
  journeyAiPlanSchema,
  looseJourneyPlanSchema,
  normalizeLoosePlan,
  PlanChannel,
  planChannelFromString,
} from "./journeyPlan";
import { getLanguageModel, LlmConfigError } from "./provider";
import { getWorkspaceLlmConfig } from "./settings";

export { GenerateJourneyErrorTypeEnum as GenerateJourneyErrorType };

export interface GenerateJourneyError {
  type: GenerateJourneyErrorTypeEnum;
  message: string;
  // Ids the model referenced that do not exist in the workspace.
  unknownSegmentIds?: string[];
  unknownTemplateIds?: string[];
}

export interface GenerateJourneyConfig {
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateJourneyParams {
  workspaceId: string;
  prompt: string;
  config?: GenerateJourneyConfig;
}

export interface GenerateJourneyResult {
  name: string;
  definition: JourneyDefinition;
}

function buildSystemPrompt({
  segments,
  templates,
}: {
  segments: { id: string; name: string }[];
  templates: { id: string; name: string; type: string }[];
}): string {
  const segmentLines = segments.length
    ? segments.map((s) => `- ${s.name} (id: ${s.id})`).join("\n")
    : "(none)";
  const templateLines = templates.length
    ? templates.map((t) => `- ${t.name} [${t.type}] (id: ${t.id})`).join("\n")
    : "(none)";

  return [
    "You are an expert marketing automation specialist for Dittofeed, an",
    "omni-channel customer engagement platform. Translate the user's request",
    "into a journey plan, following the output schema EXACTLY.",
    "",
    "Schema rules (use these exact field names and values):",
    '- entry.kind must be exactly "segment" or "event".',
    '  - When "segment", set entry.segmentId to an existing segment id.',
    '  - When "event", set entry.event to the event name (optionally entry.key).',
    "- steps is a flat, ordered list. Each step's type must be exactly one of:",
    '  "message", "delay", "waitForSegment". Do NOT nest steps.',
    "  - message: set templateId (an existing template id). The channel is",
    "    inferred from the template, so you do not need to set it.",
    "  - delay: set seconds to a positive integer (e.g. 3 days = 259200). Only",
    "    set seconds.",
    "  - waitForSegment: set segmentId and a positive timeoutSeconds. Only set",
    "    those two.",
    "- Do not populate fields that do not belong to a step's type.",
    "",
    "Content rules:",
    "- Only reference segments and message templates that exist below, using",
    "  their exact id. Never invent ids.",
    "- A message step's channel MUST match the referenced template's channel.",
    "- Prefer a segment entry when the user describes an audience; use an event",
    "  entry only when entry is clearly triggered by a specific event.",
    "- Use waitForSegment only with a segment entry, never with an event entry.",
    "",
    "Available segments:",
    segmentLines,
    "",
    "Available message templates:",
    templateLines,
  ].join("\n");
}

function collectReferences(plan: JourneyAiPlan): {
  segmentIds: Set<string>;
  templateIds: Set<string>;
} {
  const segmentIds = new Set<string>();
  const templateIds = new Set<string>();

  if (plan.entry.type === "segment") {
    segmentIds.add(plan.entry.segmentId);
  }

  const visitLeaf = (step: {
    type: string;
    templateId?: string;
    segmentId?: string;
  }) => {
    if (step.type === "message" && step.templateId) {
      templateIds.add(step.templateId);
    }
    if (step.type === "waitForSegment" && step.segmentId) {
      segmentIds.add(step.segmentId);
    }
  };

  for (const step of plan.steps) {
    if (step.type === "segmentSplit") {
      segmentIds.add(step.segmentId);
      step.trueSteps.forEach(visitLeaf);
      step.falseSteps.forEach(visitLeaf);
    } else {
      visitLeaf(step);
    }
  }

  return { segmentIds, templateIds };
}

/**
 * Generates a journey definition from a natural language prompt. Grounds the
 * model on the workspace's real segments and templates, produces a plan via
 * structured output, validates that every referenced id exists, then compiles
 * and validates the canonical definition. Does not persist anything — the
 * caller decides whether to save it (e.g. as a draft for user review).
 */
export async function generateJourneyFromPrompt({
  workspaceId,
  prompt,
  config: genConfig,
}: GenerateJourneyParams): Promise<
  Result<GenerateJourneyResult, GenerateJourneyError>
> {
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
      return err({
        type: GenerateJourneyErrorTypeEnum.Config,
        message: e.message,
      });
    }
    throw e;
  }

  const [segments, templates] = await Promise.all([
    findManyPartialSegments({ workspaceId }),
    findMessageTemplates({ workspaceId }),
  ]);

  const groundingSegments = segments.map((s) => ({ id: s.id, name: s.name }));
  const groundingTemplates = templates.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
  }));

  let plan: JourneyAiPlan;
  try {
    const { object } = await generateObject({
      model,
      schema: looseJourneyPlanSchema,
      schemaName: "JourneyPlan",
      schemaDescription: "A plan describing a Dittofeed user journey.",
      system: buildSystemPrompt({
        segments: groundingSegments,
        templates: groundingTemplates,
      }),
      prompt,
      temperature: genConfig?.temperature ?? llmConfig.temperature,
      maxOutputTokens: genConfig?.maxOutputTokens ?? llmConfig.maxOutputTokens,
    });
    const templateChannels = new Map<string, PlanChannel>();
    for (const t of templates) {
      const channel = planChannelFromString(String(t.type));
      if (channel) {
        templateChannels.set(t.id, channel);
      }
    }
    plan = normalizeLoosePlan(object, { templateChannels });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown generation error";
    logger().error({ err: e, workspaceId }, "AI journey generation failed");
    return err({ type: GenerateJourneyErrorTypeEnum.Generation, message });
  }

  // Defense in depth: the normalized plan must satisfy the strict schema.
  const planValidation = journeyAiPlanSchema.safeParse(plan);
  if (!planValidation.success) {
    logger().error(
      { err: planValidation.error, plan, workspaceId },
      "Normalized AI journey plan failed validation",
    );
    return err({
      type: GenerateJourneyErrorTypeEnum.Generation,
      message: "The model produced a plan that could not be interpreted.",
    });
  }

  // Reject any hallucinated references before compiling.
  const { segmentIds, templateIds } = collectReferences(plan);
  const knownSegmentIds = new Set(segments.map((s) => s.id));
  const knownTemplateIds = new Set(templates.map((t) => t.id));
  const unknownSegmentIds = [...segmentIds].filter(
    (id) => !knownSegmentIds.has(id),
  );
  const unknownTemplateIds = [...templateIds].filter(
    (id) => !knownTemplateIds.has(id),
  );
  if (unknownSegmentIds.length > 0 || unknownTemplateIds.length > 0) {
    return err({
      type: GenerateJourneyErrorTypeEnum.UnknownReference,
      message:
        "The generated journey referenced resources that do not exist in this workspace.",
      unknownSegmentIds,
      unknownTemplateIds,
    });
  }

  const definition = compileJourneyPlan(plan);

  const validated = schemaValidateWithErr(definition, JourneyDefinition);
  if (validated.isErr()) {
    logger().error(
      { err: validated.error, definition, workspaceId },
      "Compiled AI journey failed schema validation",
    );
    return err({
      type: GenerateJourneyErrorTypeEnum.Validation,
      message: validated.error.message,
    });
  }

  return ok({ name: plan.name, definition: validated.value });
}
