import type { NextRequest } from "next/server";

export const runtime = "edge";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "https://api.hmls.autos";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const authorization = req.headers.get("Authorization");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authorization) {
      headers.Authorization = authorization;
    }

    const upstream = await fetch(`${GATEWAY_URL}/task`, {
      method: "POST",
      headers,
      body,
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(errText || `Upstream error: ${upstream.status}`, {
        status: upstream.status,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Proxy the streaming response back to the client
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        "x-vercel-ai-ui-message-stream":
          upstream.headers.get("x-vercel-ai-ui-message-stream") ?? "v1",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "proxy_error", message, gateway: GATEWAY_URL }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
