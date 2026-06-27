import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import {
  AnalysisChatMessage,
  AnalyzeDataErrorResponse,
  AnalyzeDataErrorTypeEnum,
  AnalyzeDataResponse,
  CompletionStatus,
} from "isomorphic-lib/src/types";

import { useAppStorePick } from "./appStore";
import { useAuthHeaders, useBaseApiUrl } from "./authModeProvider";

function errorMessage(data: AnalyzeDataErrorResponse | undefined): string {
  if (!data) {
    return "Failed to get an answer.";
  }
  if (data.type === AnalyzeDataErrorTypeEnum.Config) {
    return "AI is not configured. Set an API key in Settings → AI.";
  }
  return data.message;
}

// Sends the full conversation history each turn (the server is stateless).
export function useAnalysisChatMutation() {
  const { workspace } = useAppStorePick(["workspace"]);
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();

  return useMutation<AnalyzeDataResponse, Error, AnalysisChatMessage[]>({
    mutationFn: async (messages) => {
      if (workspace.type !== CompletionStatus.Successful) {
        throw new Error("Workspace not available");
      }
      try {
        const response = await axios.post<AnalyzeDataResponse>(
          `${baseApiUrl}/ai/analysis/chat`,
          { workspaceId: workspace.value.id, messages },
          { headers: authHeaders },
        );
        return response.data;
      } catch (e) {
        if (axios.isAxiosError<AnalyzeDataErrorResponse>(e)) {
          throw new Error(errorMessage(e.response?.data));
        }
        throw e instanceof Error ? e : new Error("Failed to get an answer.");
      }
    },
  });
}
