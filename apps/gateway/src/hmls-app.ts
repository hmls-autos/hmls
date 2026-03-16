import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { AppError } from "@hmls/shared/errors";
import { estimates } from "./routes/estimates.ts";
import { portal } from "./routes/portal.ts";
import { admin } from "./routes/admin.ts";
import { orders, ordersPdf } from "./routes/orders.ts";
import { chat, initChat } from "./routes/chat.ts";
import { createWebhookRoute } from "./routes/webhook.ts";

interface HmlsAppOptions {
  googleApiKey: string;
}

export function createHmlsApp(options: HmlsAppOptions) {
  const { googleApiKey } = options;

  // Initialize chat agent config
  initChat({
    googleApiKey,
    stripeSecretKey: Deno.env.get("STRIPE_SECRET_KEY") ?? "",
    agentModel: Deno.env.get("AGENT_MODEL"),
  });

  const app = new Hono();

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

  app.notFound((c) => {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Route not found" } },
      404,
    );
  });

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (stripeKey) {
    app.route("/webhook", createWebhookRoute(stripeKey));
  }

  app.route("/api/estimates", estimates);
  app.route("/api/orders", ordersPdf);
  app.route("/api/portal", portal);
  app.route("/api/admin", admin);
  app.route("/api/admin/orders", orders);
  app.route("/task", chat);

  return app;
}
