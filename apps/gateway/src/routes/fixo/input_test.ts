import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { contentTypeMatches, input } from "./input.ts";
import type { AuthContext } from "../../middleware/fixo/auth.ts";

// These tests target the validation surface that runs BEFORE any DB or
// storage call. The smoke test (manual / Playwright E2E) covers the
// happy-path DB + Supabase integration.

function buildTestApp(auth: AuthContext): Hono<{ Variables: { auth: AuthContext } }> {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.use("*", async (c, next) => {
    c.set("auth", auth);
    await next();
  });
  app.route("/sessions", input);
  return app;
}

const PLUS_AUTH: AuthContext = {
  userId: "00000000-0000-0000-0000-000000000001",
  email: "test@example.com",
  tier: "plus",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

Deno.test("contentTypeMatches: photo accepts image/* only", () => {
  assertEquals(contentTypeMatches("photo", "image/jpeg"), true);
  assertEquals(contentTypeMatches("photo", "image/png"), true);
  assertEquals(contentTypeMatches("photo", "audio/webm"), false);
  assertEquals(contentTypeMatches("photo", "video/mp4"), false);
  assertEquals(contentTypeMatches("photo", "text/plain"), false);
});

Deno.test("contentTypeMatches: audio accepts audio/* only", () => {
  assertEquals(contentTypeMatches("audio", "audio/webm"), true);
  assertEquals(contentTypeMatches("audio", "audio/mp3"), true);
  assertEquals(contentTypeMatches("audio", "image/png"), false);
});

Deno.test("contentTypeMatches: video accepts video/* only", () => {
  assertEquals(contentTypeMatches("video", "video/mp4"), true);
  assertEquals(contentTypeMatches("video", "video/quicktime"), true);
  assertEquals(contentTypeMatches("video", "image/png"), false);
});

Deno.test("input: rejects invalid session id (non-numeric)", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/abc/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "photo", content: "...", filename: "x.jpg" }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Invalid session id");
});

Deno.test("input: rejects negative session id", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/-1/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "photo", content: "...", filename: "x.jpg" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("input: rejects malformed JSON body", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/1/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not valid json",
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Invalid JSON body");
});

Deno.test("input: rejects type='text' (no longer accepted)", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/1/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "text", content: "hi" }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Invalid input type");
});

Deno.test("input: rejects unknown type", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/1/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "screenshot", content: "..." }),
  });
  assertEquals(res.status, 400);
});

Deno.test("input: rejects photo with missing content", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/1/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "photo",
      filename: "x.jpg",
      contentType: "image/jpeg",
    }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Media content is required");
});

Deno.test("input: rejects photo with audio contentType", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/1/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "photo",
      content: "abc",
      filename: "x.jpg",
      contentType: "audio/webm",
    }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "contentType audio/webm does not match input type photo");
});

Deno.test("input: rejects obd with empty code", async () => {
  const app = buildTestApp(PLUS_AUTH);
  const res = await app.request("/sessions/1/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "obd", content: "   " }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "OBD code is required");
});
