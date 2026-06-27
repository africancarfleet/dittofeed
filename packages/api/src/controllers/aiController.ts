import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { generateJourneyFromPrompt } from "backend-lib/src/ai/generateJourney";
import {
  getLlmSettingsView,
  upsertLlmSettings,
} from "backend-lib/src/ai/settings";
import {
  EmptyResponse,
  GenerateJourneyErrorResponse,
  GenerateJourneyErrorTypeEnum,
  GenerateJourneyRequest,
  GenerateJourneyResponse,
  GetLlmSettingsRequest,
  LlmSettingsResource,
  UpsertLlmSettingsRequest,
} from "backend-lib/src/types";
import { FastifyInstance } from "fastify";

// eslint-disable-next-line @typescript-eslint/require-await
export default async function aiController(fastify: FastifyInstance) {
  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/settings",
    {
      schema: {
        description:
          "Get a workspace's LLM settings (never returns the API key itself).",
        tags: ["AI"],
        querystring: GetLlmSettingsRequest,
        response: {
          200: LlmSettingsResource,
        },
      },
    },
    async (request, reply) => {
      const view = await getLlmSettingsView(request.query.workspaceId);
      return reply.status(200).send(view);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/settings",
    {
      schema: {
        description:
          "Create or update a workspace's LLM settings. Omit apiKey to keep the existing key; pass null to clear it.",
        tags: ["AI"],
        body: UpsertLlmSettingsRequest,
        response: {
          204: EmptyResponse,
        },
      },
    },
    async (request, reply) => {
      await upsertLlmSettings(request.body);
      return reply.status(204).send();
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/journeys/generate",
    {
      schema: {
        description:
          "Generate a draft journey definition from a natural language prompt. Does not persist the journey.",
        tags: ["AI"],
        body: GenerateJourneyRequest,
        response: {
          200: GenerateJourneyResponse,
          400: GenerateJourneyErrorResponse,
          503: GenerateJourneyErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, prompt, temperature, maxOutputTokens } =
        request.body;

      const result = await generateJourneyFromPrompt({
        workspaceId,
        prompt,
        config: { temperature, maxOutputTokens },
      });

      if (result.isErr()) {
        const { error } = result;
        // A missing/invalid LLM configuration is a server-side condition.
        const status =
          error.type === GenerateJourneyErrorTypeEnum.Config ? 503 : 400;
        return reply.status(status).send({
          type: error.type,
          message: error.message,
          unknownSegmentIds: error.unknownSegmentIds,
          unknownTemplateIds: error.unknownTemplateIds,
        });
      }

      return reply.status(200).send(result.value);
    },
  );
}
