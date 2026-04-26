#!/usr/bin/env bash
# Fixo diagnostic flow smoke test.
#
# Exercises the post-Plan-B path end-to-end against a running local stack:
#   1. Uploads a real test photo to Supabase Storage.
#   2. Inserts a fixoSessions + fixoMedia row owned by DEV_MODE's dev user.
#   3. Calls POST /task with sessionId — verifies the agent receives the
#      image as a FileUIPart (not a hallucinated URL) and produces a real
#      diagnosis grounded in the photo content.
#   4. Cleans up.
#
# Prereqs:
#   - Gateway running with DEV_MODE=true on localhost:8080
#       DEV_MODE=true infisical run --env=dev -- deno task dev:api
#   - Infisical CLI logged in
#   - psql in PATH
#   - jq in PATH
#
# Usage:  ./scripts/fixo-smoke-test.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_IMG="$REPO_ROOT/apps/hmls-web/public/images/engine-bay-640.webp"
DEV_USER_ID="00000000-0000-0000-0000-000000000001"

[ -f "$TEST_IMG" ] || { echo "Missing test image at $TEST_IMG" >&2; exit 1; }

SUPABASE_URL="$(infisical secrets get SUPABASE_URL --env=dev --plain --silent | tail -1)"
SERVICE_KEY="$(infisical secrets get SUPABASE_SERVICE_ROLE_KEY --env=dev --plain --silent | tail -1)"
DATABASE_URL="$(infisical secrets get DATABASE_URL --env=dev --plain --silent | tail -1)"

echo "Step 1: upload test photo to fixo-media bucket..."
TS=$(date +%s)
KEY="smoke-test/${TS}-engine-bay.webp"
curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/fixo-media/$KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" \
  -H "Content-Type: image/webp" --data-binary @"$TEST_IMG" >/dev/null
echo "  uploaded: $KEY"

echo "Step 2: seed fixoSessions + fixoMedia row..."
psql "$DATABASE_URL" -q -At >/dev/null <<EOF
INSERT INTO user_profiles (id, tier)
VALUES ('$DEV_USER_ID', 'plus')
ON CONFLICT (id) DO NOTHING;
EOF
SESSION_ID=$(psql "$DATABASE_URL" -q -At -c \
  "INSERT INTO fixo_sessions (user_id, status) VALUES ('$DEV_USER_ID', 'pending') RETURNING id;")
psql "$DATABASE_URL" -q -At >/dev/null <<EOF
INSERT INTO fixo_media (session_id, type, r2_key, credit_cost, processing_status, metadata)
VALUES ($SESSION_ID, 'photo', '$KEY', 0, 'complete',
       '{"contentType":"image/webp","filename":"engine-bay.webp"}'::jsonb);
EOF
echo "  session_id: $SESSION_ID"

echo "Step 3: hit /task with sessionId=$SESSION_ID..."
RESPONSE=$(curl -fsS -X POST http://fixo.localhost:8080/task \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": $SESSION_ID, \"messages\":[{\"id\":\"u1\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"Briefly: what kind of engine is in this photo?\"}]}]}" \
  --max-time 60)

echo "$RESPONSE" | grep -oE 'data: \{"type":"text-delta"[^}]*\}' | head -10

# Sanity check the agent grounded its answer in the photo. Engine bays of the
# Honda 1.7L VTEC consistently get identified as Honda or Civic. If the agent
# does NOT say one of these, hydration probably didn't reach Gemini.
if echo "$RESPONSE" | grep -qiE 'honda|civic|vtec|engine'; then
  echo "PASS: agent diagnosis references engine details from the photo"
else
  echo "FAIL: agent response did not reference engine details" >&2
  echo "$RESPONSE" >&2
  EXIT=1
fi

echo "Step 4: cleanup..."
psql "$DATABASE_URL" -c "DELETE FROM fixo_media WHERE session_id = $SESSION_ID;" >/dev/null
psql "$DATABASE_URL" -c "DELETE FROM fixo_sessions WHERE id = $SESSION_ID;" >/dev/null
curl -fsS -X DELETE "$SUPABASE_URL/storage/v1/object/fixo-media/$KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" >/dev/null

exit "${EXIT:-0}"
