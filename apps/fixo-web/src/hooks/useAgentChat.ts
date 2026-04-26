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
import { AGENT_URL } from "@/lib/config";

export interface FixoEstimateData {
  success: true;
  estimateId?: number;
  vehicle: string;
  shareToken?: string;
  items: Array<{
    name: string;
    description: string;
    unitPrice: number;
    quantity: number;
    category: string;
  }>;
  subtotal: number;
  priceRange: string;
  expiresAt?: string;
  note?: string;
}

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
  /** Source of truth for the current Fixo session id. The transport reads
   * this on every request so the gateway can hydrate uploaded media as
   * FileUIParts on the latest turn. */
  sessionIdRef?: RefObject<number | null>;
}

/** Extract concatenated text from a UIMessage's parts. */
function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Extract all tool parts (static and dynamic) from a UIMessage. */
function getToolParts(msg: UIMessage) {
  return msg.parts.filter(isToolOrDynamicToolUIPart);
}

const STORAGE_KEY = "fixo-chat-history";

function loadStoredMessages(): UIMessage[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore corrupt data */
  }
  return undefined;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { scrollRef, inputRef, accessToken, sessionIdRef } = options;
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [pendingEstimate, setPendingEstimate] =
    useState<FixoEstimateData | null>(null);
  const imageUrlMapRef = useRef<Map<string, string>>(new Map());

  // Load persisted messages once on mount
  const [initialMessages] = useState(loadStoredMessages);
  // Tracks imageUrls by message index for new messages whose IDs aren't
  // known until after AI SDK v6 assigns them internally.
  const pendingImageUrlRef = useRef<{ index: number; url: string } | null>(
    null,
  );

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

  // Create transport once, using ref-based resolvers so headers and the
  // current sessionId stay live without recreating the transport.
  const transportRef = useRef<DefaultChatTransport<UIMessage> | null>(null);
  const sessionIdRefForTransport = sessionIdRef;
  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<UIMessage>({
      api: `${AGENT_URL}/task`,
      headers: () => headersRef.current,
      body: () => {
        const sid = sessionIdRefForTransport?.current ?? null;
        return sid !== null ? { sessionId: sid } : {};
      },
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

  // Persist messages to localStorage
  useEffect(() => {
    try {
      if (chatMessages.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chatMessages));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* localStorage full or unavailable */
    }
  }, [chatMessages]);

  // Track active tool calls and detect create_fixo_estimate output
  useEffect(() => {
    let latestEstimate: FixoEstimateData | null = null;

    for (const msg of chatMessages) {
      if (msg.role !== "assistant") continue;
      for (const part of getToolParts(msg)) {
        const toolName = getToolOrDynamicToolName(part);
        if (
          part.state === "input-available" ||
          part.state === "input-streaming"
        ) {
          setCurrentTool(toolName);
        } else if (part.state === "output-available") {
          setCurrentTool(null);
          if (
            toolName === "create_fixo_estimate" &&
            (part.output as Record<string, unknown>)?.success === true
          ) {
            latestEstimate = part.output as FixoEstimateData;
          }
        }
      }
    }

    setPendingEstimate(latestEstimate);
  }, [chatMessages]);

  // Scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollToBottom is stable, chatMessages triggers the scroll
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
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [setChatMessages]);

  const clearError = useCallback(() => {
    chatClearError();
  }, [chatClearError]);

  return {
    messages,
    isLoading,
    error,
    currentTool,
    pendingEstimate,
    sendMessage,
    clearMessages,
    clearError,
  };
}
