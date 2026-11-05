'use strict';
// Secrets are written only to a private server file. stdout contains no credentials.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CONFIG, validateConfig } = require('../services/wechat-message-push');
function configure(file = DEFAULT_CONFIG) {
  if (!path.isAbsolute(file)) throw new Error('absolute_config_path_required');
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error('private_config_required');
    validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    return { configured: true, existing: true, file };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let aes;
  do { aes = crypto.randomBytes(32).toString('base64').slice(0, -1); } while (!/^[A-Za-z0-9]{43}$/.test(aes));
  const config = validateConfig({ appId: 'wx1ac5bdb2d5bff31f',
    url: 'https://api.geogi.cn/api/wechat/message-push', token: crypto.randomBytes(16).toString('hex'),
    encodingAESKey: aes,
    inbox: path.join(path.dirname(file), 'wechat-message-push-inbox'), encryption: '安全模式', format: 'JSON' });
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(config, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return { configured: true, existing: false, file };
}
if (require.main === module) {
  try { console.log(JSON.stringify(configure(process.env.GEOGI_WECHAT_PUSH_CONFIG_FILE || DEFAULT_CONFIG))); }
  catch (_) { console.error('wechat_push_config_failed'); process.exitCode = 1; }
}
module.exports = { configure };
