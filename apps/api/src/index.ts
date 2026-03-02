import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { AppError } from "@hmls/shared/errors";
import { estimates } from "./routes/estimates.ts";
import { portal } from "./routes/portal.ts";
import { admin } from "./routes/admin.ts";
import { orders } from "./routes/orders.ts";
import { chat, initChat } from "./routes/chat.ts";
import { createWebhookRoute } from "./routes/webhook.ts";

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
  const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SUPABASE_URL", "SUPABASE_ANON_KEY"]
) {
  if (!Deno.env.get(key)) {
    console.warn(`[config] Optional env var ${key} is not set`);
  }
}

// Read all env vars in one place
initChat({
  googleApiKey: GOOGLE_API_KEY,
  stripeSecretKey: Deno.env.get("STRIPE_SECRET_KEY") ?? "",
  agentModel: Deno.env.get("AGENT_MODEL"),
});

// Create Hono app
const app = new Hono();

// Middleware
app.use(
  "*",
  cors({
    origin: [
      "https://hmls.autos",
      "https://www.hmls.autos",
      "http://localhost:3000",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use("*", logger());

// Global error handler
app.onError((err, c) => {
  if (err instanceof AppError) {
    console.error(`[error] ${err.code}: ${err.message}`);
    return c.json(
      err.toJSON(),
      err.status as 400 | 401 | 403 | 404 | 422 | 500 | 502,
    );
  }
  console.error(`[error] Unhandled:`, err);
  return c.json({
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json(
    { error: { code: "NOT_FOUND", message: "Route not found" } },
    404,
  );
});

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount webhook route (no CORS — Stripe sends raw POST)
const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
if (stripeKey) {
  app.route("/webhook", createWebhookRoute(stripeKey));
}

// Mount routes
app.route("/api/estimates", estimates);
app.route("/api/portal", portal);
app.route("/api/admin", admin);
app.route("/api/admin/orders", orders);
app.route("/task", chat);

// Start server
const isDenoDeploy = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;
if (isDenoDeploy) {
  Deno.serve(app.fetch);
  console.log(`[server] HMLS Agent running on Deno Deploy`);
} else {
  const port = Number(Deno.env.get("HTTP_PORT")) || 8080;
  Deno.serve({ port }, app.fetch);
  console.log(`[server] HMLS Agent running on http://localhost:${port}`);
}
