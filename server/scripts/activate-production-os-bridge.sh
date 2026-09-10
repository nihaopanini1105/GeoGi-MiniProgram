#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="${GEOGI_SERVER_DIR:-/opt/geogi-mini-program/server}"
SERVICE_NAME="${GEOGI_SERVICE_NAME:-geogi-api}"
PUBLIC_BASE_URL="${GEOGI_PUBLIC_BASE_URL:-https://api.geogi.cn}"
EXPECTED_MAIN_SHA="${GEOGI_EXPECTED_MINIPROGRAM_MAIN_SHA:-812f4cce32557e380b34c9d152228616b52e264a}"

cd "$SERVER_DIR"

printf '%s\n' "============================================================"
printf '%s\n' " GeoGi MiniProgram · Production OS Bridge Activation"
printf '%s\n' " Server dir: $SERVER_DIR"
printf '%s\n' " Service: $SERVICE_NAME"
printf '%s\n' " Public API: $PUBLIC_BASE_URL"
printf '%s\n' "============================================================"

if [ ! -d .git ]; then
  echo "ERROR: production server directory is not a git checkout" >&2
  exit 2
fi

if [ ! -f .env ]; then
  echo "ERROR: $SERVER_DIR/.env is missing" >&2
  exit 2
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: production checkout has tracked local changes; refusing deployment" >&2
  git status --short
  exit 2
fi

git fetch origin main
git switch main
git pull --ff-only origin main

HEAD_SHA="$(git rev-parse HEAD)"
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

set -a
# shellcheck disable=SC1091
source ./.env
set +a

if [ -z "${GEOGI_OS_BRIDGE_TOKEN:-}" ]; then
  echo "ERROR: bridge token unavailable after configuration" >&2
  exit 2
fi

INTAKES="$(curl --fail --silent --show-error \
  -H "Authorization: Bearer ${GEOGI_OS_BRIDGE_TOKEN}" \
  "$PUBLIC_BASE_URL/internal/os/intakes")"

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
