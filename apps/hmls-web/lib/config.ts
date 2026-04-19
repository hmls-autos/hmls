// Base URL for non-chat API calls (estimates, orders, etc.)
export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL ?? "https://api.hmls.autos";

// Always route chat through the same-origin proxy to fix iOS Safari SSE streaming.
// The proxy (app/api/chat/route.ts) forwards to GATEWAY_URL server-side.
// Local dev: set GATEWAY_URL=http://localhost:8080 in .env.local (server-side only).
export const CHAT_ENDPOINT = "/api/chat";
export const STAFF_CHAT_ENDPOINT = "/api/staff-chat";
