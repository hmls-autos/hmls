"use client";

import type { Session } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { Car, FileDown } from "lucide-react";
import { redirect, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ChatInput } from "@/components/chat/ChatInput";
import { FixoEstimateCard } from "@/components/chat/FixoEstimateCard";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ToolIndicator } from "@/components/chat/ToolIndicator";
import { AudioRecorder } from "@/components/media/AudioRecorder";
import { CameraCapture } from "@/components/media/CameraCapture";
import { ObdInput } from "@/components/media/ObdInput";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useAgentChat } from "@/hooks/useAgentChat";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { AGENT_URL } from "@/lib/config";
import { downloadReportPdf } from "@/lib/download-report";
import { ensureSession, loadStoredSessionId } from "@/lib/session";

function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-12">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Car className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold mb-2">
        Fixo<span className="text-primary">.</span>
      </h2>
      <p className="text-text-secondary text-sm max-w-xs">
        Describe your car problem, snap a photo of a warning light, or enter an
        OBD code for instant expert analysis.
      </p>
    </div>
  );
}

// Auth gate. useAgentChat persists chat history scoped by userId, and the
// useChat hook only consumes its initialMessages on first mount — so if the
// hook mounted while auth was still loading, it would read the `:anon`
// localStorage keys, miss the user's saved transcript, and then overwrite it
// when the persistence effect fires under the real user key. Mounting the
// chat UI only after auth resolves avoids that whole class of restore bugs.
export default function ChatPage() {
  const { session, user, isLoading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!session || !user) {
    redirect("/login");
  }

  // Key by user.id so a cross-tab auth swap (Supabase broadcasts to all tabs
  // on sign-in/sign-out) forces a full remount of the chat subtree. Without
  // this, useAgentChat would hold user A's chatMessages and sessionIdRef
  // while userId flipped to B, persisting A's transcript under B's storage
  // key and aiming uploads at A's session.
  return <ChatPageBootstrap key={user.id} session={session} userId={user.id} />;
}

interface BootstrapState {
  initialMessages: UIMessage[] | undefined;
  initialSessionId: number | null | undefined;
}

/** Resolve the chat's starting transcript before mounting the chat hook.
 *
 * Priority order:
 *  1. `?session=N` URL param (clicked from /history) — always fetch from
 *     server so cross-device resume works regardless of localStorage state.
 *  2. Stored sessionId from a prior turn on this device — fetch from server
 *     to honor edits made on another device since the last visit.
 *  3. Neither — let useAgentChat fall back to localStorage (legacy single-
 *     device path; preserves the experience for users who never upload or
 *     hit Report so no session row exists yet).
 *
 * The hook reads `initialMessages` exactly once on mount, so we can't let it
 * mount before the server fetch resolves — gating the inner render with a
 * spinner is the simplest way to keep the hook mount semantics clean. */
function ChatPageBootstrap({
  session,
  userId,
}: {
  session: Session;
  userId: string;
}) {
  const searchParams = useSearchParams();
  const urlSessionParam = searchParams.get("session");
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const parseSid = (raw: string | null): number | null => {
      if (!raw) return null;
      const n = parseInt(raw, 10);
      return Number.isInteger(n) && n > 0 ? n : null;
    };

    const candidate = parseSid(urlSessionParam) ?? loadStoredSessionId(userId);

    if (candidate === null) {
      // No known session id — let the hook fall back to localStorage.
      setBootstrap({ initialMessages: undefined, initialSessionId: undefined });
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${AGENT_URL}/sessions/${candidate}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          // 404 (someone else's id, or deleted) → start fresh, ignore the
          // stored id rather than carrying it into uploads/Report calls.
          setBootstrap({ initialMessages: [], initialSessionId: null });
          return;
        }
        const data = (await res.json()) as {
          session?: { messages?: unknown };
        };
        const raw = data.session?.messages;
        const messages: UIMessage[] = Array.isArray(raw)
          ? (raw as UIMessage[])
          : [];
        setBootstrap({
          initialMessages: messages,
          initialSessionId: candidate,
        });
      } catch {
        if (cancelled) return;
        // Network blip — fall back to local cache rather than erasing
        // history. The hook's localStorage path will pick up.
        setBootstrap({
          initialMessages: undefined,
          initialSessionId: undefined,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.access_token, userId, urlSessionParam]);

  if (!bootstrap) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ChatPageInner
      session={session}
      userId={userId}
      initialMessages={bootstrap.initialMessages}
      initialSessionId={bootstrap.initialSessionId}
    />
  );
}

function ChatPageInner({
  session,
  userId,
  initialMessages,
  initialSessionId,
}: {
  session: Session;
  userId: string;
  initialMessages: UIMessage[] | undefined;
  initialSessionId: number | null | undefined;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Seed the ref synchronously on first render so the chat transport's first
  // /task call already carries the resolved sessionId. Doing this in an
  // effect would race with an immediate sendMessage on a resumed transcript.
  const sessionIdRef = useRef<number | null>(initialSessionId ?? null);
  const [showCamera, setShowCamera] = useState(false);
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const [showObdInput, setShowObdInput] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

  const {
    messages,
    uiMessages,
    isLoading,
    sendMessage,
    currentTool,
    pendingEstimate,
    error,
    clearError,
  } = useAgentChat({
    scrollRef,
    inputRef,
    accessToken: session.access_token,
    sessionIdRef,
    userId,
    initialMessages,
    initialSessionId,
  });

  const [isFinalizing, setIsFinalizing] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const { handleAudioSend, handlePhotoCapture, handleFilePick } =
    useMediaUpload({
      accessToken: session.access_token,
      sessionIdRef,
      sendMessage,
      userId,
    });

  const handleDownloadReport = useCallback(async () => {
    if (isFinalizing) return;
    setReportError(null);
    setIsFinalizing(true);
    try {
      // Lazy session creation: text-only chats don't have a session id until
      // the user actually needs one. The Report click is that moment. This
      // keeps the free-tier session-count quota gated on report generation,
      // not on every chat send.
      const sid = await ensureSession(
        session.access_token,
        sessionIdRef,
        userId,
      );
      if (!sid) throw new Error("Failed to start a session");

      // Finalize the session first: this calls generateObject server-side and
      // populates fixo_sessions.result + status='complete'. The chat history
      // lives in client state, so we must hand it to the server explicitly.
      const completeRes = await fetch(`${AGENT_URL}/sessions/${sid}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: uiMessages }),
      });
      if (!completeRes.ok) {
        const detail = await completeRes
          .json()
          .catch(() => ({ error: completeRes.statusText }));
        throw new Error(detail.error ?? "Failed to finalize session");
      }

      await downloadReportPdf(sid, session.access_token);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsFinalizing(false);
    }
  }, [session.access_token, uiMessages, isFinalizing, userId]);

  const handleObdSubmit = useCallback(
    (codes: string[]) => {
      sendMessage(`OBD-II Codes: ${codes.join(", ")}`);
    },
    [sendMessage],
  );

  // Check for upgrade-related errors from the agent
  const isUpgradeError =
    error &&
    (error.includes("upgrade_required") || error.includes("limit_reached"));

  // Move state update out of render to avoid React anti-pattern
  useEffect(() => {
    if (isUpgradeError && !upgradeMessage) {
      setUpgradeMessage(error);
      clearError();
    }
  }, [isUpgradeError, error, upgradeMessage, clearError]);

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Fixo<span className="text-primary">.</span>
        </h1>
        {messages.length > 0 && !isLoading && (
          <button
            type="button"
            disabled={isFinalizing}
            onClick={handleDownloadReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            aria-label="Finish session and download report"
          >
            <FileDown className="w-4 h-4" />
            {isFinalizing ? "Generating..." : "Report"}
          </button>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 pb-36 space-y-3">
        {messages.length === 0 && <WelcomeScreen />}
        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={
              isLoading &&
              idx === messages.length - 1 &&
              msg.role === "assistant"
            }
          />
        ))}
        {pendingEstimate && (
          <div className="px-1">
            <FixoEstimateCard data={pendingEstimate} />
          </div>
        )}
        {currentTool && <ToolIndicator tool={currentTool} />}
        {error && !isUpgradeError && (
          <div className="text-center text-sm text-red-500 py-2">{error}</div>
        )}
        {reportError && (
          <div className="text-center text-sm text-red-500 py-2">
            {reportError}
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        isLoading={isLoading}
        inputRef={inputRef}
        onCameraClick={() => setShowCamera(true)}
        onMicClick={() => setShowAudioRecorder(true)}
        onObdClick={() => setShowObdInput(true)}
        onFilePick={handleFilePick}
      />

      {/* Camera overlay */}
      {showCamera && (
        <CameraCapture
          onCapture={handlePhotoCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Audio recorder */}
      {showAudioRecorder && (
        <AudioRecorder
          onSend={handleAudioSend}
          onClose={() => setShowAudioRecorder(false)}
        />
      )}

      {/* OBD input */}
      {showObdInput && (
        <ObdInput
          onSubmit={handleObdSubmit}
          onClose={() => setShowObdInput(false)}
        />
      )}

      {/* Upgrade modal */}
      {upgradeMessage && (
        <UpgradeModal
          message={upgradeMessage}
          onClose={() => setUpgradeMessage(null)}
        />
      )}
    </div>
  );
}
