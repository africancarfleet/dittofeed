import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import {
  CompletionStatus,
  GenerateJourneyErrorResponse,
  GenerateJourneyErrorTypeEnum,
  GenerateJourneyResponse,
} from "isomorphic-lib/src/types";

import { useAppStorePick } from "./appStore";
import { useAuthHeaders, useBaseApiUrl } from "./authModeProvider";

export interface GenerateJourneyInput {
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

function errorMessageFromResponse(
  data: GenerateJourneyErrorResponse | undefined,
): string {
  if (!data) {
    return "Failed to generate journey.";
  }
  if (
    data.type === GenerateJourneyErrorTypeEnum.UnknownReference &&
    ((data.unknownTemplateIds?.length ?? 0) > 0 ||
      (data.unknownSegmentIds?.length ?? 0) > 0)
  ) {
    return `${data.message} Try creating the required templates or segments first.`;
  }
  return data.message;
}

// Mutation hook for generating a draft journey from a natural language prompt.
export function useGenerateJourneyMutation() {
  const { workspace } = useAppStorePick(["workspace"]);
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();

  const mutationFn = async (
    input: GenerateJourneyInput,
  ): Promise<GenerateJourneyResponse> => {
    if (workspace.type !== CompletionStatus.Successful) {
      throw new Error("Workspace not available");
    }
    try {
      const response = await axios.post<GenerateJourneyResponse>(
        `${baseApiUrl}/ai/journeys/generate`,
        {
          workspaceId: workspace.value.id,
          prompt: input.prompt,
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens,
        },
        { headers: authHeaders },
      );
      return response.data;
    } catch (e) {
      if (axios.isAxiosError<GenerateJourneyErrorResponse>(e)) {
        throw new Error(errorMessageFromResponse(e.response?.data));
      }
      throw e instanceof Error ? e : new Error("Failed to generate journey.");
    }
  };

  return useMutation<GenerateJourneyResponse, Error, GenerateJourneyInput>({
    mutationFn,
  });
}
