"use client";

import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface UpgradeModalProps {
  message: string;
  onClose: () => void;
}

export function UpgradeModal({ message, onClose }: UpgradeModalProps) {
  const { session } = useAuth();

  const handleUpgrade = async () => {
    if (!session) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001"}/billing/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            successUrl: `${window.location.origin}/chat?upgraded=true`,
            cancelUrl: `${window.location.origin}/chat`,
          }),
        },
      );
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface rounded-2xl p-6 max-w-sm w-full shadow-xl">
        <div className="flex justify-between items-start mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-text"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <h2 className="text-lg font-semibold mb-2">Upgrade to Plus</h2>
        <p className="text-text-secondary text-sm mb-4">{message}</p>

        <ul className="space-y-2 mb-6 text-sm">
          <li className="flex items-center gap-2">
            <span className="text-primary">+</span> Unlimited diagnoses
          </li>
          <li className="flex items-center gap-2">
            <span className="text-primary">+</span> Photo, audio, video & OBD
          </li>
          <li className="flex items-center gap-2">
            <span className="text-primary">+</span> PDF diagnostic reports
          </li>
        </ul>

        <button
          type="button"
          onClick={handleUpgrade}
          className="w-full bg-primary text-white font-medium py-3 rounded-xl hover:bg-primary-hover transition-colors mb-2"
        >
          Upgrade — $19.99/mo
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full text-text-secondary text-sm py-2 hover:text-text"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
