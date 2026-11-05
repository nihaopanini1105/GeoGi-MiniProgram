'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const ENDPOINT = '/api/wechat/message-push';
const DEFAULT_CONFIG = '/opt/geogi-mini-program/shared/wechat-message-push.json';

function reject(code) { const error = new Error(code); error.code = code; throw error; }
function scalar(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) reject('INVALID_ENVELOPE');
  return value;
}
function validateConfig(config) {
  if (!config || !/^[A-Za-z0-9]{3,32}$/.test(config.token || '') ||
      !/^[A-Za-z0-9+/]{43}$/.test(config.encodingAESKey || '') ||
      !/^wx[A-Za-z0-9]+$/.test(config.appId || '') ||
      !path.isAbsolute(config.inbox || '')) reject('PUSH_NOT_CONFIGURED');
  const key = Buffer.from(config.encodingAESKey + '=', 'base64');
  if (key.length !== 32 || key.toString('base64').slice(0, -1) !== config.encodingAESKey) reject('PUSH_NOT_CONFIGURED');
  return config;
}
function loadConfig() {
  const file = process.env.GEOGI_WECHAT_PUSH_CONFIG_FILE || DEFAULT_CONFIG;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) reject('PUSH_NOT_CONFIGURED');
    const config = validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    const appId = process.env.WECHAT_APP_ID || process.env.WECHAT_MINI_PROGRAM_APPID;
    if (!appId || config.appId !== appId) reject('PUSH_NOT_CONFIGURED');
    return config;
  } catch (_) { reject('PUSH_NOT_CONFIGURED'); }
}
function signature(token, timestamp, nonce, encrypted) {
  const parts = [token, timestamp, nonce];
  if (encrypted !== undefined) parts.push(encrypted);
  return crypto.createHash('sha1').update(parts.sort().join('')).digest('hex');
}
function verifySignature(config, query, encrypted) {
  const timestamp = scalar(query.timestamp, /^\d{1,16}$/);
  const nonce = scalar(query.nonce, /^[A-Za-z0-9_-]{1,128}$/);
  const actual = scalar(encrypted === undefined ? query.signature : query.msg_signature, /^[0-9a-fA-F]{40}$/);
  const expected = signature(config.token, timestamp, nonce, encrypted);
  if (!crypto.timingSafeEqual(Buffer.from(actual.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'))) reject('INVALID_SIGNATURE');
}
function decrypt(config, encrypted) {
  scalar(encrypted, /^[A-Za-z0-9+/]+={0,2}$/);
  const input = Buffer.from(encrypted, 'base64');
  if (input.length < 32 || input.length % 16 || input.toString('base64') !== encrypted) reject('INVALID_CIPHERTEXT');
  const key = Buffer.from(config.encodingAESKey + '=', 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(input), decipher.final()]);
  const pad = padded[padded.length - 1];
  if (pad < 1 || pad > 32 || !padded.subarray(-pad).every((byte) => byte === pad)) reject('INVALID_CIPHERTEXT');
  const plain = padded.subarray(0, -pad);
  if (plain.length < 20) reject('INVALID_CIPHERTEXT');
  const length = plain.readUInt32BE(16);
  if (length > plain.length - 20 || plain.subarray(20 + length).toString('utf8') !== config.appId) reject('INVALID_APPID');
  return plain.subarray(20, 20 + length).toString('utf8');
}
function encryptResponse(config, message, nonce, options = {}) {
  const msg = Buffer.from(JSON.stringify(message));
  const length = Buffer.alloc(4); length.writeUInt32BE(msg.length);
  const random = options.random || crypto.randomBytes(16);
  const frame = Buffer.concat([random, length, msg, Buffer.from(config.appId)]);
  const padding = 32 - frame.length % 32;
  const key = Buffer.from(config.encodingAESKey + '=', 'base64');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false);
  const Encrypt = Buffer.concat([cipher.update(Buffer.concat([frame, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64');
  const TimeStamp = options.timestamp || Math.floor(Date.now() / 1000);
  return { Encrypt, MsgSignature: signature(config.token, String(TimeStamp), nonce, Encrypt), TimeStamp, Nonce: nonce };
}
function saveEnvelope(config, query, encrypted) {
  fs.mkdirSync(config.inbox, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(config.inbox);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) reject('INBOX_UNAVAILABLE');
  const id = crypto.createHash('sha256').update(encrypted).digest('hex');
  const file = path.join(config.inbox, id + '.json');
  const data = JSON.stringify({ receivedAt: new Date().toISOString(), timestamp: query.timestamp,
    nonce: query.nonce, msgSignature: query.msg_signature, encrypted, state: 'received' });
  // Atomic no-clobber publication; repeated delivery never overwrites a receipt.
  const temp = path.join(config.inbox, '.' + crypto.randomBytes(16).toString('hex'));
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { fs.unlinkSync(temp); }
  const dir = fs.openSync(config.inbox, 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function createRouter(options = {}) {
  const router = express.Router();
  const getConfig = options.getConfig || loadConfig;
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/', (req, res) => {
    try {
      const config = validateConfig(getConfig());
      const echo = scalar(req.query.echostr, /^[\s\S]{1,4096}$/);
      if (req.query.msg_signature !== undefined) {
        verifySignature(config, req.query, echo);
        return res.type('text/plain').send(decrypt(config, echo));
      }
      verifySignature(config, req.query);
      return res.type('text/plain').send(echo);
    } catch (error) {
      return res.status(error.code === 'PUSH_NOT_CONFIGURED' ? 503 : 403).json({ ok: false, code: 'PUSH_VERIFICATION_FAILED' });
    }
  });
  router.post('/', express.json({ limit: '128kb' }), async (req, res) => {
    let config;
    try { config = validateConfig(getConfig()); }
    catch (_) { return res.status(503).json({ ok: false, code: 'PUSH_NOT_CONFIGURED' }); }
    if (!req.is('application/json')) return res.status(415).json({ ok: false, code: 'JSON_REQUIRED' });
    let encrypted;
    let message;
    try {
      encrypted = scalar(req.body && req.body.Encrypt, /^[A-Za-z0-9+/]+={0,2}$/);
      verifySignature(config, req.query, encrypted);
      if (req.query.encrypt_type !== 'aes') reject('ENCRYPTION_REQUIRED');
      message = JSON.parse(decrypt(config, encrypted));
      if (!message || typeof message !== 'object' || Array.isArray(message)) reject('INVALID_MESSAGE');
    } catch (_) { return res.status(403).json({ ok: false, code: 'PUSH_VERIFICATION_FAILED' }); }
    try { saveEnvelope(config, req.query, encrypted); }
    catch (_) { return res.status(503).json({ ok: false, code: 'INBOX_UNAVAILABLE' }); }
    // Acknowledging a money event before an order processor exists would lose it.
    // Keep payment events retryable; no customer access or ledger mutation here.
    const event = String(message.Event || message.event || '');
    if (/^xpay_/i.test(event)) {
      try {
        const handler = options.handlePaymentEvent || ((msg) => require('./wechat-virtual-payment').defaultService().handleEvent(msg));
        const result = await handler(message);
        if (result && result.IosRefundQueryResponse) return res.json(encryptResponse(config, result, req.query.nonce));
        return res.type('text/plain').send('success');
      } catch (_) { return res.status(503).json({ ErrCode: 1, ErrMsg: 'payment_processing_pending' }); }
    }
    return res.type('text/plain').send('success');
  });
  router.use((error, _req, res, _next) => {
    return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: 'INVALID_PUSH_BODY' });
  });
  return router;
}
module.exports = { ENDPOINT, DEFAULT_CONFIG, createRouter, validateConfig, signature, decrypt, encryptResponse };
