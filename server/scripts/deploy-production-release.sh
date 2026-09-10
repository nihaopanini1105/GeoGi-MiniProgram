#!/usr/bin/env bash
set -eEuo pipefail

SERVICE_NAME="${GEOGI_SERVICE_NAME:-geogi-api}"
PUBLIC_BASE_URL="${GEOGI_PUBLIC_BASE_URL:-https://api.geogi.cn}"
EXPECTED_SHA="${GEOGI_EXPECTED_MINIPROGRAM_MAIN_SHA:-}"
REPO_ARCHIVE_BASE="https://github.com/nihaopanini1105/GeoGi-MiniProgram/archive"
BACKUP_ROOT="${GEOGI_BACKUP_ROOT:-/opt/geogi-backups/geogi-mini-program}"
SERVER_DIR="${GEOGI_SERVER_DIR:-}"

if [ -z "$EXPECTED_SHA" ] || ! printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "ERROR: GEOGI_EXPECTED_MINIPROGRAM_MAIN_SHA must be an approved 40-hex merged-main SHA" >&2
  exit 2
fi

for command_name in curl tar node npm systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: required command missing: $command_name" >&2
    exit 2
  }
done

if [ -z "$SERVER_DIR" ]; then
  SERVER_DIR="$(systemctl show "$SERVICE_NAME" -p WorkingDirectory --value 2>/dev/null || true)"
fi
if [ -z "$SERVER_DIR" ]; then
  SERVER_DIR="/opt/geogi-mini-program/server"
fi
SERVER_DIR="$(cd "$SERVER_DIR" 2>/dev/null && pwd -P)" || {
  echo "ERROR: production server directory not found" >&2
  exit 2
}

for required in "$SERVER_DIR/.env" "$SERVER_DIR/package.json" "$SERVER_DIR/src/server.js"; do
  if [ ! -f "$required" ]; then
    echo "ERROR: production runtime marker missing: $required" >&2
    exit 2
  fi
done

if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "ERROR: $SERVICE_NAME is not active before deployment" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d /tmp/geogi-miniprogram-release.XXXXXX)"
DEPLOY_STARTED=0
BACKUP_DIR=""
cleanup() {
  rm -rf "$TMP_ROOT"
}
rollback() {
  status=$?
  trap - ERR
  if [ "$DEPLOY_STARTED" -eq 1 ] && [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    echo "Deployment failed after production swap; restoring previous program files." >&2
    systemctl stop "$SERVICE_NAME" || true
    rm -rf "$SERVER_DIR/src" "$SERVER_DIR/scripts" "$SERVER_DIR/tests"
    [ ! -d "$BACKUP_DIR/src" ] || cp -a "$BACKUP_DIR/src" "$SERVER_DIR/src"
    [ ! -d "$BACKUP_DIR/scripts" ] || cp -a "$BACKUP_DIR/scripts" "$SERVER_DIR/scripts"
    [ ! -d "$BACKUP_DIR/tests" ] || cp -a "$BACKUP_DIR/tests" "$SERVER_DIR/tests"
    [ ! -f "$BACKUP_DIR/package.json" ] || cp -a "$BACKUP_DIR/package.json" "$SERVER_DIR/package.json"
    [ ! -f "$BACKUP_DIR/pnpm-lock.yaml" ] || cp -a "$BACKUP_DIR/pnpm-lock.yaml" "$SERVER_DIR/pnpm-lock.yaml"
    systemctl start "$SERVICE_NAME" || true
    echo "rollback_attempted=true" >&2
  fi
  cleanup
  exit "$status"
}
trap rollback ERR
trap cleanup EXIT

printf '%s\n' "============================================================"
printf '%s\n' " GeoGi MiniProgram · Exact Release Production Deployment"
printf '%s\n' " Service: $SERVICE_NAME"
printf '%s\n' " Server dir: $SERVER_DIR"
printf '%s\n' " Approved SHA: $EXPECTED_SHA"
printf '%s\n' " Public API: $PUBLIC_BASE_URL"
printf '%s\n' "============================================================"

ARCHIVE="$TMP_ROOT/release.tar.gz"
curl --fail --location --silent --show-error \
  "$REPO_ARCHIVE_BASE/$EXPECTED_SHA.tar.gz" \
  -o "$ARCHIVE"
tar -xzf "$ARCHIVE" -C "$TMP_ROOT"

PACKAGE_PATH="$(find "$TMP_ROOT" -mindepth 2 -maxdepth 4 -type f -path '*/server/package.json' -print -quit)"
if [ -z "$PACKAGE_PATH" ]; then
  echo "ERROR: downloaded release does not contain server/package.json" >&2
  exit 2
fi
STAGE_SERVER="$(dirname "$PACKAGE_PATH")"

for required in \
  "$STAGE_SERVER/src/server.js" \
  "$STAGE_SERVER/src/services/os-operations-bridge.js" \
  "$STAGE_SERVER/src/scripts/configure-os-bridge-production.js"; do
  if [ ! -f "$required" ]; then
    echo "ERROR: approved release missing required Bridge file: $required" >&2
    exit 2
  fi
done

node --check "$STAGE_SERVER/src/server.js"
node --check "$STAGE_SERVER/src/services/os-operations-bridge.js"
node --check "$STAGE_SERVER/src/scripts/configure-os-bridge-production.js"
(
  cd "$STAGE_SERVER"
  npm test
)

GEOGI_PRODUCTION_ENV_FILE="$SERVER_DIR/.env" \
  node "$STAGE_SERVER/src/scripts/configure-os-bridge-production.js"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP-${EXPECTED_SHA:0:12}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
[ ! -d "$SERVER_DIR/src" ] || cp -a "$SERVER_DIR/src" "$BACKUP_DIR/src"
[ ! -d "$SERVER_DIR/scripts" ] || cp -a "$SERVER_DIR/scripts" "$BACKUP_DIR/scripts"
[ ! -d "$SERVER_DIR/tests" ] || cp -a "$SERVER_DIR/tests" "$BACKUP_DIR/tests"
cp -a "$SERVER_DIR/package.json" "$BACKUP_DIR/package.json"
[ ! -f "$SERVER_DIR/pnpm-lock.yaml" ] || cp -a "$SERVER_DIR/pnpm-lock.yaml" "$BACKUP_DIR/pnpm-lock.yaml"

NEXT_DIR="$SERVER_DIR/.release-next-${EXPECTED_SHA:0:12}"
rm -rf "$NEXT_DIR"
mkdir -p "$NEXT_DIR"
cp -a "$STAGE_SERVER/src" "$NEXT_DIR/src"
[ ! -d "$STAGE_SERVER/scripts" ] || cp -a "$STAGE_SERVER/scripts" "$NEXT_DIR/scripts"
[ ! -d "$STAGE_SERVER/tests" ] || cp -a "$STAGE_SERVER/tests" "$NEXT_DIR/tests"
cp -a "$STAGE_SERVER/package.json" "$NEXT_DIR/package.json"
[ ! -f "$STAGE_SERVER/pnpm-lock.yaml" ] || cp -a "$STAGE_SERVER/pnpm-lock.yaml" "$NEXT_DIR/pnpm-lock.yaml"

systemctl stop "$SERVICE_NAME"
DEPLOY_STARTED=1
rm -rf "$SERVER_DIR/src" "$SERVER_DIR/scripts" "$SERVER_DIR/tests"
mv "$NEXT_DIR/src" "$SERVER_DIR/src"
[ ! -d "$NEXT_DIR/scripts" ] || mv "$NEXT_DIR/scripts" "$SERVER_DIR/scripts"
[ ! -d "$NEXT_DIR/tests" ] || mv "$NEXT_DIR/tests" "$SERVER_DIR/tests"
mv "$NEXT_DIR/package.json" "$SERVER_DIR/package.json"
[ ! -f "$NEXT_DIR/pnpm-lock.yaml" ] || mv "$NEXT_DIR/pnpm-lock.yaml" "$SERVER_DIR/pnpm-lock.yaml"
rmdir "$NEXT_DIR" 2>/dev/null || true

systemctl start "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME"

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
const raw = fs.readFileSync(process.argv[1], "utf8");
let token = "";
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const i = normalized.indexOf("=");
  if (i <= 0 || normalized.slice(0, i).trim() !== "GEOGI_OS_BRIDGE_TOKEN") continue;
  token = normalized.slice(i + 1).trim();
  if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  break;
}
if (!token) process.exit(2);
process.stdout.write(token);
' "$SERVER_DIR/.env")"

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

DEPLOY_STARTED=0
printf '%s\n' "deployed_main_sha=$EXPECTED_SHA"
printf '%s\n' "backup_dir=$BACKUP_DIR"
printf '%s\n' "production_os_bridge_activation=success"
