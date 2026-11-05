'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { configure } = require('../src/scripts/configure-wechat-message-push');
const { ENDPOINT, createRouter, signature, decrypt, encryptResponse } = require('../src/services/wechat-message-push');

// Independent fixture encoder implements the documented 32-byte PKCS#7 frame.
function encrypted(config, message, options = {}) {
  const data = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message));
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const frame = Buffer.concat([Buffer.alloc(16, 17), length, data, Buffer.from(options.appId || config.appId)]);
  const pad = 32 - frame.length % 32;
  const padded = Buffer.concat([frame, Buffer.alloc(pad, pad)]);
  if (options.badPadding) padded[padded.length - 2] ^= 1;
  const key = Buffer.from(config.encodingAESKey + '=', 'base64');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}
function query(config, ciphertext) {
  const timestamp = '1793846400', nonce = 'testNonce';
  const fields = [config.token, timestamp, nonce];
  if (ciphertext) fields.push(ciphertext);
  const digest = crypto.createHash('sha1').update(fields.sort().join('')).digest('hex');
  return new URLSearchParams({ timestamp, nonce, ...(ciphertext ? { encrypt_type: 'aes', msg_signature: digest } : { signature: digest }) });
}
async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-push-test-'));
  const file = path.join(dir, 'private-config.json');
  configure(file);
  const original = fs.readFileSync(file, 'utf8');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(configure(file).existing, true);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'idempotent setup never rotates secrets');
  const config = JSON.parse(original);
  // Golden vectors from WeChat's official message-push documentation.
  const official = { token: 'AAAAA', encodingAESKey: 'A'.repeat(43), appId: 'wxba5fad812f8e6fb9' };
  const vector = '+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=';
  assert.equal(signature(official.token, '1714112445', '415670741', vector), '046e02f8204d34f8ba5fa3b1db94908f3df2e9b3');
  assert.equal(JSON.parse(decrypt(official, vector)).debug_str, 'hello world');
  const reply = encryptResponse(official, { demo_resp: 'good luck' }, '415670741', { random: Buffer.from('707722b803182950'), timestamp: 1713424427 });
  assert.equal(reply.Encrypt, 'ELGduP2YcVatjqIS+eZbp80MNLoAUWvzzyJxgGzxZO/5sAvd070Bs6qrLARC9nVHm48Y4hyRbtzve1L32tmxSQ==');
  assert.equal(JSON.parse(decrypt(official, reply.Encrypt)).demo_resp, 'good luck');

  let enabled = true;
  const app = express();
  app.use(ENDPOINT, createRouter({ getConfig: () => enabled ? config : null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = 'http://127.0.0.1:' + server.address().port + ENDPOINT;
  const post = (q, body, type = 'application/json') => fetch(base + '?' + q, { method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    let q = query(config); q.set('echostr', 'wx-verification-challenge');
    let response = await fetch(base + '?' + q);
    assert.equal(response.status, 200); assert.equal(await response.text(), 'wx-verification-challenge');
    q.set('signature', '0'.repeat(40)); assert.equal((await fetch(base + '?' + q)).status, 403);
    q = query(config); q.append('nonce', 'duplicate'); q.set('echostr', 'probe');
    assert.equal((await fetch(base + '?' + q)).status, 403, 'ambiguous query rejected');
    const echo = encrypted(config, 'encrypted-challenge'); q = query(config, echo); q.set('echostr', echo);
    response = await fetch(base + '?' + q); assert.equal(response.status, 200); assert.equal(await response.text(), 'encrypted-challenge');
    const msg = encrypted(config, { MsgType: 'event', Event: 'debug_demo', Content: 'synthetic probe' });
    response = await post(query(config, msg), { Encrypt: msg });
    assert.equal(response.status, 200); assert.equal(await response.text(), 'success');
    await post(query(config, msg), { Encrypt: msg });
    assert.equal(fs.readdirSync(config.inbox).length, 1, 'duplicate push creates one receipt');
    const saved = path.join(config.inbox, fs.readdirSync(config.inbox)[0]);
    assert.equal(fs.statSync(saved).mode & 0o777, 0o600);
    assert(!fs.readFileSync(saved, 'utf8').includes('synthetic probe'), 'inbox stores ciphertext only');
    q = query(config, msg); q.set('msg_signature', '0'.repeat(40));
    assert.equal((await post(q, { Encrypt: msg })).status, 403);
    for (const options of [{ appId: 'wxOtherTenant' }, { badPadding: true }]) {
      const bad = encrypted(config, { Event: 'debug_demo' }, options);
      assert.equal((await post(query(config, bad), { Encrypt: bad })).status, 403);
    }
    assert.equal((await post(query(config), { Event: 'xpay_goods_deliver_notify' })).status, 403, 'plaintext cannot bypass safety mode');
    assert.equal((await post(query(config, msg), '<xml/>', 'text/xml')).status, 415);
    assert.equal((await post(query(config, msg), '{')).status, 400);
    assert.equal((await post(query(config, msg), JSON.stringify({ Encrypt: 'a'.repeat(140000) }))).status, 413);
    const money = encrypted(config, { Event: 'xpay_goods_deliver_notify', OutTradeNo: 'synthetic' });
    response = await post(query(config, money), { Encrypt: money });
    assert.equal(response.status, 503, 'money callbacks cannot be acknowledged before the payment processor exists');
    assert.equal((await response.json()).ErrCode, 1);
    enabled = false;
    assert.equal((await fetch(base + '?' + query(config) + '&echostr=probe')).status, 503);
    assert.equal((await post(query(config, msg), { Encrypt: msg })).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('wechat-message-push-regression-ok');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
