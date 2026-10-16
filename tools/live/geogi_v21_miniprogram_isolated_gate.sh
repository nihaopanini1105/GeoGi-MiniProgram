#!/usr/bin/env bash
# Test the exact MiniProgram V2.1 bridge commit in a disposable Mac workspace.
# Does not change a production service, account, payment, local checkout or .env.
set -Eeuo pipefail
STAGE="start"; LOG=""; WORK=""
fail(){
  local code=$?
  trap - ERR
  printf 'GEOGI_V21_MINIPROGRAM_GATE=FAIL stage=%s code=%s\n' "$STAGE" "$code" >&2
  if [ -f "$LOG" ]; then tail -n 65 "$LOG" >&2; fi
  exit "$code"
}
cleanup(){ if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi; }
trap fail ERR
trap cleanup EXIT
for binary in git node npm tar; do command -v "$binary" >/dev/null 2>&1; done
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
git remote get-url origin | grep -E 'GeoGi-MiniProgram(\.git)?$' >/dev/null
BRANCH="feat/report-v21-protected-delivery-bridge-20261016"
STAGE="fetch_branch"
git fetch --no-tags origin "$BRANCH"
SHA="$(git rev-parse FETCH_HEAD)"
git cat-file -e "$SHA:server/tests/report_v21_bridge_contract_regression.js"
echo "GEOGI_V21_MINIPROGRAM_GATE=START sha=$SHA"
WORK="$(mktemp -d /tmp/geogi-v21-miniprogram.XXXXXX)"
mkdir -p "$WORK/workspace"
STAGE="extract_frozen_git"
git archive "$SHA" | tar -xf - -C "$WORK/workspace"
LOG="$WORK/test.log"
cd "$WORK/workspace/server"
STAGE="npm_install"
echo "STAGE=$STAGE"
npm install --ignore-scripts --no-audit --no-fund >"$LOG" 2>&1
STAGE="syntax_check"
echo "STAGE=$STAGE"
for js in src/server.js src/services/delivery-package-store.js src/services/customer-portal.js src/services/report-v21-bridge-operations.js src/services/os-operations-bridge.js tests/report_v21_bridge_contract_regression.js; do
  node --check "$js" >>"$LOG" 2>&1
done
echo "SYNTAX=PASS"
STAGE="v21_bridge_regression"
echo "STAGE=$STAGE"
node tests/report_v21_bridge_contract_regression.js >"$LOG" 2>&1
tail -n 3 "$LOG"
STAGE="complete_miniprogram_server_suite"
echo "STAGE=$STAGE"
npm test >"$LOG" 2>&1
tail -n 7 "$LOG"
echo "GEOGI_V21_MINIPROGRAM_GATE=PASS sha=$SHA"
