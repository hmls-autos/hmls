"use client";

import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { useStreamdownPlugins } from "@/lib/streamdown-plugins";
import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] gap-3",
      from === "user"
        ? "is-user ml-auto flex-row-reverse"
        : "is-assistant flex-row",
      className,
    )}
    {...props}
  />
);

export type MessageAvatarProps = HTMLAttributes<HTMLDivElement>;

/** Square avatar slot pinned to the start of the row, sized to align with
 *  the first line of the message content. Pass an icon or initials as
 *  children — the slot only handles framing/spacing. */
export const MessageAvatar = ({
  className,
  children,
  ...props
}: MessageAvatarProps) => (
  <div
    className={cn(
      "shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-red-light text-red-primary mt-1",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      // User: solid brand-red bubble, white text — high contrast against
      // dark surface, on-brand, reads as "you" without ambiguity. No
      // shadow — the shadow forced every bubble onto its own compositing
      // layer and tanked scroll perf during streaming.
      "group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-sm group-[.is-user]:bg-red-primary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-white",
      // Assistant: no bubble — text floats next to avatar, classic AI chat
      // style. Foreground color so streamdown markdown renders correctly.
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// Per-token fade-in for streaming text. Streamdown only animates the delta
// between renders, so historic messages paint once at mount without flicker.
// Tuned for snappy reads: 120ms fade, 0 stagger so a chunk's words appear
// together as one breath rather than rolling out word-by-word.
const defaultAnimated = {
  animation: "fadeIn",
  duration: 120,
  sep: "word",
  stagger: 0,
} as const;

export const MessageResponse = memo(
  ({ className, animated, children, ...props }: MessageResponseProps) => {
    const plugins = useStreamdownPlugins(
      typeof children === "string" ? children : "",
    );
    return (
      <Streamdown
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className,
        )}
        plugins={plugins}
        animated={animated ?? defaultAnimated}
        {...props}
      >
        {children}
      </Streamdown>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = "MessageResponse";
