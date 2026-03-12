"use client";

import { Markdown } from "@/components/ui/Markdown";
import type { Message } from "@/hooks/useAgentChat";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? "bg-primary text-white rounded-br-md"
            : "bg-surface-alt text-text rounded-bl-md"
        }`}
      >
        {message.imageUrl && (
          // biome-ignore lint/performance/noImgElement: data URL or external storage URL, not a static asset
          <img
            src={message.imageUrl}
            alt="Uploaded"
            className="rounded-lg max-w-full mb-2"
          />
        )}
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <Markdown content={message.content} />
        )}
      </div>
    </div>
  );
}
