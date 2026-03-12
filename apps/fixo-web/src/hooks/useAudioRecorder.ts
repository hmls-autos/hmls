"use client";

import { useCallback, useRef, useState } from "react";
import { generateSpectrogram } from "@/lib/spectrogram";

export interface AudioRecording {
  blob: Blob;
  base64: string;
  durationSeconds: number;
  spectrogramBase64: string;
  spectrogramBlob: Blob;
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [analyserData, setAnalyserData] = useState<Uint8Array | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const updateAnalyser = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(data);
    setAnalyserData(new Uint8Array(data));
    animFrameRef.current = requestAnimationFrame(updateAnalyser);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up analyser for waveform
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);

      updateAnalyser();
    } catch (err) {
      console.error("Failed to access microphone:", err);
      throw err;
    }
  }, [updateAnalyser]);

  const stopRecording = useCallback((): Promise<AudioRecording> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) throw new Error("No active recording");

      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];

          // Generate spectrogram from audio
          setIsProcessing(true);
          try {
            const spectrogram = await generateSpectrogram(blob);
            resolve({
              blob,
              base64,
              durationSeconds: duration,
              spectrogramBase64: spectrogram.base64,
              spectrogramBlob: spectrogram.blob,
            });
          } catch (err) {
            reject(err);
          } finally {
            setIsProcessing(false);
          }
        };
        reader.readAsDataURL(blob);

        // Clean up stream
        streamRef.current?.getTracks().forEach((t) => {
          t.stop();
        });
        streamRef.current = null;
      };

      recorder.stop();
      setIsRecording(false);
      setAnalyserData(null);
      analyserRef.current = null;
    });
  }, [duration]);

  const cancelRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
    setIsRecording(false);
    setDuration(0);
    setAnalyserData(null);
    analyserRef.current = null;
    chunksRef.current = [];
  }, []);

  return {
    isRecording,
    isProcessing,
    duration,
    analyserData,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
