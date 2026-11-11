#!/usr/bin/env bash
# Local dev inside the Claude cloud sandbox: drop the environment's own DATABASE_URL /
# OPENROUTER_API_KEY / AWS_* so .env.local wins, and route Node fetch through the proxy.
# ALLOWED_EMAILS_OVERRIDE replaces the allowlist for this run (e.g. a throwaway test account).
cd "$(dirname "$0")/.."
extra=()
[ -n "$ALLOWED_EMAILS_OVERRIDE" ] && extra+=("ALLOWED_EMAILS=$ALLOWED_EMAILS_OVERRIDE")
exec env -u DATABASE_URL -u OPENROUTER_API_KEY -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  "${extra[@]}" NODE_USE_ENV_PROXY=1 SUPERTONIC_DIR="${SUPERTONIC_DIR:-$HOME/.cache/supertonic3}" \
  npx next dev -p "${PORT:-3000}"
