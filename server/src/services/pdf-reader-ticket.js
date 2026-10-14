'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TTL_MS=60*1000;
const MAX_PDF_BYTES=30*1024*1024;
const issued=new Map();

function issuePdfTicket({clientId,projectId,sha256,fileName}) {
  if (!clientId || !projectId || !/^[0-9a-f]{64}$/.test(String(sha256||''))
      || !/^[A-Za-z0-9._-]{1,180}\.pdf$/.test(String(fileName||''))) {
    throw new Error('PDF_TICKET_SCOPE_INVALID');
  }
  const token=crypto.randomBytes(32).toString('hex');
  issued.set(token,{clientId,projectId,sha256,fileName,expiresAt:Date.now()+TTL_MS});
  for (const [key,value] of issued) {
    if (value.expiresAt<=Date.now()) issued.delete(key);
  }
  return token;
}
function consumePdfTicket(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token||''))) throw new Error('PDF_TICKET_INVALID');
  const result=issued.get(token);
  issued.delete(token);
  if (!result || result.expiresAt<=Date.now()) throw new Error('PDF_TICKET_EXPIRED');
  return result;
}
function readVerifiedPdfArtifact(root,fileName,sha256) {
  if (!/^[A-Za-z0-9._-]{1,180}\.pdf$/.test(String(fileName||'')) ||
      !/^[0-9a-f]{64}$/.test(String(sha256||''))) throw new Error('PDF_ARTIFACT_INVALID');
  const file=path.resolve(root,fileName);
  if (path.dirname(file)!==path.resolve(root)) throw new Error('PDF_ARTIFACT_SCOPE_INVALID');
  const entry=fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size<12000 || entry.size>MAX_PDF_BYTES) {
    throw new Error('PDF_ARTIFACT_INVALID');
  }
  const raw=fs.readFileSync(file);
  if (raw.subarray(0,5).toString('ascii')!=='%PDF-' ||
      crypto.createHash('sha256').update(raw).digest('hex')!==sha256) {
    throw new Error('PDF_ARTIFACT_INTEGRITY_FAILURE');
  }
  return raw;
}
module.exports={issuePdfTicket,consumePdfTicket,readVerifiedPdfArtifact};
