"use client";

import { Camera, Cpu, ImagePlus, Mic, Send } from "lucide-react";
import { type RefObject, useRef, useState } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  onCameraClick?: () => void;
  onMicClick?: () => void;
  onObdClick?: () => void;
  onFilePick?: (file: File) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function ChatInput({
  onSend,
  isLoading,
  onCameraClick,
  onMicClick,
  onObdClick,
  onFilePick,
  inputRef,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isLoading) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div className="fixed bottom-14 left-0 right-0 z-40 bg-surface border-t border-border p-3">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 max-w-2xl mx-auto"
      >
        <button
          type="button"
          onClick={onCameraClick}
          className="p-2.5 rounded-full bg-surface-alt text-text-secondary hover:text-text transition-colors"
          aria-label="Take photo"
        >
          <Camera className="w-5 h-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && onFilePick) onFilePick(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 rounded-full bg-surface-alt text-text-secondary hover:text-text transition-colors"
          aria-label="Upload photo"
        >
          <ImagePlus className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onMicClick}
          className="p-2.5 rounded-full bg-surface-alt text-text-secondary hover:text-text transition-colors"
          aria-label="Record audio"
        >
          <Mic className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onObdClick}
          className="p-2.5 rounded-full bg-surface-alt text-text-secondary hover:text-text transition-colors"
          aria-label="Enter OBD code"
        >
          <Cpu className="w-5 h-5" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe your car problem..."
          disabled={isLoading}
          className="flex-1 bg-surface-alt rounded-full px-4 py-2.5 text-sm text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!value.trim() || isLoading}
          className="p-2.5 rounded-full bg-primary text-white disabled:opacity-30 transition-opacity"
          aria-label="Send message"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
