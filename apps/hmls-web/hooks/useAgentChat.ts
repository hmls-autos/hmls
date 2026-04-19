"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
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
import {
  clearStoredChat,
  DEFAULT_CHAT_STORAGE_KEY,
  loadStoredChatMessages,
  useChatPersist,
} from "@/hooks/useChatStorage";
import { useChatToolEvents } from "@/hooks/useChatToolEvents";
import { CHAT_ENDPOINT } from "@/lib/config";

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
  endpoint?: string;
  /** localStorage key for chat history. Use distinct keys per chat surface
   * (e.g. customer vs. staff) so conversations don't cross-contaminate. */
  storageKey?: string;
}

/** Extract concatenated text from a UIMessage's parts. */
function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
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
  const hasAskUserQuestion = last.parts
    .filter(isToolOrDynamicToolUIPart)
    .some(
      (p) =>
        p.state === "output-available" &&
        getToolOrDynamicToolName(p) === "ask_user_question",
    );
  return !hasAskUserQuestion;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const {
    scrollRef,
    inputRef,
    accessToken,
    endpoint = CHAT_ENDPOINT,
    storageKey = DEFAULT_CHAT_STORAGE_KEY,
  } = options;

  const [initialMessages] = useState(() => loadStoredChatMessages(storageKey));
  const [currentTool, setCurrentTool] = useState<string | null>(null);

  const focusInput = useCallback(() => {
    inputRef?.current?.focus();
  }, [inputRef]);

  // Keep headers ref in sync so transport always has fresh token
  const headersRef = useRef<Record<string, string>>({});
  useEffect(() => {
    headersRef.current = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : {};
  }, [accessToken]);

  // Create transport once, using a ref-based header resolver
  const transportRef = useRef<DefaultChatTransport<UIMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<UIMessage>({
      api: endpoint,
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
    messages: initialMessages,
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

  const {
    pendingQuestion,
    pendingSlotPicker,
    setPendingQuestion,
    setPendingSlotPicker,
    reset: resetToolEvents,
  } = useChatToolEvents(chatMessages, setCurrentTool);

  useChatPersist(chatMessages, storageKey);

  // Scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages change
  useEffect(() => {
    scrollRef?.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, scrollRef]);

  const isLoading = status === "submitted" || status === "streaming";
  const error = chatError?.message ?? null;

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
        continue;
      }

      if (msg.role !== "assistant") continue;

      const text = getTextContent(msg);
      if (text) {
        result.push({ id: msg.id, role: "assistant", content: text });
      }

      for (const part of msg.parts.filter(isToolOrDynamicToolUIPart)) {
        if (part.state !== "output-available") continue;
        const toolName = getToolOrDynamicToolName(part);

        if (
          toolName === "create_booking" &&
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
          toolName === "create_estimate" &&
          (part.output as Record<string, unknown>)?.success === true
        ) {
          const raw = part.output as {
            success: boolean;
            orderId?: number;
            vehicle?: string;
            items: {
              name: string;
              description?: string;
              totalCents: number;
            }[];
            subtotal: number;
            priceRange: string | null;
            expiresAt?: string | null;
            downloadUrl?: string;
            shareUrl?: string | null;
            note?: string;
          };
          result.push({
            id: `${msg.id}-estimate-${part.toolCallId}`,
            role: "estimate-card",
            content: "",
            estimateData: {
              success: true,
              estimateId: raw.orderId,
              vehicle: raw.vehicle ?? "Unknown vehicle",
              items: (raw.items ?? []).map((i) => ({
                name: i.name,
                description: i.description,
                price:
                  typeof i.totalCents === "number" ? i.totalCents / 100 : 0,
              })),
              subtotal: typeof raw.subtotal === "number" ? raw.subtotal : 0,
              priceRange: raw.priceRange ?? "",
              expiresAt: raw.expiresAt ?? undefined,
              shareUrl: raw.shareUrl ?? undefined,
              downloadUrl: raw.downloadUrl,
              note: raw.note,
            },
          });
        }
      }
    }

    return result;
  }, [chatMessages]);

  const sendMessage = useCallback(
    (content: string) => {
      setPendingQuestion(null);
      setPendingSlotPicker(null);
      chatSendMessage({ text: content });
    },
    [chatSendMessage, setPendingQuestion, setPendingSlotPicker],
  );

  const answerQuestion = useCallback(
    (answer: string) => {
      setPendingQuestion(null);
      sendMessage(answer);
    },
    [sendMessage, setPendingQuestion],
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
    [sendMessage, setPendingSlotPicker],
  );

  const clearMessages = useCallback(() => {
    setChatMessages([]);
    resetToolEvents();
    clearStoredChat(storageKey);
  }, [setChatMessages, resetToolEvents, storageKey]);

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
    clearError: chatClearError,
  };
}
