"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Send, Wrench } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { EstimateCard } from "@/components/EstimateCard";
import { QuestionCard } from "@/components/QuestionCard";
import { SlotPicker } from "@/components/SlotPicker";
import { Markdown } from "@/components/ui/Markdown";
import { useAgentChat } from "@/hooks/useAgentChat";
import { toolDisplayNames } from "@/lib/agent-tools";
import { AGENT_URL } from "@/lib/config";

const STAFF_SUGGESTIONS = [
  "Create a new order",
  "What's open Thursday?",
  "Front brake job labor time on 2020 Camry?",
  "Show in-progress orders",
];

export default function AdminChatPage() {
  const { session } = useAuth();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
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
  } = useAgentChat({
    accessToken: session?.access_token,
    endpoint: `${AGENT_URL}/staff-task`,
    inputRef,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput("");
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0 max-w-4xl mx-auto w-full px-4 pt-4 pb-4"
      style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-light flex items-center justify-center">
            <Wrench className="w-5 h-5 text-red-primary" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-text">
              Shop Assistant
            </h1>
            <p className="text-xs text-text-secondary">
              Create orders, look up labor times, manage shop
            </p>
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
          className="text-sm text-text-secondary hover:text-text transition-colors px-3 py-1.5 rounded-lg hover:bg-surface-alt"
        >
          Clear
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-border bg-surface p-4 space-y-3 min-h-0">
        <AnimatePresence mode="wait">
          {messages.length === 0 && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full text-center py-12"
            >
              <div className="w-14 h-14 rounded-full bg-red-light flex items-center justify-center mb-4">
                <Wrench className="w-7 h-7 text-red-primary" />
              </div>
              <h2 className="text-lg font-display font-bold text-text mb-1">
                What do you need?
              </h2>
              <p className="text-sm text-text-secondary mb-6 max-w-sm">
                Create orders, check labor times, look up customers, manage work
                orders.
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 w-full max-w-sm px-1 -mx-1 snap-x">
                {STAFF_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    className="flex-none snap-start px-3 py-1.5 rounded-full bg-surface-alt border border-border text-xs text-text-secondary hover:border-red-primary/50 hover:text-red-primary transition-colors whitespace-nowrap"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.map((msg) => {
          if (msg.role === "estimate-card" && msg.estimateData) {
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="max-w-[85%]">
                  <EstimateCard data={msg.estimateData} />
                </div>
              </motion.div>
            );
          }
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                  msg.role === "user"
                    ? "bg-red-primary text-white rounded-br-md"
                    : "bg-surface-alt border border-border text-text rounded-bl-md"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </p>
                ) : (
                  <Markdown content={msg.content} className="leading-relaxed" />
                )}
              </div>
            </motion.div>
          );
        })}

        {/* Question card */}
        <AnimatePresence>
          {pendingQuestion && (
            <QuestionCard
              data={pendingQuestion}
              onSelect={answerQuestion}
              disabled={isLoading}
            />
          )}
        </AnimatePresence>

        {/* Slot picker */}
        <AnimatePresence>
          {pendingSlotPicker && (
            <SlotPicker
              data={pendingSlotPicker}
              onSelect={selectSlot}
              disabled={isLoading}
            />
          )}
        </AnimatePresence>

        {/* Tool indicator */}
        <AnimatePresence>
          {currentTool && currentTool !== "ask_user_question" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="bg-surface-alt border border-border px-3 py-2 rounded-xl flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-red-primary animate-spin" />
                <span className="text-xs text-text-secondary">
                  {toolDisplayNames[currentTool] || currentTool}...
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="max-w-[85%] bg-red-50 border border-red-200 px-4 py-2.5 rounded-2xl rounded-bl-md">
                <p className="text-xs font-medium text-red-600 mb-0.5">Error</p>
                <p className="text-sm text-red-700">{error}</p>
                <button
                  type="button"
                  onClick={clearError}
                  className="text-xs text-red-500 hover:text-red-700 mt-1 underline"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading dots */}
        <AnimatePresence>
          {isLoading &&
            !currentTool &&
            messages[messages.length - 1]?.role === "user" && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex justify-start"
              >
                <div className="bg-surface-alt border border-border px-4 py-2.5 rounded-2xl rounded-bl-md">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-text-secondary/50 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-text-secondary/50 rounded-full animate-bounce [animation-delay:0.1s]" />
                    <span className="w-1.5 h-1.5 bg-text-secondary/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                  </div>
                </div>
              </motion.div>
            )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="mt-3">
        <div className="flex gap-2">
          <label htmlFor="staff-chat-input" className="sr-only">
            Message
          </label>
          <input
            ref={inputRef}
            id="staff-chat-input"
            type="text"
            name="message"
            autoComplete="off"
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Create an order, check labor times..."
            disabled={isLoading || !!pendingQuestion}
            className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary focus-visible:border-red-primary disabled:opacity-50 transition-colors"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={isLoading || !input.trim() || !!pendingQuestion}
            className="w-12 h-12 rounded-xl bg-red-primary text-white flex items-center justify-center hover:bg-red-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
