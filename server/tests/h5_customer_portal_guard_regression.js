const assert = require('assert');
const fs = require('fs');
const path = require('path');

const portal = fs.readFileSync(path.join(__dirname, '../src/services/customer-portal.js'),'utf8');
const detail = fs.readFileSync(path.join(__dirname,'../../pages/report-detail/report-detail.js'),'utf8');
const delivery = require('../src/services/delivery-package-store');

const sample = { artifactType: 'h5', artifactMimeType:'text/html' };
assert.strictEqual(sample.artifactType,'h5');
assert(portal.includes('artifactMimeType: reportReady && deliveryView'));
assert(portal.includes('artifactType: reportReady && deliveryView'));
assert(detail.includes("report.artifactType === 'h5'"));
assert(detail.includes("report.artifactMimeType === 'text/html'"));
assert(detail.includes('尚未配置受控阅读地址时不能公开打开 HTML 文件'));
assert.strictEqual(delivery.DELIVERY_MODE,'artifact_only');
console.log('H5_CUSTOMER_PORTAL_TYPE_GUARD_PASS');
