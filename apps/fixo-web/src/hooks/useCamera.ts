"use client";

import { useCallback, useRef, useState } from "react";

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  const startCamera = useCallback(
    async (mode?: "environment" | "user") => {
      const facing = mode ?? facingMode;
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
        });
        setStream(mediaStream);
        setFacingMode(facing);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Failed to access camera:", err);
        throw err;
      }
    },
    [facingMode],
  );

  const capturePhoto = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach((t) => {
      t.stop();
    });
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  const switchCamera = useCallback(async () => {
    stopCamera();
    const newMode = facingMode === "environment" ? "user" : "environment";
    await startCamera(newMode);
  }, [facingMode, stopCamera, startCamera]);

  return {
    videoRef,
    stream,
    isActive: !!stream,
    startCamera,
    capturePhoto,
    stopCamera,
    switchCamera,
  };
}
