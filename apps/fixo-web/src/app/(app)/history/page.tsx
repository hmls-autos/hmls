"use client";

import { AlertTriangle, CheckCircle, Clock, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001";

interface DiagnosticSession {
  id: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  result: {
    summary?: string;
    overallSeverity?: string;
  } | null;
}

function severityColor(severity?: string) {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    case "high":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "medium":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "low":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "complete":
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case "processing":
    case "pending":
      return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    case "failed":
      return <AlertTriangle className="w-4 h-4 text-red-500" />;
    default:
      return null;
  }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export default function HistoryPage() {
  const { session } = useAuth();
  const [sessions, setSessions] = useState<DiagnosticSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.access_token) return;

    async function fetchSessions() {
      try {
        const res = await fetch(`${AGENT_URL}/diagnostics`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions ?? []);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }

    fetchSessions();
  }, [session?.access_token]);

  return (
    <div className="flex flex-col h-dvh">
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-sm border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">History</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Clock className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">No diagnostics yet</h2>
            <p className="text-text-secondary text-sm max-w-xs mb-6">
              Start a chat to diagnose your first vehicle issue.
            </p>
            <Link
              href="/chat"
              className="px-6 py-2.5 rounded-xl bg-primary text-white font-medium"
            >
              Start Diagnostic
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/chat?session=${s.id}`}
                className="block bg-surface-alt rounded-xl p-4 border border-border hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {statusIcon(s.status)}
                    <span className="text-sm font-medium capitalize">
                      {s.status}
                    </span>
                  </div>
                  <span className="text-xs text-text-secondary">
                    {formatDate(s.createdAt)}
                  </span>
                </div>
                {s.result?.summary && (
                  <p className="text-sm text-text-secondary line-clamp-2 mb-2">
                    {s.result.summary}
                  </p>
                )}
                {s.result?.overallSeverity && (
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${severityColor(s.result.overallSeverity)}`}
                  >
                    {s.result.overallSeverity}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
