#!/usr/bin/env bash
set -eEuo pipefail

EXPECTED_SHA="${GEOGI_EXPECTED_MINIPROGRAM_MAIN_SHA:-}"
SSH_TARGET="${GEOGI_PRODUCTION_SSH_TARGET:-root@121.40.227.198}"
SERVER_DIR="${GEOGI_SERVER_DIR:-/opt/geogi-mini-program/server}"
SERVICE_NAME="${GEOGI_SERVICE_NAME:-geogi-api}"
PUBLIC_BASE_URL="${GEOGI_PUBLIC_BASE_URL:-https://api.geogi.cn}"
BACKUP_ROOT="${GEOGI_BACKUP_ROOT:-/opt/geogi-backups/geogi-mini-program}"

if [ -z "$EXPECTED_SHA" ] || ! printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "ERROR: GEOGI_EXPECTED_MINIPROGRAM_MAIN_SHA must be an approved 40-hex merged-main SHA" >&2
  exit 2
fi

for command_name in git tar ssh scp node npm curl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: required local command missing: $command_name" >&2
    exit 2
  }
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: run this script from a local GeoGi-MiniProgram git checkout" >&2
  exit 2
fi
cd "$REPO_ROOT"

LOCAL_SHA="$(git rev-parse HEAD)"
BRANCH="$(git branch --show-current)"
if [ "$LOCAL_SHA" != "$EXPECTED_SHA" ] || [ "$BRANCH" != "main" ]; then
  echo "ERROR: local checkout must be main at approved SHA $EXPECTED_SHA" >&2
  echo "local_branch=$BRANCH" >&2
  echo "local_sha=$LOCAL_SHA" >&2
  exit 2
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: tracked local changes detected; refusing production package" >&2
  git status -sb >&2
  exit 2
fi

REMOTE_MAIN="$(git rev-parse origin/main 2>/dev/null || true)"
if [ "$REMOTE_MAIN" != "$EXPECTED_SHA" ]; then
  echo "ERROR: local origin/main is not approved SHA; run git fetch origin first" >&2
  echo "origin_main=$REMOTE_MAIN" >&2
  exit 2
fi

printf '%s\n' "============================================================"
printf '%s\n' " GeoGi MiniProgram · Mac Push Exact Production Deployment"
printf '%s\n' " Approved SHA: $EXPECTED_SHA"
printf '%s\n' " Target: $SSH_TARGET"
printf '%s\n' " Server dir: $SERVER_DIR"
printf '%s\n' "============================================================"

(
  cd server
  node --check src/server.js
  node --check src/services/os-operations-bridge.js
  node --check src/services/os-artifact-ingress.js
  npm test
)

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/geogi-miniprogram-push.XXXXXX")"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT
ARCHIVE="$TMP_ROOT/geogi-miniprogram-server-${EXPECTED_SHA}.tar.gz"

FILES=(package.json src tests scripts)
if [ -f "$REPO_ROOT/server/package-lock.json" ]; then
  FILES+=(package-lock.json)
fi
tar -C "$REPO_ROOT/server" -czf "$ARCHIVE" "${FILES[@]}"

REMOTE_ARCHIVE="/tmp/geogi-miniprogram-server-${EXPECTED_SHA}.tar.gz"
scp "$ARCHIVE" "$SSH_TARGET:$REMOTE_ARCHIVE"

ssh "$SSH_TARGET" bash -s -- \
  "$EXPECTED_SHA" "$REMOTE_ARCHIVE" "$SERVER_DIR" "$SERVICE_NAME" "$PUBLIC_BASE_URL" "$BACKUP_ROOT" <<'REMOTE'
set -eEuo pipefail
EXPECTED_SHA="$1"
ARCHIVE="$2"
SERVER_DIR="$3"
SERVICE_NAME="$4"
PUBLIC_BASE_URL="$5"
BACKUP_ROOT="$6"

for command_name in tar node npm systemctl curl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: required production command missing: $command_name" >&2
    exit 2
  }
done

for required in "$SERVER_DIR/.env" "$SERVER_DIR/package.json" "$SERVER_DIR/src/server.js" "$ARCHIVE"; do
  [ -f "$required" ] || { echo "ERROR: production marker missing: $required" >&2; exit 2; }
done
systemctl is-active --quiet "$SERVICE_NAME" || {
  echo "ERROR: $SERVICE_NAME is not active before deployment" >&2
  exit 2
}

TMP_ROOT="$(mktemp -d /tmp/geogi-miniprogram-stage.XXXXXX)"
BACKUP_DIR=""
DEPLOY_STARTED=0
cleanup() { rm -rf "$TMP_ROOT" "$ARCHIVE"; }
rollback() {
  status=$?
  trap - ERR
  if [ "$DEPLOY_STARTED" -eq 1 ] && [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    echo "Deployment failed after production swap; restoring previous program files." >&2
    systemctl stop "$SERVICE_NAME" || true
    rm -rf "$SERVER_DIR/src" "$SERVER_DIR/tests" "$SERVER_DIR/scripts"
    [ ! -d "$BACKUP_DIR/src" ] || cp -a "$BACKUP_DIR/src" "$SERVER_DIR/src"
    [ ! -d "$BACKUP_DIR/tests" ] || cp -a "$BACKUP_DIR/tests" "$SERVER_DIR/tests"
    [ ! -d "$BACKUP_DIR/scripts" ] || cp -a "$BACKUP_DIR/scripts" "$SERVER_DIR/scripts"
    [ ! -f "$BACKUP_DIR/package.json" ] || cp -a "$BACKUP_DIR/package.json" "$SERVER_DIR/package.json"
    [ ! -f "$BACKUP_DIR/package-lock.json" ] || cp -a "$BACKUP_DIR/package-lock.json" "$SERVER_DIR/package-lock.json"
    systemctl start "$SERVICE_NAME" || true
    echo "rollback_attempted=true" >&2
  fi
  cleanup
  exit "$status"
}
trap rollback ERR
trap cleanup EXIT

tar -xzf "$ARCHIVE" -C "$TMP_ROOT"
for required in \
  "$TMP_ROOT/package.json" \
  "$TMP_ROOT/src/server.js" \
  "$TMP_ROOT/src/services/os-operations-bridge.js" \
  "$TMP_ROOT/src/services/os-artifact-ingress.js"; do
  [ -f "$required" ] || { echo "ERROR: release package missing $required" >&2; exit 2; }
done

node --check "$TMP_ROOT/src/server.js"
node --check "$TMP_ROOT/src/services/os-operations-bridge.js"
node --check "$TMP_ROOT/src/services/os-artifact-ingress.js"
(
  cd "$TMP_ROOT"
  npm test
)

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP-${EXPECTED_SHA:0:12}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -a "$SERVER_DIR/src" "$BACKUP_DIR/src"
[ ! -d "$SERVER_DIR/tests" ] || cp -a "$SERVER_DIR/tests" "$BACKUP_DIR/tests"
[ ! -d "$SERVER_DIR/scripts" ] || cp -a "$SERVER_DIR/scripts" "$BACKUP_DIR/scripts"
cp -a "$SERVER_DIR/package.json" "$BACKUP_DIR/package.json"
[ ! -f "$SERVER_DIR/package-lock.json" ] || cp -a "$SERVER_DIR/package-lock.json" "$BACKUP_DIR/package-lock.json"

NEXT="$SERVER_DIR/.release-next-${EXPECTED_SHA:0:12}"
rm -rf "$NEXT"
mkdir -p "$NEXT"
cp -a "$TMP_ROOT/src" "$NEXT/src"
[ ! -d "$TMP_ROOT/tests" ] || cp -a "$TMP_ROOT/tests" "$NEXT/tests"
[ ! -d "$TMP_ROOT/scripts" ] || cp -a "$TMP_ROOT/scripts" "$NEXT/scripts"
cp -a "$TMP_ROOT/package.json" "$NEXT/package.json"
[ ! -f "$TMP_ROOT/package-lock.json" ] || cp -a "$TMP_ROOT/package-lock.json" "$NEXT/package-lock.json"

systemctl stop "$SERVICE_NAME"
DEPLOY_STARTED=1
rm -rf "$SERVER_DIR/src" "$SERVER_DIR/tests" "$SERVER_DIR/scripts"
mv "$NEXT/src" "$SERVER_DIR/src"
[ ! -d "$NEXT/tests" ] || mv "$NEXT/tests" "$SERVER_DIR/tests"
[ ! -d "$NEXT/scripts" ] || mv "$NEXT/scripts" "$SERVER_DIR/scripts"
mv "$NEXT/package.json" "$SERVER_DIR/package.json"
[ ! -f "$NEXT/package-lock.json" ] || mv "$NEXT/package-lock.json" "$SERVER_DIR/package-lock.json"
rmdir "$NEXT" 2>/dev/null || true

systemctl start "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME"

LOCAL_HEALTH="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 http://127.0.0.1:3107/health)"
PUBLIC_HEALTH="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$PUBLIC_BASE_URL/health")"
node -e '
const local=JSON.parse(process.argv[1]); const pub=JSON.parse(process.argv[2]);
for (const [name,p] of [["local",local],["public",pub]]) {
 if (!p || p.ok!==true || p.businessAuthority!=="GeoGi OS" || p.deliveryContract!=="DeliveryPackage/2.0.0" || p.osOperationsBridge!=="configured") {
   console.error(`ERROR: ${name} health is not V1 bridge-ready`); process.exit(2);
 }
}
' "$LOCAL_HEALTH" "$PUBLIC_HEALTH"

for endpoint in "http://127.0.0.1:3107/internal/os/artifacts" "$PUBLIC_BASE_URL/internal/os/artifacts"; do
  STATUS="$(curl -sS --connect-timeout 5 --max-time 15 -o "$TMP_ROOT/probe.json" -w '%{http_code}' -X POST -H 'Content-Type: application/octet-stream' "$endpoint")"
  if [ "$STATUS" != "401" ] || ! grep -q 'OS_BRIDGE_UNAUTHORIZED' "$TMP_ROOT/probe.json"; then
    echo "ERROR: protected artifact ingress not live at $endpoint (status=$STATUS)" >&2
    cat "$TMP_ROOT/probe.json" >&2 || true
    exit 2
  fi
done

DEPLOY_STARTED=0
printf '%s\n' "deployed_main_sha=$EXPECTED_SHA"
printf '%s\n' "backup_dir=$BACKUP_DIR"
printf '%s\n' "artifact_ingress_local=protected"
printf '%s\n' "artifact_ingress_public=protected"
printf '%s\n' "production_miniprogram_v1_1=SUCCESS"
REMOTE
