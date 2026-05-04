"use client";

import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileDown,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { AGENT_URL } from "@/lib/config";
import { downloadReportPdf } from "@/lib/download-report";

interface FixoSession {
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
  // Vercel-style: thin border + tinted background. Earth tones are kept (red /
  // amber / green) for semantic meaning, but at lower saturation than before.
  switch (severity) {
    case "critical":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400";
    case "high":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-400";
    case "medium":
      return "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-400";
    case "low":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "complete":
      return (
        <CheckCircle
          className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500"
          strokeWidth={2}
        />
      );
    case "processing":
    case "pending":
      return (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      );
    case "failed":
      return (
        <AlertTriangle
          className="h-3.5 w-3.5 text-red-600 dark:text-red-500"
          strokeWidth={2}
        />
      );
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
  const [sessions, setSessions] = useState<FixoSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) return;

    async function fetchSessions() {
      try {
        const res = await fetch(`${AGENT_URL}/sessions`, {
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

  const handleDownload = useCallback(
    async (sessionId: number) => {
      if (!session?.access_token || downloading !== null) return;
      setDownloadError(null);
      setDownloading(sessionId);
      try {
        // @ts-expect-error history page being deleted in Task 3.7
        await downloadReportPdf(sessionId, session.access_token);
      } catch (e) {
        setDownloadError(e instanceof Error ? e.message : String(e));
      } finally {
        setDownloading(null);
      }
    },
    [session?.access_token, downloading],
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/95 px-4 backdrop-blur-md">
        <h1 className="text-[15px] font-semibold tracking-tight">History</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
              <Clock className="h-5 w-5 text-foreground" strokeWidth={1.75} />
            </div>
            <h2 className="mb-1.5 text-base font-semibold tracking-tight">
              No diagnostics yet
            </h2>
            <p className="mb-6 max-w-xs text-[13px] text-muted-foreground">
              Start a chat to diagnose your first vehicle issue.
            </p>
            <Link
              href="/chat"
              className="inline-flex items-center justify-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Start diagnostic
            </Link>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-2">
            {downloadError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
                {downloadError}
              </div>
            )}
            {sessions.map((s) => {
              const canDownload = s.status === "complete" && s.result !== null;
              const isDownloading = downloading === s.id;
              return (
                <div
                  key={s.id}
                  className="overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border-hover"
                >
                  <Link
                    href={`/chat?session=${s.id}`}
                    className="block px-4 py-3.5"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        {statusIcon(s.status)}
                        <span className="text-xs font-medium capitalize text-foreground">
                          {s.status}
                        </span>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatDate(s.createdAt)}
                      </span>
                    </div>
                    {s.result?.summary && (
                      <p className="line-clamp-2 mb-2 text-[13px] leading-relaxed text-muted-foreground">
                        {s.result.summary}
                      </p>
                    )}
                    {s.result?.overallSeverity && (
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${severityColor(s.result.overallSeverity)}`}
                      >
                        {s.result.overallSeverity}
                      </span>
                    )}
                  </Link>
                  {canDownload && (
                    <div className="flex justify-end border-t border-border px-3 py-1.5">
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={() => handleDownload(s.id)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`Download report for session ${s.id}`}
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        {isDownloading ? "Downloading…" : "Download report"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
