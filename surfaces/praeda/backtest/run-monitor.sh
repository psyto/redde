#!/usr/bin/env bash
# Standing peg-pool monitor — run on a schedule. Reads ETH_RPC_URL from ./.env (gitignored).
set -uo pipefail
cd "$(dirname "$0")"
# launchd/cron give a minimal PATH — make node resolvable (nvm/homebrew/system).
export PATH="/Users/hiroyusai/.nvm/versions/node/v24.0.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
NODE="$(command -v node || echo /Users/hiroyusai/.nvm/versions/node/v24.0.1/bin/node)"
[ -f .env ] && set -a && . ./.env && set +a
out="$("$NODE" monitor.mjs 2>/dev/null)"; code=$?
printf '%s\n' "$out" >> monitor.log
alerts="$(printf '%s\n' "$out" | grep -E '🔴|🟠|🟡' || true)"
if [ -n "$alerts" ]; then
  printf '%s\n' "$alerts"                 # cron mails stdout; surfaces the alert
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$(printf '%s' "$alerts" | head -1 | sed 's/\"/\\\\"/g')\" with title \"Praeda peg monitor\"" 2>/dev/null || true
  fi
fi
exit $code
