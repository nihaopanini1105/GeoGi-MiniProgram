#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EXPECTED="${GEOGI_EXPECTED_HEAD_SHA:-}"
if [[ -z "$EXPECTED" ]]; then
  echo "GEOGI_MINIPROGRAM_GATE=FAIL missing GEOGI_EXPECTED_HEAD_SHA" >&2
  exit 2
fi

ACTUAL="$(git rev-parse HEAD)"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "GEOGI_MINIPROGRAM_GATE=FAIL head mismatch expected=$EXPECTED actual=$ACTUAL" >&2
  exit 3
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "GEOGI_MINIPROGRAM_GATE=FAIL workspace not clean" >&2
  git status --short >&2
  exit 4
fi

command -v node >/dev/null 2>&1 || { echo "GEOGI_MINIPROGRAM_GATE=FAIL node missing" >&2; exit 5; }
command -v npm >/dev/null 2>&1 || { echo "GEOGI_MINIPROGRAM_GATE=FAIL npm missing" >&2; exit 5; }

APPID="$(node -e "const p=require('./project.config.json');process.stdout.write(String(p.appid||''))")"
if [[ -z "$APPID" || "$APPID" == "touristappid" ]]; then
  echo "GEOGI_MINIPROGRAM_GATE=FAIL production MiniProgram AppID missing" >&2
  exit 6
fi

JS_FILES=(
  server/src/server.js
  server/src/services/payment-store.js
  server/src/services/payment-service.js
  server/src/services/wechat-pay.js
  server/src/services/os-intake.js
  server/src/services/os-operations-bridge.js
  server/src/services/customer-portal.js
  pages/index/index.js
  pages/diagnosis/diagnosis.js
  pages/submit-success/submit-success.js
  pages/services/services.js
  pages/mine/mine.js
  pages/report-detail/report-detail.js
)
for file in "${JS_FILES[@]}"; do
  node --check "$file" >/dev/null
  echo "GEOGI_MINIPROGRAM_GATE_ASSERT_PASS=js_syntax:$file"
done

grep -Fq 'PRODUCT_PRICE_FEN = 19900' server/src/services/payment-store.js
grep -Fq "amount: {" server/src/services/wechat-pay.js
grep -Fq "total: PRODUCT_PRICE_FEN" server/src/services/wechat-pay.js
grep -Fq "wx.requestPayment" pages/submit-success/submit-success.js
grep -Fq "支付 ¥199 获取诊断报告" pages/submit-success/submit-success.wxml
grep -Fq "不包含在 199 元诊断报告中" pages/services/services.js
grep -Fq "/internal/os/payments/:outTradeNo/refund" server/src/server.js

if grep -R -E '免费诊断|免费报告|初步诊断会|提交后立即开始诊断' pages --include='*.wxml' --include='*.js'; then
  echo "GEOGI_MINIPROGRAM_GATE=FAIL legacy free/unpaid product copy found" >&2
  exit 7
fi

(
  cd server
  npm test
)

if [[ "${GEOGI_RUN_PAYMENT_PREFLIGHT:-0}" == "1" ]]; then
  (
    cd server
    npm run payment:preflight
  )
  echo "GEOGI_MINIPROGRAM_PAYMENT_PREFLIGHT=PASS"
fi

echo "GEOGI_MINIPROGRAM_APPID=$APPID"
echo "GEOGI_MINIPROGRAM_VALIDATED_HEAD_SHA=$ACTUAL"
echo "GEOGI_MINIPROGRAM_PAID_DIAGNOSTIC_GATE=PASS"
