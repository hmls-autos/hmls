"use client";

import { Car } from "lucide-react";
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

  const { handleAudioSend, handlePhotoCapture, handleFilePick } =
    useMediaUpload({
      accessToken: session?.access_token,
      sessionIdRef,
      sendMessage,
    });

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
        {/* Report button hidden until Bug B PR populates fixoSessions.result.
            Tapping it today returns 400 from /sessions/:id/report. See
            TODOS.md → "Bug B" for the design conversation. */}
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
