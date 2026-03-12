import { createHmlsApp } from "./hmls-app.ts";
import { createDiagnosticApp } from "./fixo-app.ts";

// ── Fail fast on required env vars ──
const DATABASE_URL = Deno.env.get("DATABASE_URL");
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required but not set");
}
if (!GOOGLE_API_KEY) {
  throw new Error("GOOGLE_API_KEY is required but not set");
}

// Warn on optional vars
for (
  const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
  ]
) {
  if (!Deno.env.get(key)) {
    console.warn(`[config] Optional env var ${key} is not set`);
  }
}

const mainApp = createHmlsApp({ googleApiKey: GOOGLE_API_KEY });
const diagApp = createDiagnosticApp();

// ── Subdomain dispatch ──
const DIAG_HOSTS = ["api.diag.hmls.autos", "diag.localhost"];

function handler(request: Request): Response | Promise<Response> {
  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (DIAG_HOSTS.includes(host)) {
    return diagApp.fetch(request);
  }

  // Path-based routing: /diag/* → diagnostic app (strip prefix)
  const url = new URL(request.url);
  if (url.pathname === "/diag" || url.pathname.startsWith("/diag/")) {
    const newPath = url.pathname.slice("/diag".length) || "/";
    const newUrl = new URL(newPath + url.search, url.origin);
    return diagApp.fetch(new Request(newUrl, request));
  }

  return mainApp.fetch(request);
}

// Start server
const isDenoDeploy = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;
if (isDenoDeploy) {
  Deno.serve(handler);
  console.log(`[server] HMLS API running on Deno Deploy`);
} else {
  const port = Number(Deno.env.get("HTTP_PORT")) || 8080;
  Deno.serve({ port }, handler);
  console.log(`[server] HMLS API running on http://localhost:${port}`);
  console.log(`[server] Diagnostic API available at http://diag.localhost:${port}`);
}
