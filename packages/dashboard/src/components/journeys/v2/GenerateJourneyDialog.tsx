import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import { useAppStorePick } from "../../../lib/appStore";
import { useGenerateJourneyMutation } from "../../../lib/useGenerateJourneyMutation";
import { journeyToState } from "../store";

const EXAMPLE_PROMPT =
  "Welcome new trial users with an email, wait 3 days, then send a follow-up email.";

export default function GenerateJourneyDialog({
  open,
  onClose,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  onGenerated?: (name: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const { initJourneyState, setViewDraft } = useAppStorePick([
    "initJourneyState",
    "setViewDraft",
  ]);
  const generateMutation = useGenerateJourneyMutation();

  const handleClose = () => {
    if (generateMutation.isPending) {
      return;
    }
    generateMutation.reset();
    setPrompt("");
    onClose();
  };

  const handleGenerate = () => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      return;
    }
    generateMutation.mutate(
      { prompt: trimmed },
      {
        onSuccess: ({ name, definition }) => {
          // Load the generated definition into the builder as an editable draft
          // for the user to review before publishing.
          initJourneyState(journeyToState({ name, definition }));
          setViewDraft(true);
          generateMutation.reset();
          setPrompt("");
          onGenerated?.(name);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>✨ Generate journey with AI</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Describe the journey you want and we&apos;ll draft it using your
            existing segments and message templates. You can review and edit it
            before publishing.
          </Typography>
          <TextField
            autoFocus
            multiline
            minRows={4}
            fullWidth
            label="Describe your journey"
            placeholder={EXAMPLE_PROMPT}
            value={prompt}
            disabled={generateMutation.isPending}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {generateMutation.isError && (
            <Alert severity="error">{generateMutation.error.message}</Alert>
          )}
          <Alert severity="info">
            Generating replaces the current journey contents with the new draft.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={generateMutation.isPending}>
          Cancel
        </Button>
        <Box sx={{ position: "relative" }}>
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generateMutation.isPending || prompt.trim().length === 0}
          >
            Generate
          </Button>
          {generateMutation.isPending && (
            <CircularProgress
              size={20}
              sx={{
                position: "absolute",
                top: "50%",
                left: "50%",
                marginTop: "-10px",
                marginLeft: "-10px",
              }}
            />
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
}
