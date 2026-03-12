#!/bin/bash
# PreToolUse hook: block deployctl, enforce deno deploy
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE '(^|\s|/)deployctl(\s|$)'; then
  echo '{"decision":"block","reason":"Do not use deployctl (deprecated). Use `deno deploy` instead."}'
else
  echo '{"decision":"approve"}'
fi
