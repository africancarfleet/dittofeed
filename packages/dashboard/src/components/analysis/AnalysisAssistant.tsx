import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { AnalysisChatMessage } from "isomorphic-lib/src/types";
import { useState } from "react";

import { useAnalysisChatMutation } from "../../lib/useAnalysisChat";

interface DisplayMessage extends AnalysisChatMessage {
  toolsUsed?: string[];
  isError?: boolean;
}

const SUGGESTIONS = [
  "How did email perform over the last 7 days?",
  "Which journey had the most clicks last month?",
  "How many users are in each segment?",
  "What do you know about the user with email jane@example.com?",
];

function bubbleBgColor(message: DisplayMessage): string {
  if (message.role === "user") {
    return "primary.main";
  }
  if (message.isError) {
    return "error.light";
  }
  return "background.paper";
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === "user";
  return (
    <Stack
      sx={{ alignItems: isUser ? "flex-end" : "flex-start", width: "100%" }}
    >
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          maxWidth: "85%",
          bgcolor: bubbleBgColor(message),
          color: isUser ? "primary.contrastText" : "text.primary",
        }}
      >
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {message.content}
        </Typography>
      </Paper>
      {message.toolsUsed && message.toolsUsed.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap" }}>
          {message.toolsUsed.map((t) => (
            <Chip key={t} label={t} size="small" variant="outlined" />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export default function AnalysisAssistant() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const chatMutation = useAnalysisChatMutation();

  const send = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || chatMutation.isPending) {
      return;
    }
    const nextMessages: DisplayMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(nextMessages);
    setInput("");

    // Send only role/content (strip display-only fields) as the history.
    const history: AnalysisChatMessage[] = nextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    chatMutation.mutate(history, {
      onSuccess: (data) => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.text, toolsUsed: data.toolsUsed },
        ]);
      },
      onError: (error) => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: error.message, isError: true },
        ]);
      },
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">✨ Ask AI about this data</Typography>

        {messages.length === 0 ? (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Ask a question about your messaging performance and audience.
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: "wrap", gap: 1 }}
            >
              {SUGGESTIONS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  size="small"
                  onClick={() => send(s)}
                  clickable
                />
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack
            spacing={1.5}
            sx={{ maxHeight: 420, overflowY: "auto", pr: 1 }}
          >
            {messages.map((m, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <MessageBubble key={i} message={m} />
            ))}
            {chatMutation.isPending && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Analyzing…
                </Typography>
              </Stack>
            )}
          </Stack>
        )}

        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Ask about your data…"
            value={input}
            disabled={chatMutation.isPending}
            multiline
            maxRows={4}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <Box sx={{ position: "relative" }}>
            <Button
              variant="contained"
              onClick={() => send(input)}
              disabled={chatMutation.isPending || input.trim().length === 0}
              sx={{ height: 40 }}
            >
              Ask
            </Button>
          </Box>
        </Stack>
      </Stack>
    </Paper>
  );
}
