-- Channel attribution + funnel telemetry for fixo推广 (CEO plan 2026-05-14).
-- Powers D5 kill criteria SQL queries (per-channel CTR, channel → paid
-- conversion). Distinct from fixo_message_events (which is credit-billing
-- per-AI-call).
--
-- Hand-written because drizzle-kit's journal (apps/agent/migrations/meta/
-- _journal.json) is out of sync with the actual on-disk migrations
-- (0017-0024 are not in the journal). Generating via `deno task db:generate`
-- prompts to rename existing enums, which is unsafe. The journal needs a
-- rebuild as separate work — tracked in TODOS.

CREATE TABLE "fixo_funnel_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "event_name" text NOT NULL,
  "channel" text NOT NULL,
  "channel_detail" text,
  "user_id" uuid,
  "session_id" integer,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "fixo_funnel_events" ADD CONSTRAINT "fixo_funnel_events_user_id_user_profiles_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "fixo_funnel_events" ADD CONSTRAINT "fixo_funnel_events_session_id_fixo_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "fixo_sessions"("id") ON DELETE set null ON UPDATE no action;

-- Composite index supports D5 kill criteria queries like:
--   SELECT count(*) FROM fixo_funnel_events
--   WHERE channel = 'hmls' AND event_name = 'paid_top_up'
--     AND created_at > now() - interval '7 days';
CREATE INDEX "idx_fixo_funnel_channel_event"
  ON "fixo_funnel_events" USING btree ("channel", "event_name", "created_at");

-- Per-user attribution lookups (e.g., "which channel did this user come from?")
CREATE INDEX "idx_fixo_funnel_user"
  ON "fixo_funnel_events" USING btree ("user_id", "created_at");
