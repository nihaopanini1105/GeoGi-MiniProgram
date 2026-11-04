'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-empty-history-'));
process.env.CUSTOMER_SESSION_SECRET = 'empty-history-isolated-test-secret';
process.env.FEISHU_BASE_APP_TOKEN = 'test-app';
process.env.FEISHU_LEADS_TABLE_ID = 'test-leads';
process.env.FEISHU_PROJECTS_TABLE_ID = 'test-projects';
process.env.GEOGI_PAYMENT_DATA_ROOT = path.join(root, 'payments');
process.env.GEOGI_CHANNEL_DATA_ROOT = path.join(root, 'channels');
process.env.GEOGI_MINIPROGRAM_USER_DATA_ROOT = path.join(root, 'users');
process.env.GEOGI_DELIVERY_PACKAGE_ROOT = path.join(root, 'deliveries');
process.env.UPLOAD_DIR = path.join(root, 'uploads');

let leads = [];
const feishu = require('../src/services/feishu');
feishu.getTenantAccessToken = async () => 'isolated-test-token';
feishu.listBitableRecords = async ({ tableId }) => {
  assert(['test-leads', 'test-projects'].includes(tableId));
  return tableId === 'test-leads' ? leads : [];
};
require('../src/services/delivery-package-store').findDeliveryPackage = async () => null;
require('../src/services/payment-store').findPaymentByProject = async () => null;
const { createCustomerToken } = require('../src/services/customer-session');
const token = createCustomerToken('13800000001').customerToken;
const otherToken = createCustomerToken('13800000002').customerToken;

// Execute the actual application and middleware; capture listen so the test
// can own an ephemeral loopback server and always shut it down.
const serverPath = path.join(__dirname, '../src/server.js');
const localRequire = createRequire(serverPath);
const express = require('express');
let app;
const wrappedExpress = Object.assign(() => {
  app = express();
  app.listen = () => app;
  return app;
}, express);
const sourcePath = process.env.GEOGI_CUSTOMER_HISTORY_SERVER_SOURCE || serverPath;
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
  require: (name) => name === 'express' ? wrappedExpress
    : name === './services/report-v21-bridge-operations' ? {} : localRequire(name),
  process, Buffer, console, __dirname: path.dirname(serverPath)
}, { filename: sourcePath });
const server = http.createServer(app);
const request = (port, suffix, auth = token) => new Promise((resolve, reject) => {
  const req = http.get({ hostname: '127.0.0.1', port,
    path: suffix, headers: auth ? { Authorization: 'Bearer ' + auth } : {}
  }, res => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
  });
  req.on('error', reject);
});
const getPath = '/api/customer/projects';

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  assert.strictEqual((await request(port, getPath, '')).status, 401);
  assert.strictEqual((await request(port, getPath, token + 'invalid')).status, 401);
  const empty = await request(port, getPath);
  assert.deepStrictEqual(empty, { status: 200,
    body: { ok: true, clientId: '', orders: [], notifications: [] } });
  assert.strictEqual((await request(port, getPath + '?clientId=GG-DELETED')).status, 404);
  assert.strictEqual((await request(port, '/api/customer/reports/GG-P-DELETED?clientId=GG-DELETED')).status, 404);

  leads = [1, 2].map(n => ({ fields: {
    '客户编号': 'GG-OWN-' + n, '项目编号': 'GG-P-OWN-' + n,
    '联系方式': '13800000001', '品牌名称': '隔离测试',
    '提交时间': '2026-11-0' + n + 'T12:00:00+08:00', '当前状态': '诊断分析中'
  } }));
  leads.push({ fields: { '客户编号': 'GG-OTHER', '项目编号': 'GG-P-OTHER',
    '联系方式': '13800000002', '品牌名称': '隔离测试' } });
  const owned = await request(port, getPath);
  assert.strictEqual(owned.status, 200);
  assert.deepStrictEqual(owned.body.orders.map(x => x.clientId).sort(), ['GG-OWN-1', 'GG-OWN-2']);
  assert.strictEqual((await request(port, getPath + '?clientId=GG-OTHER')).status, 404);
  assert.deepStrictEqual((await request(port, getPath + '?clientId=GG-OWN-1')).body.orders.map(x => x.clientId), ['GG-OWN-1']);
  assert.deepStrictEqual((await request(port, getPath, otherToken)).body.orders.map(x => x.clientId), ['GG-OTHER']);

  // Exercise the unchanged released MiniProgram page with stale completed
  // cards and the real HTTP result after deleting all of this phone's leads.
  leads = leads.filter(x => x.fields['联系方式'] !== '13800000001');
  let page;
  const storage = { geogi_my_orders: [{ clientId: 'GG-DELETED', projectId: 'GG-P-DELETED', status: '报告已完成', reportReady: true }] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/mine/mine.js'), 'utf8'), {
    Page: value => { page = value; }, console,
    wx: { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; } },
    require: () => ({ getCustomerToken: () => token, isApiConfigured: () => true,
      get: async url => url === getPath ? (await request(port, url)).body : { ok: true, isChannel: false } })
  });
  page.data = { ...page.data };
  page.setData = value => Object.assign(page.data, value);
  await page.loadOrders();
  assert.strictEqual(page.data.orders.length, 0);
  assert.strictEqual(page.data.notifications.length, 0);
  assert.strictEqual(storage.geogi_my_orders.length, 0);
  assert.strictEqual((await request(port, '/api/customer/reports/GG-P-OWN-1?clientId=GG-OWN-1')).status, 404);
  assert.deepStrictEqual((await request(port, getPath, otherToken)).body.orders.map(x => x.clientId), ['GG-OTHER']);
  console.log('CUSTOMER_EMPTY_HISTORY_HTTP_AND_EXISTING_MINIPROGRAM_CACHE: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
