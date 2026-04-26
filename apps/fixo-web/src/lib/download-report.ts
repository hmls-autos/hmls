"use client";

import { AGENT_URL } from "@/lib/config";

/**
 * Download an already-finalized session's PDF report. Caller is responsible
 * for ensuring the session is complete (status='complete', result non-null);
 * the gateway returns 400 "Session has no result yet" otherwise.
 *
 * Used by the chat page (after /complete) and the history page (on
 * already-finalized sessions). Server-side, this is a stateless read of
 * fixoSessions.result rendered to PDF — no LLM call, no quota impact.
 */
export async function downloadReportPdf(
  sessionId: number,
  accessToken: string,
): Promise<void> {
  const res = await fetch(`${AGENT_URL}/sessions/${sessionId}/report`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(detail.error ?? "Failed to generate report PDF");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Fixo-Report-${sessionId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
