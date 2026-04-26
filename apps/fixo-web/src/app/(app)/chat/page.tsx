"use client";

import { Car, FileDown } from "lucide-react";
import { redirect } from "next/navigation";
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

export default function ChatPage() {
  const { session, isLoading: authLoading } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<number | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const [showObdInput, setShowObdInput] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

  const {
    messages,
    uiMessages,
    sessionId,
    isLoading,
    sendMessage,
    currentTool,
    pendingEstimate,
    error,
    clearError,
  } = useAgentChat({
    scrollRef,
    inputRef,
    accessToken: session?.access_token,
    sessionIdRef,
  });

  const [isFinalizing, setIsFinalizing] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const { handleAudioSend, handlePhotoCapture, handleFilePick } =
    useMediaUpload({
      accessToken: session?.access_token,
      sessionIdRef,
      sendMessage,
    });

  const handleDownloadReport = useCallback(
    async (sessionId: number) => {
      if (!session?.access_token || isFinalizing) return;
      setReportError(null);
      setIsFinalizing(true);
      try {
        // Finalize the session first: this calls generateObject server-side and
        // populates fixo_sessions.result + status='complete'. The chat history
        // lives in client state, so we must hand it to the server explicitly.
        const completeRes = await fetch(
          `${AGENT_URL}/sessions/${sessionId}/complete`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ messages: uiMessages }),
          },
        );
        if (!completeRes.ok) {
          const detail = await completeRes
            .json()
            .catch(() => ({ error: completeRes.statusText }));
          throw new Error(detail.error ?? "Failed to finalize session");
        }

        const reportRes = await fetch(
          `${AGENT_URL}/sessions/${sessionId}/report`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!reportRes.ok) {
          throw new Error("Failed to generate report PDF");
        }
        const blob = await reportRes.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Fixo-Report-${sessionId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setReportError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsFinalizing(false);
      }
    },
    [session?.access_token, uiMessages, isFinalizing],
  );

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

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Fixo<span className="text-primary">.</span>
        </h1>
        {messages.length > 0 && !isLoading && sessionId !== null && (
          <button
            type="button"
            disabled={isFinalizing}
            onClick={() => handleDownloadReport(sessionId)}
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
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
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
