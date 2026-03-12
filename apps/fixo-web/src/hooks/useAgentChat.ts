"use client";

import { type Message as AgentMessage, HttpAgent } from "@ag-ui/client";
import { type RefObject, useCallback, useRef, useState } from "react";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
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
  const agentRef = useRef<HttpAgent | null>(null);
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
    async (content: string, options?: { imageUrl?: string }) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        imageUrl: options?.imageUrl,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);
      setTimeout(scrollToBottom, 0);

      const agent = getAgent();

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
            setTimeout(scrollToBottom, 0);
          },
          onToolCallEndEvent: () => {
            setCurrentTool(null);
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

  const clearMessages = useCallback(() => {
    setMessages([]);
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
    sendMessage,
    clearMessages,
    clearError,
  };
}
