'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Tickets are single-use and valid for 60 seconds. No durable token is placed in
// a URL and raw customer session tokens are never passed to a web-view.
const TTL_MS = 60 * 1000;
const tickets = new Map();

function issueH5Ticket({ clientId, projectId, sha256, fileName, deliveryPackageId }) {
  if (!clientId || !projectId || !/^[0-9a-f]{64}$/.test(String(sha256 || ''))) {
    throw new Error('H5_TICKET_SCOPE_INVALID');
  }
  if (!/^[a-zA-Z0-9._-]{1,180}\.html$/.test(String(fileName || ''))) {
    throw new Error('H5_TICKET_ARTIFACT_INVALID');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TTL_MS;
  tickets.set(token, { clientId, projectId, sha256, fileName, deliveryPackageId: String(deliveryPackageId || ''), expiresAt });
  // Opportunistic cleanup; never retain expired tickets indefinitely.
  for (const [key, value] of tickets) if (value.expiresAt <= Date.now()) tickets.delete(key);
  return token;
}

function consumeH5Ticket(token) {
  const key = String(token || '');
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('H5_TICKET_INVALID');
  const entry = tickets.get(key);
  tickets.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) throw new Error('H5_TICKET_INVALID');
  return entry;
}

function readVerifiedH5Artifact(root, fileName, sha256) {
  const cleanName = String(fileName || '');
  if (!/^[a-zA-Z0-9._-]{1,180}\.html$/.test(cleanName)) throw new Error('H5_ARTIFACT_INVALID');
  const file = path.resolve(root, cleanName);
  if (path.dirname(file) !== path.resolve(root)) throw new Error('H5_ARTIFACT_INVALID');
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('H5_ARTIFACT_INVALID');
  const bytes = fs.readFileSync(file);
  if (!bytes.toString('utf8', 0, 80).trimStart().toLowerCase().startsWith('<!doctype html>')) {
    throw new Error('H5_ARTIFACT_INVALID');
  }
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error('H5_ARTIFACT_INTEGRITY_FAILURE');
  }
  return bytes;
}

module.exports = { issueH5Ticket, consumeH5Ticket, readVerifiedH5Artifact };
