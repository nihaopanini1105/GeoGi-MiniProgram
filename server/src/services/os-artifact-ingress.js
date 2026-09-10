const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));

class OsArtifactIngressError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function safeFileName(value) {
  const name = String(value || '').trim();
  if (!name || path.basename(name) !== name || !/^[a-zA-Z0-9._-]{1,180}$/.test(name)) {
    throw new OsArtifactIngressError('OS_ARTIFACT_FILE_NAME_INVALID');
  }
  return name;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function admitOsArtifact({ body, fileName, expectedSha256, expectedSize, mimeType }) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new OsArtifactIngressError('OS_ARTIFACT_BODY_REQUIRED');
  }
  if (body.length > 25 * 1024 * 1024) {
    throw new OsArtifactIngressError('OS_ARTIFACT_TOO_LARGE');
  }
  const name = safeFileName(fileName);
  const expectedHash = String(expectedSha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw new OsArtifactIngressError('OS_ARTIFACT_SHA256_INVALID');
  }
  const size = Number(expectedSize);
  if (!Number.isSafeInteger(size) || size < 1 || size !== body.length) {
    throw new OsArtifactIngressError('OS_ARTIFACT_SIZE_MISMATCH');
  }
  const actualHash = sha256(body);
  if (actualHash !== expectedHash) {
    throw new OsArtifactIngressError('OS_ARTIFACT_HASH_MISMATCH');
  }

  const root = uploadRoot;
  fs.mkdirSync(root, { recursive: true });
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) {
    throw new OsArtifactIngressError('OS_ARTIFACT_PATH_ESCAPE');
  }
  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target);
    if (existing.length !== body.length || sha256(existing) !== actualHash) {
      throw new OsArtifactIngressError('OS_ARTIFACT_IMMUTABLE_CONFLICT');
    }
  } else {
    const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    fs.writeFileSync(temp, body, { flag: 'wx', mode: 0o640 });
    fs.renameSync(temp, target);
  }

  const publicBase = String(process.env.PUBLIC_UPLOAD_BASE_URL || '').trim().replace(/\/$/, '');
  return {
    fileName: name,
    sha256: actualHash,
    sizeBytes: body.length,
    mimeType: String(mimeType || 'application/octet-stream').slice(0, 120),
    uri: publicBase ? `${publicBase}/${encodeURIComponent(name)}` : `/uploads/${encodeURIComponent(name)}`
  };
}

module.exports = { OsArtifactIngressError, admitOsArtifact, safeFileName };
