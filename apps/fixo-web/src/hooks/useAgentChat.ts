"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type DynamicToolUIPart,
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
import { AGENT_URL } from "@/lib/config";

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

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { scrollRef, inputRef, accessToken } = options;
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const imageUrlMapRef = useRef<Map<string, string>>(new Map());
  // Tracks imageUrls by message index for new messages whose IDs aren't
  // known until after AI SDK v6 assigns them internally.
  const pendingImageUrlRef = useRef<{ index: number; url: string } | null>(null);

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
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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

  // Track active tool calls from streaming messages
  useEffect(() => {
    for (const msg of chatMessages) {
      if (msg.role !== "assistant") continue;
      for (const part of getToolParts(msg)) {
        if (
          part.state === "input-available" ||
          part.state === "input-streaming"
        ) {
          setCurrentTool(part.toolName);
        } else if (part.state === "output-available") {
          setCurrentTool(null);
        }
      }
    }
  }, [chatMessages]);

  // Scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, scrollToBottom]);

  // Map to our Message interface
  const messages: Message[] = useMemo(() => {
    const filtered = chatMessages
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .filter((msg) => getTextContent(msg)); // skip empty tool-only steps

    // Resolve any pending imageUrl (stored by index) into the id-keyed map
    if (pendingImageUrlRef.current !== null) {
      const { index, url } = pendingImageUrlRef.current;
      if (index < filtered.length) {
        imageUrlMapRef.current.set(filtered[index].id, url);
        pendingImageUrlRef.current = null;
      }
    }

    return filtered.map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant",
      content: getTextContent(msg),
      imageUrl: imageUrlMapRef.current.get(msg.id),
    }));
  }, [chatMessages]);

  const error = chatError?.message ?? null;

  const sendMessage = useCallback(
    (content: string, options?: { imageUrl?: string }) => {
      if (options?.imageUrl) {
        // Track by the index the new user message will occupy, since AI SDK v6
        // assigns its own internal ID and ignores the pre-generated UUID key.
        const userMessages = chatMessages.filter(
          (m) => m.role === "user" || m.role === "assistant",
        );
        pendingImageUrlRef.current = {
          index: userMessages.length,
          url: options.imageUrl,
        };
      }
      chatSendMessage({ text: content });
    },
    [chatSendMessage, chatMessages],
  );

  const clearMessages = useCallback(() => {
    setChatMessages([]);
    imageUrlMapRef.current.clear();
  }, [setChatMessages]);

  const clearError = useCallback(() => {
    chatClearError();
  }, [chatClearError]);

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
