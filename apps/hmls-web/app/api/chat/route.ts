import type { NextRequest } from "next/server";

export const runtime = "edge";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "https://api.hmls.autos";

export async function POST(req: NextRequest) {
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
    return new Response(await upstream.text(), { status: upstream.status });
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
}
