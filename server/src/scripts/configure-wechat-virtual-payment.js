'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_FILE } = require('../services/wechat-virtual-payment');
function configure(input, output = CONFIG_FILE) {
  const stat = fs.lstatSync(input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw Error('private_input_required');
  const source = JSON.parse(fs.readFileSync(input));
  const c = { appId: String(source.appId || ''), offerId: String(source.offerId || ''), productId: String(source.productId || ''),
    sandboxAppKey: String(source.sandboxAppKey || '').trim(), productionAppKey: String(source.productionAppKey || '').trim(),
    enabled: false, goodsPublished: false, iosEnabled: false, iosRefundPolicy: 'reject_all',
    attemptRoot: path.join(path.dirname(output), 'virtual-payment-attempts') };
  if (c.appId !== 'wx1ac5bdb2d5bff31f' || c.offerId !== '1450709233' || c.productId !== 'geogi_diag_199' ||
      ![c.sandboxAppKey, c.productionAppKey].every((v) => /^[A-Za-z0-9]{16,128}$/.test(v))) throw Error('virtual_config_invalid');
  if (fs.existsSync(output)) {
    const st = fs.lstatSync(output); if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077) throw Error('private_output_required');
    const old = JSON.parse(fs.readFileSync(output));
    if (old.productionAppKey !== c.productionAppKey || old.sandboxAppKey !== c.sandboxAppKey || old.appId !== c.appId) throw Error('existing_keys_differ');
    return { configured: true, existing: true, enabled: old.enabled === true, secretsPrinted: false };
  }
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(output, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(c, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { configured: true, existing: false, enabled: false, secretsPrinted: false };
}
if (require.main === module) {
  try { console.log(JSON.stringify(configure(process.argv[2]))); }
  catch (_) { console.error('virtual_payment_setup_failed'); process.exitCode = 1; }
}
module.exports = { configure };
