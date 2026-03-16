"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type DynamicToolUIPart,
  getToolOrDynamicToolName,
  isToolOrDynamicToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BookingConfirmationData } from "@/components/BookingConfirmation";
import type { EstimateCardData } from "@/components/EstimateCard";
import type { QuestionData } from "@/components/QuestionCard";
import type { SlotPickerData } from "@/components/SlotPicker";
import { AGENT_URL } from "@/lib/config";

export interface Message {
  id: string;
  role: "user" | "assistant" | "estimate-card" | "booking-confirmation";
  content: string;
  estimateData?: EstimateCardData;
  bookingData?: BookingConfirmationData;
}

interface UseAgentChatOptions {
  scrollRef?: RefObject<HTMLElement | null>;
  inputRef?: RefObject<HTMLInputElement | null>;
  accessToken?: string | null;
}

/** Extract concatenated text from a UIMessage's parts. */
function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Extract dynamic tool parts from a UIMessage. */
function getToolParts(msg: UIMessage): DynamicToolUIPart[] {
  return msg.parts.filter(
    (p): p is DynamicToolUIPart => p.type === "dynamic-tool",
  );
}

/**
 * Like lastAssistantMessageIsCompleteWithToolCalls, but skips auto-send when
 * ask_user_question is the pending tool — the user must pick an option first.
 */
function sendAutomaticallyWhenNotAskUser({
  messages,
}: {
  messages: UIMessage[];
}): boolean {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  const toolParts = last.parts
    .filter(isToolOrDynamicToolUIPart)
    .filter((p) => !p.providerExecuted && p.state === "output-available");
  // If any output-available tool is ask_user_question, don't auto-send
  if (
    toolParts.some((p) => getToolOrDynamicToolName(p) === "ask_user_question")
  )
    return false;
  return true;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { scrollRef, inputRef, accessToken } = options;
  const [pendingQuestion, setPendingQuestion] = useState<QuestionData | null>(
    null,
  );
  const [pendingSlotPicker, setPendingSlotPicker] =
    useState<SlotPickerData | null>(null);
  const [currentTool, setCurrentTool] = useState<string | null>(null);

  // Track which tool invocations we've already processed to avoid duplicates
  const processedInvocationsRef = useRef<Set<string>>(new Set());

  const scrollToBottom = useCallback(() => {
    scrollRef?.current?.scrollIntoView({ behavior: "smooth" });
  }, [scrollRef]);

  const focusInput = useCallback(() => {
    inputRef?.current?.focus();
  }, [inputRef]);

  // Keep headers ref in sync so transport always has fresh token
  const headersRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const h: Record<string, string> = {};
    if (accessToken) {
      h.Authorization = `Bearer ${accessToken}`;
    }
    headersRef.current = h;
  }, [accessToken]);

  // Create transport once, using a ref-based header resolver
  const transportRef = useRef<DefaultChatTransport<UIMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<UIMessage>({
      api: `${AGENT_URL}/task`,
      headers: () => headersRef.current,
    });
  }

  const {
    messages: chatMessages,
    status,
    error: chatError,
    sendMessage: chatSendMessage,
    setMessages: setChatMessages,
    clearError: chatClearError,
  } = useChat({
    transport: transportRef.current,
    sendAutomaticallyWhen: sendAutomaticallyWhenNotAskUser,
    onFinish: () => {
      setCurrentTool(null);
      focusInput();
    },
    onError: (err) => {
      console.error("[agent] Chat error:", err);
      setCurrentTool(null);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Clear processed invocations when messages are reset externally
  useEffect(() => {
    if (chatMessages.length === 0) {
      processedInvocationsRef.current.clear();
    }
  }, [chatMessages.length]);

  // Derive tool call state from streaming messages
  useEffect(() => {
    const processed = processedInvocationsRef.current;

    for (const msg of chatMessages) {
      if (msg.role !== "assistant") continue;
      const toolParts = getToolParts(msg);

      for (const part of toolParts) {
        // Track active tool calls
        if (
          part.state === "input-available" ||
          part.state === "input-streaming"
        ) {
          setCurrentTool(part.toolName);
        }

        // Detect ask_user_question tool calls
        if (
          part.toolName === "ask_user_question" &&
          (part.state === "input-available" ||
            part.state === "output-available") &&
          !processed.has(`question-${part.toolCallId}`)
        ) {
          processed.add(`question-${part.toolCallId}`);
          setPendingQuestion(part.input as QuestionData);
        }

        // Detect tool results
        if (
          part.state === "output-available" &&
          !processed.has(`result-${part.toolCallId}`)
        ) {
          processed.add(`result-${part.toolCallId}`);
          setCurrentTool(null);

          if (part.toolName === "get_availability" && part.output) {
            setPendingSlotPicker(part.output as SlotPickerData);
          }
        }
      }
    }
  }, [chatMessages]);

  // Scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, scrollToBottom]);

  // Build messages array matching the existing Message interface.
  // Injects estimate-card and booking-confirmation messages after
  // assistant messages that contain matching tool results.
  const messages: Message[] = useMemo(() => {
    const result: Message[] = [];

    for (const msg of chatMessages) {
      if (msg.role === "user") {
        result.push({
          id: msg.id,
          role: "user",
          content: getTextContent(msg),
        });
      } else if (msg.role === "assistant") {
        // Add the text content (may be empty during tool-only steps)
        const text = getTextContent(msg);
        if (text) {
          result.push({ id: msg.id, role: "assistant", content: text });
        }

        // Check tool parts for card data
        const toolParts = getToolParts(msg);
        for (const part of toolParts) {
          if (part.state !== "output-available") continue;

          if (
            part.toolName === "create_booking" &&
            (part.output as Record<string, unknown>)?.success !== undefined
          ) {
            result.push({
              id: `${msg.id}-booking-${part.toolCallId}`,
              role: "booking-confirmation",
              content: "",
              bookingData: part.output as BookingConfirmationData,
            });
          }

          if (
            part.toolName === "create_estimate" &&
            (part.output as Record<string, unknown>)?.success &&
            (part.output as Record<string, unknown>)?.items
          ) {
            result.push({
              id: `${msg.id}-estimate-${part.toolCallId}`,
              role: "estimate-card",
              content: "",
              estimateData: part.output as EstimateCardData,
            });
          }
        }
      }
    }

    return result;
  }, [chatMessages]);

  const error = chatError?.message ?? null;

  const sendMessage = useCallback(
    (content: string) => {
      setPendingQuestion(null);
      setPendingSlotPicker(null);
      chatSendMessage({ text: content });
    },
    [chatSendMessage],
  );

  const answerQuestion = useCallback(
    (answer: string) => {
      setPendingQuestion(null);
      sendMessage(answer);
    },
    [sendMessage],
  );

  const selectSlot = useCallback(
    (providerId: number, time: string) => {
      setPendingSlotPicker(null);
      const timeLabel = new Date(time).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const dateLabel = new Date(time).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      sendMessage(
        `I'd like the ${timeLabel} slot on ${dateLabel} with provider ${providerId}.`,
      );
    },
    [sendMessage],
  );

  const clearMessages = useCallback(() => {
    setChatMessages([]);
    setPendingQuestion(null);
    setPendingSlotPicker(null);
    processedInvocationsRef.current.clear();
  }, [setChatMessages]);

  const clearError = useCallback(() => {
    chatClearError();
  }, [chatClearError]);

  return {
    messages,
    isLoading,
    error,
    currentTool,
    pendingQuestion,
    pendingSlotPicker,
    sendMessage,
    answerQuestion,
    selectSlot,
    clearMessages,
    clearError,
  };
}
