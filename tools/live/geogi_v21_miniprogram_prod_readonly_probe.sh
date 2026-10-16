#!/usr/bin/env bash
# GeoGi MiniProgram API production V2.1 prerequisite probe.
# STRICTLY READ-ONLY: no configuration values, credentials, deploy, restart,
# customers, raw orders, upload files or database contents.
set -u
echo 'GEOGI_V21_MINIPROGRAM_PREFLIGHT=BEGIN'
echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "HOSTNAME=$(hostname 2>/dev/null || echo unknown)"
if command -v systemctl >/dev/null 2>&1; then
  status="$(systemctl is-active geogi-api.service 2>/dev/null || :)"
  printf 'MINIPROGRAM_API_SYSTEMD_STATUS=%s\n' "$status"
fi
for dir in /opt/geogi-mini-program /opt/geogi-mini-program/server; do
  if [ -d "$dir" ]; then
    printf 'DIR_EXISTS=%s\n' "$dir"
    if [ -d "$dir/.git" ]; then
      printf 'GIT_SHA_%s=%s\n' "$(basename "$dir")" "$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo unknown)"
    fi
  fi
done
for file in /opt/geogi-mini-program/server/src/server.js \
            /opt/geogi-mini-program/server/src/services/delivery-package-store.js \
            /opt/geogi-mini-program/server/src/services/report-v2-bridge-operations.js \
            /opt/geogi-mini-program/server/src/services/report-v21-bridge-operations.js; do
  if [ -f "$file" ]; then
    printf 'LIVE_FILE_SHA256=%s ' "$file"
    sha256sum "$file" 2>/dev/null | awk '{print $1}'
  else
    printf 'LIVE_FILE_ABSENT=%s\n' "$file"
  fi
done
if command -v node >/dev/null 2>&1; then
  printf 'NODE_VERSION=%s\n' "$(node --version)"
fi
if command -v curl >/dev/null 2>&1; then
  for suffix in health internal/os/report-v2/capabilities internal/os/report-v21/capabilities; do
    url="https://api.geogi.cn/$suffix"
    result="$(curl -sS --max-time 12 -o /dev/null -w 'HTTP=%{http_code} TLS=%{ssl_verify_result} REDIRECTS=%{num_redirects}' "$url" 2>/dev/null || echo request_failed)"
    printf 'ENDPOINT=%s %s\n' "$suffix" "$result"
  done
fi
echo 'GEOGI_V21_MINIPROGRAM_PREFLIGHT=END'
