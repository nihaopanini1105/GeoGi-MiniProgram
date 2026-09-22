const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function run() {
  const diagnosis = read('pages/diagnosis/diagnosis.wxml');
  const success = read('pages/submit-success/submit-success.wxml');
  const home = read('pages/index/index.wxml');
  const services = read('pages/services/services.wxml');
  const servicesJs = read('pages/services/services.js');
  const mine = read('pages/mine/mine.wxml');
  const report = read('pages/report-detail/report-detail.wxml');
  const server = read('server/src/server.js');

  for (const [name, source] of Object.entries({ diagnosis, success, home, services, servicesJs, mine, report })) {
    assert(source.includes('199'), name + ' must state the 199 yuan product truth');
  }
  assert(diagnosis.includes('提交资料，下一步支付 ¥199'));
  assert(success.includes('支付 ¥199 获取诊断报告'));
  assert(home.includes('199 元获取一次品牌 GEO 诊断及正式诊断报告'));
  assert(servicesJs.includes('不包含在 199 元诊断报告中'));
  assert(mine.includes('付款状态'));
  assert(report.includes('付款成功后开始处理'));
  assert(server.includes('/api/payments/wechat/notify'));
  assert(server.includes('/internal/os/payments/:outTradeNo/refund'));

  for (const forbidden of [
    '免费诊断', '免费报告', '初步诊断会', '提交后立即开始诊断'
  ]) {
    assert(!diagnosis.includes(forbidden), 'diagnosis copy must not imply unpaid/free delivery: ' + forbidden);
  }

  console.log('paid-diagnostic-copy-contract-regression-ok');
}

run();
