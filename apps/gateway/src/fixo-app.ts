import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { AppError } from "@hmls/shared/errors";
import { type AuthContext, authenticateRequest } from "./middleware/diagnostic/auth.ts";
import { sessions } from "./routes/diagnostic/sessions.ts";
import { input } from "./routes/diagnostic/input.ts";
import { chat } from "./routes/diagnostic/chat.ts";
import { billing, webhookHandler } from "./routes/diagnostic/billing.ts";
import { reports } from "./routes/diagnostic/reports.ts";
import { vehicleRoutes } from "./routes/diagnostic/vehicles.ts";

const DEV_MODE = Deno.env.get("DEV_MODE") === "true";

export function createDiagnosticApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // CORS — diagnostic origins only
  app.use(
    "*",
    cors({
      origin: [
        "https://diag.hmls.autos",
        "http://localhost:3001",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use("*", logger());

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof AppError) {
      console.error(`[diagnostic] ${err.code}: ${err.message}`);
      return c.json(
        err.toJSON(),
        err.status as 400 | 401 | 403 | 404 | 422 | 500 | 502,
      );
    }
    console.error(`[diagnostic] Unhandled:`, err);
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
    return c.json({
      status: "ok",
      service: "diagnostic",
      timestamp: new Date().toISOString(),
    });
  });

  // deno-lint-ignore no-explicit-any -- Hono middleware type compatibility
  const requireAuth = async (c: any, next: any) => {
    const authResult = await authenticateRequest(c.req.raw);
    if (authResult instanceof Response) return authResult;
    c.set("auth", authResult);
    await next();
  };

  app.use("/diagnostics/*", requireAuth);
  app.use("/billing/checkout", requireAuth);
  app.use("/billing/portal", requireAuth);
  app.use("/vehicles", requireAuth);
  app.use("/vehicles/*", requireAuth);
  // deno-lint-ignore require-await -- Hono middleware requires async signature
  app.use("/task", async (c, next) => {
    if (DEV_MODE) {
      console.log("[diagnostic] DEV_MODE: skipping auth");
      return next();
    }
    return requireAuth(c, next);
  });

  // Mount routes
  app.route("/diagnostics", sessions);
  app.route("/diagnostics", input);
  app.route("/diagnostics", reports);
  app.route("/task", chat);
  app.route("/vehicles", vehicleRoutes);
  app.route("/billing", billing);
  app.route("/billing/webhook", webhookHandler);

  return app;
}
