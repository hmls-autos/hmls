"use client";

import { motion } from "framer-motion";
import { Loader2, Send, Wrench } from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/components/AuthProvider";
import { EstimateCard } from "@/components/EstimateCard";
import { Markdown } from "@/components/ui/Markdown";
import { useAgentChat } from "@/hooks/useAgentChat";
import { toolDisplayNames } from "@/lib/agent-tools";

interface ChatWidgetPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatWidgetPanel({
  isOpen,
  onClose,
}: ChatWidgetPanelProps) {
  const { user, session, isLoading: authLoading } = useAuth();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    isLoading,
    error,
    currentTool,
    sendMessage,
    clearMessages,
    clearError,
  } = useAgentChat({
    scrollRef: messagesEndRef,
    inputRef,
    accessToken: session?.access_token,
  });

  const isAuthenticated = !!user;

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!isAuthenticated) {
        window.location.assign("/login");
        return;
      }
      if (!input.trim() || isLoading) return;
      sendMessage(input.trim());
      setInput("");
    },
    [isAuthenticated, input, isLoading, sendMessage],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="fixed bottom-24 right-6 z-50 w-[380px] h-[500px] bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden overscroll-contain"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-light flex items-center justify-center">
            <Wrench className="w-5 h-5 text-red-primary" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-text">
              HMLS Assistant
            </h3>
            <p className="text-xs text-text-secondary">Online</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (
              messages.length === 0 ||
              window.confirm("Clear chat history?")
            ) {
              clearMessages();
            }
          }}
          className="text-xs text-text-secondary hover:text-text transition-colors"
        >
          Clear chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-alt">
        {!authLoading && !isAuthenticated ? (
          <div className="text-center text-text-secondary mt-8 space-y-4">
            <p className="text-sm text-text font-medium">
              Sign in to start chatting
            </p>
            <p className="text-sm">
              You need an account to use the HMLS assistant. Sign in to access
              scheduling, quotes, and service updates.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-6 py-2 rounded-lg bg-red-primary text-white text-sm font-medium hover:bg-red-dark transition-colors"
            >
              Go to login
            </Link>
          </div>
        ) : (
          messages.length === 0 && (
            <div className="text-center text-text-secondary mt-8">
              <p className="text-sm">Hi! I'm the HMLS assistant.</p>
              <p className="text-sm mt-1">How can I help you today?</p>
            </div>
          )
        )}

        {isAuthenticated &&
          messages.map((msg) => {
            if (msg.role === "estimate-card" && msg.estimateData) {
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[80%]">
                    <EstimateCard data={msg.estimateData} />
                  </div>
                </div>
              );
            }
            return (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                    msg.role === "user"
                      ? "bg-red-primary text-white rounded-br-md"
                      : "bg-surface border border-border text-text rounded-bl-md"
                  }`}
                >
                  {msg.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <Markdown content={msg.content} className="text-sm" />
                  )}
                </div>
              </div>
            );
          })}

        {/* Tool indicator */}
        {isAuthenticated && currentTool && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border px-3 py-2 rounded-xl flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-red-primary animate-spin" />
              <span className="text-xs text-text-secondary">
                {toolDisplayNames[currentTool] || currentTool}...
              </span>
            </div>
          </div>
        )}

        {/* Error indicator */}
        {isAuthenticated && error && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-red-50 border border-red-200 px-4 py-2 rounded-2xl rounded-bl-md">
              <p className="text-xs font-medium text-red-600 mb-1">Error</p>
              <p className="text-sm text-red-700">{error}</p>
              <button
                type="button"
                onClick={clearError}
                className="text-xs text-red-500 hover:text-red-700 mt-1 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isAuthenticated &&
          isLoading &&
          !currentTool &&
          messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border px-4 py-2 rounded-2xl rounded-bl-md">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-text-secondary/50 rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-text-secondary/50 rounded-full animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 bg-text-secondary/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
              </div>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-border bg-surface"
      >
        <div className="flex gap-2">
          <label htmlFor="chat-widget-input" className="sr-only">
            Chat message
          </label>
          <input
            ref={inputRef}
            id="chat-widget-input"
            type="text"
            name="message"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isAuthenticated
                ? "Type a message\u2026"
                : "Sign in to start chatting"
            }
            disabled={isLoading || !isAuthenticated}
            className="flex-1 bg-surface-alt border border-border rounded-xl px-4 py-2 text-sm text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary focus-visible:border-red-primary disabled:opacity-50 transition-colors"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={isLoading || !input.trim() || !isAuthenticated}
            className="w-10 h-10 rounded-xl bg-red-primary text-white flex items-center justify-center hover:bg-red-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </motion.div>
  );
}
