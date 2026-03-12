"use client";

import { Mic, Send, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  type AudioRecording,
  useAudioRecorder,
} from "@/hooks/useAudioRecorder";

interface AudioRecorderProps {
  onSend: (recording: AudioRecording) => void;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Waveform({ data }: { data: Uint8Array | null }) {
  if (!data) return null;

  const bars = 32;
  const step = Math.floor(data.length / bars);
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    const val = data[i * step] || 128;
    heights.push(Math.max(4, Math.abs(val - 128) * 0.6));
  }

  return (
    <div className="flex items-center justify-center gap-0.5 h-12">
      {heights.map((h, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: waveform bars are position-based
          key={i}
          className="w-1 bg-primary rounded-full transition-all duration-75"
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
}

export function AudioRecorder({ onSend, onClose }: AudioRecorderProps) {
  const { isRecording, isProcessing, duration, analyserData, startRecording, stopRecording } =
    useAudioRecorder();
  const [recording, setRecording] = useState<AudioRecording | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    try {
      setError(null);
      await startRecording();
    } catch {
      setError("Could not access microphone. Please check permissions.");
    }
  };

  const handleStop = async () => {
    const result = await stopRecording();
    setRecording(result);
  };

  const handleSend = () => {
    if (recording) {
      onSend(recording);
      onClose();
    }
  };

  const handleDiscard = () => {
    setRecording(null);
  };

  if (error) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border rounded-t-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <p className="text-center text-sm text-red-500 mb-4">{error}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-surface-alt text-text font-medium"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border rounded-t-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {/* Duration */}
      <p className="text-center text-2xl font-mono font-semibold mb-4">
        {formatDuration(recording?.durationSeconds ?? duration)}
      </p>

      {/* Waveform */}
      {isRecording && <Waveform data={analyserData} />}

      {/* Processing spinner */}
      {isProcessing && (
        <div className="flex flex-col items-center gap-2 mb-4">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-text-secondary">Analyzing sound...</p>
        </div>
      )}

      {/* Preview audio + spectrogram */}
      {recording && (
        <div className="flex flex-col items-center gap-3 mb-4">
          <img
            src={`data:image/png;base64,${recording.spectrogramBase64}`}
            alt="Sound spectrogram"
            className="w-full max-w-sm rounded-lg border border-border"
          />
          {/* biome-ignore lint/a11y/useMediaCaption: user-recorded audio preview, no captions needed */}
          <audio
            controls
            src={URL.createObjectURL(recording.blob)}
            className="w-full max-w-xs"
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 mt-4">
        {!isRecording && !recording && (
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 rounded-full bg-surface-alt text-text-secondary font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStart}
              className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white"
              aria-label="Start recording"
            >
              <Mic className="w-7 h-7" />
            </button>
            <div className="w-20" />
          </>
        )}

        {isRecording && (
          <button
            type="button"
            onClick={handleStop}
            className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white animate-pulse"
            aria-label="Stop recording"
          >
            <Square className="w-6 h-6" />
          </button>
        )}

        {recording && (
          <>
            <button
              type="button"
              onClick={handleDiscard}
              className="p-3 rounded-full bg-surface-alt text-text-secondary"
              aria-label="Discard"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleSend}
              className="px-6 py-3 rounded-full bg-primary text-white font-medium flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Send
            </button>
          </>
        )}
      </div>
    </div>
  );
}
