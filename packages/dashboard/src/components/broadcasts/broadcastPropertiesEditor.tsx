import { Delete } from "@mui/icons-material";
import {
  Button,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { extractTemplatePropertyKeys } from "isomorphic-lib/src/templateProperties";
import { useMemo, useState } from "react";

import { useBroadcastMutation } from "../../lib/useBroadcastMutation";
import { useBroadcastQuery } from "../../lib/useBroadcastQuery";
import { useMessageTemplateQuery } from "../../lib/useMessageTemplateQuery";
import { SubtleHeader } from "../headers";
import InfoTooltip from "../infoTooltip";

interface PropertyEntry {
  key: string;
  value: string;
}

/**
 * Broadcast-level Custom Properties editor. Persists a key/value bag onto
 * `config.properties`, exposed to the broadcast's message template as the
 * `properties` Liquid variable. Values are rendered per-recipient, so they may
 * reference user properties (e.g. "Hi {{ user.firstName }}").
 *
 * Mount with `key={broadcastId}` so the local entry list reseeds when switching
 * broadcasts.
 */
export function BroadcastPropertiesEditor({
  broadcastId,
  templateId,
  initialProperties,
  disabled,
}: {
  broadcastId: string;
  templateId?: string;
  initialProperties?: Record<string, string>;
  disabled?: boolean;
}) {
  const { data: broadcast } = useBroadcastQuery(broadcastId);
  const { mutate: updateBroadcast } = useBroadcastMutation(broadcastId);
  const { data: template } = useMessageTemplateQuery(templateId);

  const [entries, setEntries] = useState<PropertyEntry[]>(() =>
    Object.entries(initialProperties ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  );

  // Keys referenced as `{{ properties.* }}` in the selected template but not yet
  // configured — offered as one-click suggestions.
  const suggestedKeys = useMemo(() => {
    const referenced = extractTemplatePropertyKeys(
      template?.draft ?? template?.definition,
    );
    const existing = new Set(entries.map((e) => e.key.trim()));
    return referenced.filter((key) => !existing.has(key));
  }, [template, entries]);

  const persist = (next: PropertyEntry[]) => {
    setEntries(next);
    if (!broadcast) {
      return;
    }
    const record: Record<string, string> = {};
    for (const { key, value } of next) {
      const trimmedKey = key.trim();
      if (trimmedKey.length > 0) {
        record[trimmedKey] = value;
      }
    }
    updateBroadcast({
      config: {
        ...broadcast.config,
        properties: Object.keys(record).length > 0 ? record : undefined,
      },
    });
  };

  const addEntry = () => persist([...entries, { key: "", value: "" }]);
  const addSuggestedKey = (key: string) =>
    persist([...entries, { key, value: "" }]);
  const updateEntry = (
    index: number,
    field: "key" | "value",
    fieldValue: string,
  ) =>
    persist(
      entries.map((entry, i) =>
        i === index ? { ...entry, [field]: fieldValue } : entry,
      ),
    );
  const removeEntry = (index: number) =>
    persist(entries.filter((_, i) => i !== index));

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <SubtleHeader>Custom Properties</SubtleHeader>
        <InfoTooltip title="Static key/value attributes available in this broadcast's template as the `properties` Liquid variable, e.g. {{ properties.title }}. Values are rendered per-recipient, so they may reference user properties." />
      </Stack>
      {entries.map((entry, index) => (
        <Stack
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          direction="row"
          spacing={1}
          alignItems="center"
        >
          <TextField
            label="Key"
            size="small"
            sx={{ flex: 1 }}
            value={entry.key}
            onChange={(e) => updateEntry(index, "key", e.target.value)}
            disabled={disabled}
          />
          <TextField
            label="Value"
            size="small"
            sx={{ flex: 1 }}
            value={entry.value}
            onChange={(e) => updateEntry(index, "value", e.target.value)}
            disabled={disabled}
          />
          <IconButton
            onClick={() => removeEntry(index)}
            disabled={disabled}
            size="small"
          >
            <Delete />
          </IconButton>
        </Stack>
      ))}
      <Button
        variant="outlined"
        size="small"
        onClick={addEntry}
        disabled={disabled}
        sx={{ alignSelf: "flex-start" }}
      >
        Add Property
      </Button>
      {suggestedKeys.length > 0 ? (
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Referenced in template — click to add:
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {suggestedKeys.map((key) => (
              <Chip
                key={key}
                label={key}
                size="small"
                variant="outlined"
                onClick={disabled ? undefined : () => addSuggestedKey(key)}
                disabled={disabled}
              />
            ))}
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}
