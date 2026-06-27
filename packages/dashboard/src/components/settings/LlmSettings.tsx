import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { LlmProvider } from "isomorphic-lib/src/types";
import { useEffect, useState } from "react";

import {
  useLlmSettingsQuery,
  useUpsertLlmSettingsMutation,
} from "../../lib/useLlmSettings";

const PROVIDER_OPTIONS: { value: LlmProvider; label: string }[] = [
  { value: "google", label: "Google (Gemini)" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
];

const MODEL_PLACEHOLDER: Record<LlmProvider, string> = {
  google: "gemini-2.5-flash",
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
};

function isProvider(value: string): value is LlmProvider {
  return PROVIDER_OPTIONS.some((opt) => opt.value === value);
}

function apiKeyHelperText(
  hasApiKey: boolean,
  apiKeySource: "workspace" | "environment" | "none",
): string {
  if (apiKeySource === "workspace") {
    return "A key is saved for this workspace. Enter a new value to replace it.";
  }
  if (apiKeySource === "environment") {
    return "Using the key from the server environment. Enter a value to override it for this workspace.";
  }
  return hasApiKey
    ? "A key is configured."
    : "No key configured. AI features are disabled until a key is set here or via the server environment.";
}

export default function LlmSettings({ id }: { id?: string }) {
  const settingsQuery = useLlmSettingsQuery();
  const upsertMutation = useUpsertLlmSettingsMutation();

  const [provider, setProvider] = useState<LlmProvider>("google");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("0.4");
  const [maxOutputTokens, setMaxOutputTokens] = useState("4096");
  const [apiKey, setApiKey] = useState("");
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");

  // Populate the form once settings load (or when they change after a save).
  const settings = settingsQuery.data;
  useEffect(() => {
    if (!settings) {
      return;
    }
    setProvider(settings.provider);
    setModel(settings.model ?? "");
    setTemperature(String(settings.temperature));
    setMaxOutputTokens(String(settings.maxOutputTokens));
    setApiKey("");
  }, [settings]);

  const handleSave = () => {
    const parsedTemperature = Number(temperature);
    const parsedMaxOutputTokens = Number(maxOutputTokens);
    upsertMutation.mutate(
      {
        provider,
        model: model.trim().length > 0 ? model.trim() : undefined,
        temperature: Number.isFinite(parsedTemperature)
          ? parsedTemperature
          : undefined,
        maxOutputTokens:
          Number.isInteger(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
            ? parsedMaxOutputTokens
            : undefined,
        // Only send the key when the user typed one, so saving other settings
        // does not wipe an existing key.
        apiKey: apiKey.length > 0 ? apiKey : undefined,
      },
      {
        onSuccess: () => {
          setApiKey("");
          setSnackbarMessage("AI settings saved.");
          setSnackbarOpen(true);
        },
        onError: () => {
          setSnackbarMessage("Failed to save AI settings.");
          setSnackbarOpen(true);
        },
      },
    );
  };

  return (
    <Stack spacing={2} id={id}>
      <Typography variant="h4">AI</Typography>
      <Typography variant="body2" color="text.secondary">
        Configure the LLM used to generate journeys from a prompt. These
        settings override the server environment defaults for this workspace.
      </Typography>
      <Paper sx={{ p: 3 }} variant="outlined">
        <Stack spacing={3} sx={{ maxWidth: 480 }}>
          {settingsQuery.isError && (
            <Alert severity="error">Failed to load AI settings.</Alert>
          )}
          <TextField
            select
            label="Provider"
            value={provider}
            disabled={settingsQuery.isLoading}
            onChange={(e) => {
              if (isProvider(e.target.value)) {
                setProvider(e.target.value);
              }
            }}
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Model"
            placeholder={MODEL_PLACEHOLDER[provider]}
            helperText="Leave blank to use the provider's default model."
            value={model}
            disabled={settingsQuery.isLoading}
            onChange={(e) => setModel(e.target.value)}
          />
          <TextField
            label="API key"
            type="password"
            autoComplete="off"
            placeholder={settings?.hasApiKey ? "••••••••••" : ""}
            helperText={apiKeyHelperText(
              settings?.hasApiKey ?? false,
              settings?.apiKeySource ?? "none",
            )}
            value={apiKey}
            disabled={settingsQuery.isLoading}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Temperature"
              type="number"
              inputProps={{ min: 0, max: 2, step: 0.1 }}
              value={temperature}
              disabled={settingsQuery.isLoading}
              onChange={(e) => setTemperature(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Max output tokens"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={maxOutputTokens}
              disabled={settingsQuery.isLoading}
              onChange={(e) => setMaxOutputTokens(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={settingsQuery.isLoading || upsertMutation.isPending}
            sx={{ alignSelf: "start" }}
          >
            Save
          </Button>
        </Stack>
      </Paper>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />
    </Stack>
  );
}
