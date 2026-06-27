import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import axios from "axios";
import {
  CompletionStatus,
  LlmSettingsResource,
  UpsertLlmSettingsRequest,
} from "isomorphic-lib/src/types";

import { useAppStorePick } from "./appStore";
import { useAuthHeaders, useBaseApiUrl } from "./authModeProvider";

const LLM_SETTINGS_QUERY_KEY = "llmSettings";

export function useLlmSettingsQuery(): UseQueryResult<LlmSettingsResource> {
  const { workspace } = useAppStorePick(["workspace"]);
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();
  const workspaceId =
    workspace.type === CompletionStatus.Successful ? workspace.value.id : null;

  return useQuery<LlmSettingsResource>({
    queryKey: [LLM_SETTINGS_QUERY_KEY, { workspaceId }],
    enabled: workspaceId !== null,
    queryFn: async () => {
      const response = await axios.get<LlmSettingsResource>(
        `${baseApiUrl}/ai/settings`,
        { params: { workspaceId }, headers: authHeaders },
      );
      return response.data;
    },
  });
}

export type UpsertLlmSettingsInput = Omit<
  UpsertLlmSettingsRequest,
  "workspaceId"
>;

export function useUpsertLlmSettingsMutation() {
  const { workspace } = useAppStorePick(["workspace"]);
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (update: UpsertLlmSettingsInput): Promise<void> => {
      if (workspace.type !== CompletionStatus.Successful) {
        throw new Error("Workspace not available");
      }
      await axios.put(
        `${baseApiUrl}/ai/settings`,
        { ...update, workspaceId: workspace.value.id },
        { headers: authHeaders },
      );
    },
    onSettled: () => {
      if (workspace.type !== CompletionStatus.Successful) {
        return;
      }
      queryClient.invalidateQueries({
        queryKey: [LLM_SETTINGS_QUERY_KEY, { workspaceId: workspace.value.id }],
      });
    },
  });
}
