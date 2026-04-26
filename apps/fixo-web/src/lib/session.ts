"use client";

import type { MutableRefObject } from "react";

import { AGENT_URL } from "@/lib/config";

const inFlight = new WeakMap<
  MutableRefObject<number | null>,
  Promise<number | null>
>();

/**
 * Resolve the current Fixo session id, lazily creating one on the gateway if
 * none exists. Concurrent callers share the same in-flight promise so we
 * never POST /sessions twice for the same ref.
 */
export async function ensureSession(
  accessToken: string,
  sessionIdRef: MutableRefObject<number | null>,
): Promise<number | null> {
  if (sessionIdRef.current) return sessionIdRef.current;

  const existing = inFlight.get(sessionIdRef);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(`${AGENT_URL}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sessionId: number };
    sessionIdRef.current = data.sessionId;
    return data.sessionId;
  })();

  inFlight.set(sessionIdRef, promise);
  void promise.finally(() => inFlight.delete(sessionIdRef));
  return promise;
}
