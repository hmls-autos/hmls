"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, Send, Wrench } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { BookingConfirmation } from "@/components/BookingConfirmation";
import { EstimateCard } from "@/components/EstimateCard";
import { QuestionCard } from "@/components/QuestionCard";
import { SlotPicker } from "@/components/SlotPicker";
import { Markdown } from "@/components/ui/Markdown";
import { useAgentChat } from "@/hooks/useAgentChat";
import { toolDisplayNames } from "@/lib/agent-tools";

function ChatPageInner() {
  const prefersReducedMotion = useReducedMotion();
  const { session, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSentInitial = useRef(false);

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
  } = useAgentChat({ accessToken: session?.access_token });

  // Always connected when hook is mounted
  const isConnected = true;

  // Scroll to bottom when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount only (avoid autoFocus on every state change for mobile)
  useEffect(() => {
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    if (!isMobile) {
      inputRef.current?.focus();
    }
  }, []);

  // Auto-send initial message from query params (hero widget)
  useEffect(() => {
    if (hasSentInitial.current || messages.length > 0) return;
    const service = searchParams.get("service");
    const date = searchParams.get("date");
    const location = searchParams.get("location");

    if (service || date || location) {
      hasSentInitial.current = true;
      const parts: string[] = [];
      if (service)
        parts.push(
          `I need ${/^[aeiou]/i.test(service) ? "an" : "a"} ${service}`,
        );
      if (date) {
        const formatted = new Date(`${date}T00:00:00`).toLocaleDateString(
          "en-US",
          {
            weekday: "long",
            month: "long",
            day: "numeric",
          },
        );
        parts.push(`on ${formatted}`);
      }
      if (location) parts.push(`near ${location}`);
      sendMessage(`${parts.join(" ")}.`);
    }
  }, [searchParams, messages.length, sendMessage]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput("");
  };

  // Show loading state
  if (authLoading) {
    return (
      <main className="flex flex-col flex-1 bg-background text-text">
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="text-red-primary animate-pulse">Loading...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col flex-1 bg-background text-text">
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full pt-8 pb-4 px-4">
        {/* Header */}
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            prefersReducedMotion ? { duration: 0 } : { duration: 0.4 }
          }
          className="flex items-center justify-between mb-4 px-2"
        >
          <div className="flex items-center gap-3">
            <motion.div
              initial={prefersReducedMotion ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { delay: 0.2, type: "spring", stiffness: 200 }
              }
              className="w-12 h-12 rounded-full bg-red-light flex items-center justify-center"
            >
              <Wrench className="w-6 h-6 text-red-primary" />
            </motion.div>
            <div>
              <h1 className="text-xl font-display font-bold text-text">
                HMLS Assistant
              </h1>
              <p className="text-sm text-text-secondary">
                {isConnected ? "Online - Ready to help" : "Connecting..."}
              </p>
            </div>
          </div>
          <motion.button
            type="button"
            onClick={() => {
              if (
                messages.length === 0 ||
                window.confirm("Clear chat history?")
              ) {
                clearMessages();
              }
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="text-sm text-text-secondary hover:text-text transition-colors px-4 py-2 rounded-lg hover:bg-surface-alt"
          >
            Clear chat
          </motion.button>
        </motion.div>

        {/* Messages Area */}
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: 0.4, delay: 0.1 }
          }
          className="flex-1 overflow-y-auto rounded-2xl border border-border bg-surface p-6 space-y-4"
        >
          <AnimatePresence mode="wait">
            {messages.length === 0 && (
              <motion.div
                key="welcome"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center h-full text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                  className="w-16 h-16 rounded-full bg-red-light flex items-center justify-center mb-4"
                >
                  <Wrench className="w-8 h-8 text-red-primary" />
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-xl font-display font-bold text-text mb-2"
                >
                  Welcome to HMLS Assistant
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="text-text-secondary max-w-md"
                >
                  I can help you with scheduling appointments, getting quotes,
                  checking service availability, and answering questions about
                  our mobile mechanic services.
                </motion.p>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="flex flex-wrap gap-2 mt-6 justify-center"
                >
                  {[
                    "What services do you offer?",
                    "I need an oil change",
                    "Check availability",
                    "Get a quote for brake service",
                  ].map((suggestion, index) => (
                    <motion.button
                      key={suggestion}
                      type="button"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6 + index * 0.1 }}
                      whileHover={{
                        scale: 1.05,
                        borderColor: "rgb(220 38 38 / 0.5)",
                      }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => sendMessage(suggestion)}
                      className="px-4 py-2 rounded-full bg-surface-alt border border-border text-sm text-text-secondary hover:border-red-primary/50 hover:text-red-primary transition-colors"
                    >
                      {suggestion}
                    </motion.button>
                  ))}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {messages.map((msg) => {
            if (msg.role === "estimate-card" && msg.estimateData) {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex justify-start"
                >
                  <div className="max-w-[80%]">
                    <EstimateCard data={msg.estimateData} />
                  </div>
                </motion.div>
              );
            }
            if (msg.role === "booking-confirmation" && msg.bookingData) {
              return (
                <BookingConfirmation key={msg.id} data={msg.bookingData} />
              );
            }
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.2 }}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <motion.div
                  initial={{ opacity: 0, x: msg.role === "user" ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: 0.05 }}
                  className={`max-w-[80%] px-5 py-3 rounded-2xl ${
                    msg.role === "user"
                      ? "bg-red-primary text-white rounded-br-md"
                      : "bg-surface-alt border border-border text-text rounded-bl-md"
                  }`}
                >
                  {msg.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </p>
                  ) : (
                    <Markdown
                      content={msg.content}
                      className="text-sm leading-relaxed"
                    />
                  )}
                </motion.div>
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
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex justify-start"
              >
                <div className="bg-surface-alt border border-border px-4 py-2 rounded-xl flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-red-primary animate-spin" />
                  <span className="text-sm text-text-secondary">
                    {toolDisplayNames[currentTool] || currentTool}...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error indicator */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex justify-start"
              >
                <div className="max-w-[80%] bg-red-50 border border-red-200 px-5 py-3 rounded-2xl rounded-bl-md">
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* Loading indicator */}
          <AnimatePresence>
            {isLoading &&
              !currentTool &&
              messages[messages.length - 1]?.role === "user" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-start"
                >
                  <div className="bg-surface-alt border border-border px-5 py-3 rounded-2xl rounded-bl-md">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-text-secondary/50 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-text-secondary/50 rounded-full animate-bounce [animation-delay:0.1s]" />
                      <span className="w-2 h-2 bg-text-secondary/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                    </div>
                  </div>
                </motion.div>
              )}
          </AnimatePresence>

          <div ref={messagesEndRef} />
        </motion.div>

        {/* Input Area */}
        <motion.form
          initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: 0.4, delay: 0.2 }
          }
          onSubmit={handleSubmit}
          className="mt-4"
        >
          <div className="flex gap-3">
            <label htmlFor="chat-input" className="sr-only">
              Chat message
            </label>
            <input
              ref={inputRef}
              id="chat-input"
              type="text"
              name="message"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={!isConnected || isLoading || !!pendingQuestion}
              className="flex-1 bg-surface border border-border rounded-xl px-5 py-4 text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary focus-visible:border-red-primary disabled:opacity-50 transition-colors"
            />
            <motion.button
              type="submit"
              aria-label="Send message"
              disabled={
                !isConnected || isLoading || !input.trim() || !!pendingQuestion
              }
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-14 h-14 rounded-xl bg-red-primary text-white flex items-center justify-center hover:bg-red-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={20} />
            </motion.button>
          </div>
        </motion.form>
      </div>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-col flex-1 bg-background text-text">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-red-primary animate-pulse">Loading...</div>
          </div>
        </main>
      }
    >
      <ChatPageInner />
    </Suspense>
  );
}
