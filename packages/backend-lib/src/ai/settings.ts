import { and, eq } from "drizzle-orm";
import { isObject } from "isomorphic-lib/src/objects";

import config from "../config";
import { db, upsert } from "../db";
import * as schema from "../db/schema";
import { isLlmProvider, LlmProviderName } from "./provider";

// Name of the per-workspace Secret row that stores LLM configuration. The
// `value` column holds the API key; `configValue` holds the non-secret settings.
export const LLM_CONFIG_SECRET_NAME = "llm-config";

interface StoredLlmConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ResolvedLlmConfig {
  provider: string;
  apiKey?: string;
  model?: string;
  temperature: number;
  maxOutputTokens: number;
}

export type LlmConfigSource = "workspace" | "environment" | "none";

export interface LlmSettingsView {
  provider: LlmProviderName;
  model?: string;
  temperature: number;
  maxOutputTokens: number;
  // Whether an API key is available (from workspace or environment).
  hasApiKey: boolean;
  apiKeySource: LlmConfigSource;
  // Whether non-secret settings come from a stored workspace override.
  settingsSource: Exclude<LlmConfigSource, "none">;
}

function parseStoredConfig(value: unknown): StoredLlmConfig {
  if (!isObject(value)) {
    return {};
  }
  const stored: StoredLlmConfig = {};
  if (typeof value.provider === "string" && isLlmProvider(value.provider)) {
    stored.provider = value.provider;
  }
  if (typeof value.model === "string" && value.model.length > 0) {
    stored.model = value.model;
  }
  if (typeof value.temperature === "number") {
    stored.temperature = value.temperature;
  }
  if (typeof value.maxOutputTokens === "number") {
    stored.maxOutputTokens = value.maxOutputTokens;
  }
  return stored;
}

async function readWorkspaceSecret(workspaceId: string): Promise<{
  stored: StoredLlmConfig;
  apiKey?: string;
  hasRow: boolean;
}> {
  const secret = await db().query.secret.findFirst({
    where: and(
      eq(schema.secret.workspaceId, workspaceId),
      eq(schema.secret.name, LLM_CONFIG_SECRET_NAME),
    ),
  });
  return {
    stored: parseStoredConfig(secret?.configValue),
    apiKey: secret?.value ?? undefined,
    hasRow: Boolean(secret),
  };
}

/**
 * Resolves the effective LLM config for a workspace: stored per-workspace
 * settings take precedence, falling back to the instance-wide environment
 * configuration for any field that is not overridden.
 */
export async function getWorkspaceLlmConfig(
  workspaceId: string,
): Promise<ResolvedLlmConfig> {
  const c = config();
  const { stored, apiKey } = await readWorkspaceSecret(workspaceId);
  return {
    provider: stored.provider ?? c.llmProvider,
    apiKey: apiKey ?? c.llmApiKey,
    model: stored.model ?? c.llmModel,
    temperature: stored.temperature ?? c.llmTemperature,
    maxOutputTokens: stored.maxOutputTokens ?? c.llmMaxOutputTokens,
  };
}

/**
 * Returns a non-secret view of a workspace's LLM settings for display in the
 * dashboard. Never returns the API key itself — only whether one exists and
 * where it came from.
 */
export async function getLlmSettingsView(
  workspaceId: string,
): Promise<LlmSettingsView> {
  const c = config();
  const { stored, apiKey } = await readWorkspaceSecret(workspaceId);

  const hasWorkspaceKey = Boolean(apiKey);
  const hasEnvKey = Boolean(c.llmApiKey);
  let apiKeySource: LlmConfigSource = "none";
  if (hasWorkspaceKey) {
    apiKeySource = "workspace";
  } else if (hasEnvKey) {
    apiKeySource = "environment";
  }

  const hasStoredSettings =
    stored.provider !== undefined ||
    stored.model !== undefined ||
    stored.temperature !== undefined ||
    stored.maxOutputTokens !== undefined;

  const rawProvider = stored.provider ?? c.llmProvider;
  const provider: LlmProviderName = isLlmProvider(rawProvider)
    ? rawProvider
    : "google";

  return {
    provider,
    model: stored.model ?? c.llmModel,
    temperature: stored.temperature ?? c.llmTemperature,
    maxOutputTokens: stored.maxOutputTokens ?? c.llmMaxOutputTokens,
    hasApiKey: hasWorkspaceKey || hasEnvKey,
    apiKeySource,
    settingsSource: hasStoredSettings ? "workspace" : "environment",
  };
}

export interface UpsertLlmSettingsParams {
  workspaceId: string;
  provider?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  // When provided (non-empty), replaces the stored API key. When omitted, the
  // existing key is preserved. When explicitly null, the key is cleared.
  apiKey?: string | null;
}

/**
 * Creates or updates the per-workspace LLM settings. Non-secret fields are
 * merged into `configValue`; the API key is written to `value` only when
 * provided (so saving settings without re-entering the key keeps it).
 */
export async function upsertLlmSettings({
  workspaceId,
  provider,
  model,
  temperature,
  maxOutputTokens,
  apiKey,
}: UpsertLlmSettingsParams): Promise<void> {
  await db().transaction(async (tx) => {
    const existing = await tx.query.secret.findFirst({
      where: and(
        eq(schema.secret.workspaceId, workspaceId),
        eq(schema.secret.name, LLM_CONFIG_SECRET_NAME),
      ),
    });
    const existingConfig = parseStoredConfig(existing?.configValue);

    const mergedConfig: StoredLlmConfig = {
      provider: provider ?? existingConfig.provider,
      model: model ?? existingConfig.model,
      temperature: temperature ?? existingConfig.temperature,
      maxOutputTokens: maxOutputTokens ?? existingConfig.maxOutputTokens,
    };

    let value: string | null | undefined;
    if (apiKey === null) {
      value = null;
    } else if (apiKey !== undefined && apiKey.length > 0) {
      value = apiKey;
    } else {
      value = existing?.value ?? null;
    }

    await upsert({
      table: schema.secret,
      tx,
      values: {
        id: existing?.id,
        workspaceId,
        name: LLM_CONFIG_SECRET_NAME,
        value,
        configValue: mergedConfig,
      },
      target: [schema.secret.workspaceId, schema.secret.name],
      set: {
        value,
        configValue: mergedConfig,
      },
    });
  });
}
