import { Hono } from "hono";
import { cors } from "hono/cors";
import { getLogger } from "@logtape/logtape";
import { AppError } from "@hmls/shared/errors";
import { requestContext } from "./middleware/request-context.ts";
import { estimates } from "./routes/estimates.ts";
import { portal } from "./routes/portal.ts";
import { admin } from "./routes/admin.ts";
import { adminMechanics } from "./routes/admin-mechanics.ts";
import { mechanic } from "./routes/mechanic.ts";
import { orders, ordersPdf } from "./routes/orders.ts";
import { chat } from "./routes/chat.ts";
import { staffChat } from "./routes/staff-chat.ts";
import { createWebhookRoute } from "./routes/webhook.ts";

const logger = getLogger(["hmls", "gateway", "app"]);

// ─── Sub-app composition ──────────────────────────────────────────────────
// Each sub-app's prefix matches its auth boundary and the web's route group:
//   /api/admin/*    → adminApp    → app/(admin)/*
//   /api/portal/*   → portalApp   → app/(portal)/*
//   /api/mechanic/* → mechanicApp → app/(mechanic)/*

const adminApp = new Hono()
  .route("/", admin)
  .route("/orders", orders)
  .route("/mechanics", adminMechanics);

const portalApp = portal;
const mechanicApp = mechanic;

export function createHmlsApp() {
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
      // X-Shop-Id: owner shop-switcher sends it from the browser; without it
      // the CORS preflight blocks every owner admin request.
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Shop-Id"],
      exposeHeaders: ["X-Request-Id"],
    }),
  );
  app.use("*", requestContext);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      logger.warn("AppError {code}: {message}", {
        code: err.code,
        message: err.message,
        status: err.status,
      });
      return c.json(
        err.toJSON(),
        err.status as 400 | 401 | 403 | 404 | 422 | 500 | 502,
      );
    }
    logger.error("Unhandled error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
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

  // Mounted unconditionally: on workerd, createHmlsApp() runs at module init
  // where env() can't resolve yet (C3 in docs/cloudflare-migration.md). The
  // route re-checks the Stripe keys per request and 500s if unconfigured.
  app.route("/webhook", createWebhookRoute());

  app.route("/api/estimates", estimates);
  app.route("/api/orders", ordersPdf);
  app.route("/api/admin", adminApp);
  app.route("/api/portal", portalApp);
  app.route("/api/mechanic", mechanicApp);
  app.route("/api/chat", chat);
  app.route("/api/admin/chat", staffChat);

  return app;
}
