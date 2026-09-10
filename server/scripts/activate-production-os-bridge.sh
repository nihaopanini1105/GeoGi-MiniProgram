#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="${GEOGI_SERVER_DIR:-/opt/geogi-mini-program/server}"
SERVICE_NAME="${GEOGI_SERVICE_NAME:-geogi-api}"
PUBLIC_BASE_URL="${GEOGI_PUBLIC_BASE_URL:-https://api.geogi.cn}"
EXPECTED_MAIN_SHA="${GEOGI_EXPECTED_MINIPROGRAM_MAIN_SHA:-}"

if [ -z "$EXPECTED_MAIN_SHA" ]; then
  echo "ERROR: GEOGI_EXPECTED_MINIPROGRAM_MAIN_SHA is required" >&2
  exit 2
fi

cd "$SERVER_DIR"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

printf '%s\n' "============================================================"
printf '%s\n' " GeoGi MiniProgram · Production OS Bridge Activation"
printf '%s\n' " Server dir: $SERVER_DIR"
printf '%s\n' " Service: $SERVICE_NAME"
printf '%s\n' " Public API: $PUBLIC_BASE_URL"
printf '%s\n' " Approved main: $EXPECTED_MAIN_SHA"
printf '%s\n' "============================================================"

if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  echo "ERROR: production server directory is not inside a git checkout" >&2
  exit 2
fi

if [ ! -f .env ]; then
  echo "ERROR: $SERVER_DIR/.env is missing" >&2
  exit 2
fi

if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: production checkout has tracked local changes; refusing deployment" >&2
  git -C "$REPO_ROOT" status --short
  exit 2
fi

git -C "$REPO_ROOT" fetch origin main
git -C "$REPO_ROOT" switch main
git -C "$REPO_ROOT" pull --ff-only origin main

HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [ "$HEAD_SHA" != "$EXPECTED_MAIN_SHA" ]; then
  echo "ERROR: production main SHA is not the approved expected SHA" >&2
  echo "actual_sha=$HEAD_SHA" >&2
  echo "expected_sha=$EXPECTED_MAIN_SHA" >&2
  exit 2
fi

node src/scripts/configure-os-bridge-production.js
npm test

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl is-active --quiet "$SERVICE_NAME"

LOCAL_HEALTH="$(curl --fail --silent --show-error http://127.0.0.1:3107/health)"
PUBLIC_HEALTH="$(curl --fail --silent --show-error "$PUBLIC_BASE_URL/health")"

node -e '
const local = JSON.parse(process.argv[1]);
const pub = JSON.parse(process.argv[2]);
for (const [name, payload] of [["local", local], ["public", pub]]) {
  if (!payload || payload.ok !== true || payload.businessAuthority !== "GeoGi OS" || payload.deliveryContract !== "DeliveryPackage/2.0.0" || payload.osOperationsBridge !== "configured") {
    console.error(`ERROR: ${name} health is not bridge-ready`);
    process.exit(2);
  }
}
console.log(JSON.stringify({ok:true, localBridge:local.osOperationsBridge, publicBridge:pub.osOperationsBridge}, null, 2));
' "$LOCAL_HEALTH" "$PUBLIC_HEALTH"

BRIDGE_TOKEN="$(node -e '
const fs = require("fs");
const raw = fs.readFileSync(".env", "utf8");
let token = "";
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const i = normalized.indexOf("=");
  if (i <= 0) continue;
  if (normalized.slice(0, i).trim() !== "GEOGI_OS_BRIDGE_TOKEN") continue;
  token = normalized.slice(i + 1).trim();
  if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  break;
}
if (!token) process.exit(2);
process.stdout.write(token);
')"

INTAKES="$(curl --fail --silent --show-error \
  -H "Authorization: Bearer ${BRIDGE_TOKEN}" \
  "$PUBLIC_BASE_URL/internal/os/intakes")"
unset BRIDGE_TOKEN

node -e '
const payload = JSON.parse(process.argv[1]);
if (!payload || payload.ok !== true || !Array.isArray(payload.items)) {
  console.error("ERROR: authenticated intake boundary failed");
  process.exit(2);
}
const oriental = payload.items.filter((item) => /oriental/i.test(String(item.brandName || "")));
console.log(JSON.stringify({
  ok: true,
  intakeCount: payload.items.length,
  orientalMatches: oriental.map((item) => ({
    submissionId: item.submissionId || "",
    clientId: item.clientId || "",
    projectId: item.projectId || "",
    brandName: item.brandName || ""
  }))
}, null, 2));
' "$INTAKES"

printf '%s\n' "production_os_bridge_activation=success"
