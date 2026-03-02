"use client";

import { type Message as AgentMessage, HttpAgent } from "@ag-ui/client";
import {
  type RefObject,
  startTransition,
  useCallback,
  useRef,
  useState,
} from "react";
import type { BookingConfirmationData } from "@/components/BookingConfirmation";
import type { QuestionData } from "@/components/QuestionCard";
import type { SlotPickerData } from "@/components/SlotPicker";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8080";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
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
  const [bookingConfirmations, setBookingConfirmations] = useState<
    Array<{ id: string; data: BookingConfirmationData }>
  >([]);
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
            startTransition(() => {
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, content: msg.content + event.delta }
                    : msg,
                ),
              );
            });
            scrollToBottom();
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
                setBookingConfirmations((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    data: result as BookingConfirmationData,
                  },
                ]);
              }
            } catch {
              // ignore parse errors
            }
            setTimeout(scrollToBottom, 0);
          },
          onRunFinishedEvent: () => {
            setIsLoading(false);
            focusInput();
          },
          onRunErrorEvent: ({ event }) => {
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
        const msg =
          err instanceof Error ? err.message : "Failed to connect to agent";
        console.error("[agent] Connection error:", msg);
        setError(msg);
        setIsLoading(false);
        focusInput();
      }
    },
    [scrollToBottom, focusInput, getAgent],
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
    setBookingConfirmations([]);
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
    bookingConfirmations,
    sendMessage,
    answerQuestion,
    selectSlot,
    clearMessages,
    clearError,
  };
}
