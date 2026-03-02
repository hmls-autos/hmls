"use client";

import { type Message as AgentMessage, HttpAgent } from "@ag-ui/client";
import { type RefObject, useCallback, useRef, useState } from "react";
import type { BookingConfirmationData } from "@/components/BookingConfirmation";
import type { EstimateCardData } from "@/components/EstimateCard";
import type { QuestionData } from "@/components/QuestionCard";
import type { SlotPickerData } from "@/components/SlotPicker";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8080";

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

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { scrollRef, inputRef, accessToken } = options;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<QuestionData | null>(
    null,
  );
  const [pendingSlotPicker, setPendingSlotPicker] =
    useState<SlotPickerData | null>(null);
  // bookingConfirmations and estimateCards are now embedded in the messages array
  const agentRef = useRef<HttpAgent | null>(null);
  const toolCallNamesRef = useRef<Map<string, string>>(new Map());
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const scrollToBottom = useCallback(() => {
    scrollRef?.current?.scrollIntoView({ behavior: "smooth" });
  }, [scrollRef]);

  const focusInput = useCallback(() => {
    inputRef?.current?.focus();
  }, [inputRef]);

  // Char-by-char streaming buffer
  const bufferRef = useRef("");
  const rafRef = useRef<number>(0);
  const CHARS_PER_FRAME = 3;

  const drainBuffer = useCallback(
    (msgId: string) => {
      if (bufferRef.current.length === 0) {
        rafRef.current = 0;
        return;
      }
      const chunk = bufferRef.current.slice(0, CHARS_PER_FRAME);
      bufferRef.current = bufferRef.current.slice(CHARS_PER_FRAME);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === msgId ? { ...msg, content: msg.content + chunk } : msg,
        ),
      );
      scrollToBottom();
      rafRef.current = requestAnimationFrame(() => drainBuffer(msgId));
    },
    [scrollToBottom],
  );

  const flushBuffer = useCallback((msgId: string) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const remaining = bufferRef.current;
    bufferRef.current = "";
    if (remaining) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === msgId ? { ...msg, content: msg.content + remaining } : msg,
        ),
      );
    }
  }, []);

  const getAgent = useCallback(() => {
    if (!agentRef.current) {
      const headers: Record<string, string> = {};
      if (tokenRef.current) {
        headers.Authorization = `Bearer ${tokenRef.current}`;
      }
      agentRef.current = new HttpAgent({ url: `${AGENT_URL}/task`, headers });
    }
    return agentRef.current;
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);
      setTimeout(scrollToBottom, 0);

      const agent = getAgent();

      // Add the new user message to the agent's internal state.
      // Don't use setMessages — it would overwrite the full message history
      // (including tool calls from MESSAGES_SNAPSHOT) with stripped text-only versions,
      // causing the backend to lose conversation context.
      agent.addMessage({
        id: userMsg.id,
        role: "user",
        content,
      } as AgentMessage);

      let assistantId = "";

      try {
        await agent.runAgent(undefined, {
          onTextMessageStartEvent: ({ event }) => {
            assistantId = event.messageId;
            setMessages((m) => [
              ...m,
              { id: assistantId, role: "assistant", content: "" },
            ]);
            setTimeout(scrollToBottom, 0);
          },
          onTextMessageContentEvent: ({ event }) => {
            bufferRef.current += event.delta;
            if (!rafRef.current) {
              rafRef.current = requestAnimationFrame(() =>
                drainBuffer(assistantId),
              );
            }
          },
          onToolCallStartEvent: ({ event }) => {
            setCurrentTool(event.toolCallName);
            toolCallNamesRef.current.set(event.toolCallId, event.toolCallName);
            setTimeout(scrollToBottom, 0);
          },
          onToolCallEndEvent: ({ toolCallName, toolCallArgs }) => {
            if (toolCallName === "ask_user_question") {
              setPendingQuestion(toolCallArgs as QuestionData);
            }
            setCurrentTool(null);
          },
          onToolCallResultEvent: ({ event }) => {
            const toolName = toolCallNamesRef.current.get(event.toolCallId);
            if (!toolName || !event.content) return;

            try {
              const result = JSON.parse(event.content);
              if (toolName === "get_availability") {
                setPendingSlotPicker(result as SlotPickerData);
              }
              if (
                toolName === "create_booking" &&
                result.success !== undefined
              ) {
                setMessages((m) => [
                  ...m,
                  {
                    id: crypto.randomUUID(),
                    role: "booking-confirmation",
                    content: "",
                    bookingData: result as BookingConfirmationData,
                  },
                ]);
              }
              if (
                toolName === "create_estimate" &&
                result.success &&
                result.items
              ) {
                setMessages((m) => [
                  ...m,
                  {
                    id: crypto.randomUUID(),
                    role: "estimate-card",
                    content: "",
                    estimateData: result as EstimateCardData,
                  },
                ]);
              }
            } catch {
              // ignore parse errors
            }
            setTimeout(scrollToBottom, 0);
          },
          onRunFinishedEvent: () => {
            flushBuffer(assistantId);
            setIsLoading(false);
            focusInput();
          },
          onRunErrorEvent: ({ event }) => {
            flushBuffer(assistantId);
            const msg =
              (event as { message?: string }).message ||
              "Agent encountered an error";
            console.error("[agent] Run error:", msg);
            setError(msg);
            setIsLoading(false);
            focusInput();
          },
        });
      } catch (err) {
        flushBuffer(assistantId);
        const msg =
          err instanceof Error ? err.message : "Failed to connect to agent";
        console.error("[agent] Connection error:", msg);
        setError(msg);
        setIsLoading(false);
        focusInput();
      }
    },
    [scrollToBottom, focusInput, getAgent, drainBuffer, flushBuffer],
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
    setMessages([]);
    setPendingQuestion(null);
    setPendingSlotPicker(null);
    agentRef.current = null;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

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
