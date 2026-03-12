"use client";

import { Camera, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useCamera } from "@/hooks/useCamera";

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const {
    videoRef,
    isActive,
    startCamera,
    capturePhoto,
    stopCamera,
    switchCamera,
  } = useCamera();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    startCamera().catch(() => {
      setError("Could not access camera. Please check permissions.");
    });
    return () => stopCamera();
  }, []);

  const handleCapture = () => {
    const photo = capturePhoto();
    if (photo) {
      setPreview(photo);
    }
  };

  const handleSend = () => {
    if (preview) {
      onCapture(preview);
      stopCamera();
      onClose();
    }
  };

  const handleRetake = () => {
    setPreview(null);
  };

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-white p-6">
        <p className="text-center mb-4">{error}</p>
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2 bg-surface-alt rounded-full"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Close button */}
      <button
        type="button"
        onClick={() => {
          stopCamera();
          onClose();
        }}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white"
        aria-label="Close camera"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Preview or live video */}
      {preview ? (
        <div className="flex-1 flex items-center justify-center">
          {/* biome-ignore lint/performance/noImgElement: data URL from camera capture, not a static asset */}
          <img
            src={preview}
            alt="Captured"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Controls */}
      <div className="pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4 px-4 flex items-center justify-center gap-8">
        {preview ? (
          <>
            <button
              type="button"
              onClick={handleRetake}
              className="px-6 py-3 rounded-full bg-white/20 text-white font-medium"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={handleSend}
              className="px-6 py-3 rounded-full bg-primary text-white font-medium"
            >
              Send Photo
            </button>
          </>
        ) : (
          <>
            <div className="w-12" />
            <button
              type="button"
              onClick={handleCapture}
              disabled={!isActive}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-50"
              aria-label="Take photo"
            >
              <Camera className="w-7 h-7 text-white" />
            </button>
            <button
              type="button"
              onClick={switchCamera}
              className="p-3 rounded-full bg-white/20 text-white"
              aria-label="Switch camera"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
