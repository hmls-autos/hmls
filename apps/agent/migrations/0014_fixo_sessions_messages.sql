-- Add a `messages` jsonb column to fixo_sessions so the agent can persist the
-- UIMessage[] transcript per session.
--
-- Why: chat history was browser-local (localStorage). That's fine for a single
-- device but loses history on cache clear and prevents cross-device resume.
-- The /task chat endpoint now writes the merged input+response messages to
-- this column on each turn (only when sessionId is supplied — sessions are
-- still created lazily by media upload / Report click to preserve free-tier
-- quota semantics).
--
-- Nullable on purpose: text-only chats that never trigger an upload or a
-- Report click never create a session row, so older rows and brand-new
-- sessions both legitimately have no transcript yet.

ALTER TABLE public.fixo_sessions
  ADD COLUMN IF NOT EXISTS messages jsonb;
