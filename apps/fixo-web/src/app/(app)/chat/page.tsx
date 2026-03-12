"use client";

import { Car, FileDown } from "lucide-react";
import { redirect } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ToolIndicator } from "@/components/chat/ToolIndicator";
import { AudioRecorder } from "@/components/media/AudioRecorder";
import { CameraCapture } from "@/components/media/CameraCapture";
import { ObdInput } from "@/components/media/ObdInput";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useAgentChat } from "@/hooks/useAgentChat";
import type { AudioRecording } from "@/hooks/useAudioRecorder";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001";

function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-12">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Car className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold mb-2">AI Vehicle Diagnostic</h2>
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

  const { messages, isLoading, sendMessage, currentTool, error, clearError } =
    useAgentChat({
      scrollRef,
      inputRef,
      accessToken: session?.access_token,
    });

  const handleDownloadReport = useCallback(
    async (sessionId: number) => {
      if (!session?.access_token) return;
      const agentUrl =
        process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001";
      const res = await fetch(`${agentUrl}/diagnostics/${sessionId}/report`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Fixo-Report-${sessionId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [session?.access_token],
  );

  const handleAudioSend = useCallback(
    async (recording: AudioRecording) => {
      if (!session?.access_token) return;

      // Create a session if we don't have one
      if (!sessionIdRef.current) {
        const res = await fetch(`${AGENT_URL}/diagnostics`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          sendMessage("[Audio recording failed to upload]");
          return;
        }
        const data = await res.json();
        sessionIdRef.current = data.sessionId;
      }

      // POST audio + spectrogram to the input endpoint
      const res = await fetch(
        `${AGENT_URL}/diagnostics/${sessionIdRef.current}/input`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "audio",
            content: recording.base64,
            spectrogramBase64: recording.spectrogramBase64,
            filename: `recording-${Date.now()}.webm`,
            contentType: "audio/webm",
            durationSeconds: recording.durationSeconds,
          }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        sendMessage(
          `[Audio recording: ${recording.durationSeconds}s] Analyze this engine/vehicle sound.`,
        );
        if (data.response) {
          // The backend already ran analysis — show the response in chat
          void data.response;
        }
      } else {
        sendMessage("[Audio upload failed — please try again]");
      }
    },
    [session?.access_token, sendMessage],
  );

  const handlePhotoCapture = useCallback(
    async (dataUrl: string) => {
      if (!session?.access_token) return;

      const base64 = dataUrl.split(",")[1];

      // Create a session if we don't have one
      if (!sessionIdRef.current) {
        const res = await fetch(`${AGENT_URL}/diagnostics`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          sendMessage("[Photo upload failed]");
          return;
        }
        const data = await res.json();
        sessionIdRef.current = data.sessionId;
      }

      // Upload to backend
      const res = await fetch(
        `${AGENT_URL}/diagnostics/${sessionIdRef.current}/input`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "photo",
            content: base64,
            filename: `photo-${Date.now()}.jpg`,
            contentType: "image/jpeg",
          }),
        },
      );

      if (res.ok) {
        sendMessage(
          "[Photo attached] Analyze this image for vehicle diagnostics.",
          { imageUrl: dataUrl },
        );
      } else {
        sendMessage("[Photo upload failed — please try again]");
      }
    },
    [session?.access_token, sendMessage],
  );

  const handleFilePick = useCallback(
    (file: File) => {
      if (!session?.access_token) return;

      // Reject files over 10MB
      if (file.size > 10 * 1024 * 1024) {
        sendMessage("[Photo too large — maximum 10MB]");
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];

        // Create session if needed
        if (!sessionIdRef.current) {
          const res = await fetch(`${AGENT_URL}/diagnostics`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
          });
          if (!res.ok) {
            sendMessage("[Photo upload failed]");
            return;
          }
          const data = await res.json();
          sessionIdRef.current = data.sessionId;
        }

        // Upload
        const res = await fetch(
          `${AGENT_URL}/diagnostics/${sessionIdRef.current}/input`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "photo",
              content: base64,
              filename: file.name,
              contentType: file.type || "image/jpeg",
            }),
          },
        );

        if (res.ok) {
          sendMessage(
            "[Photo attached] Analyze this image for vehicle diagnostics.",
            { imageUrl: dataUrl },
          );
        } else {
          sendMessage("[Photo upload failed — please try again]");
        }
      };
      reader.readAsDataURL(file);
    },
    [session?.access_token, sendMessage],
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

  if (isUpgradeError && !upgradeMessage) {
    setUpgradeMessage(error);
    clearError();
  }

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
        <h1 className="text-lg font-semibold">AI Diagnostic</h1>
        {messages.length > 0 && !isLoading && (
          <button
            type="button"
            onClick={() => handleDownloadReport(1)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
            aria-label="Download report"
          >
            <FileDown className="w-4 h-4" />
            Report
          </button>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 pb-36 space-y-3">
        {messages.length === 0 && <WelcomeScreen />}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
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
