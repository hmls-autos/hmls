// Production URL is hardcoded; only override for local dev via .env.local
export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL || "https://api.hmls.autos";
