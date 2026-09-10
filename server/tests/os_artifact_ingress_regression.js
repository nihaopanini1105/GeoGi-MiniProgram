const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-os-artifact-'));
process.env.UPLOAD_DIR = root;
process.env.PUBLIC_UPLOAD_BASE_URL = 'https://api.geogi.cn/uploads';

const { admitOsArtifact, OsArtifactIngressError } = require('../src/services/os-artifact-ingress');

const body = Buffer.from('immutable-report-bytes');
const digest = crypto.createHash('sha256').update(body).digest('hex');
const input = {
  body,
  fileName: 'report-customer001.pdf',
  expectedSha256: digest,
  expectedSize: body.length,
  mimeType: 'application/pdf'
};

const first = admitOsArtifact(input);
assert.strictEqual(first.sha256, digest);
assert.strictEqual(first.sizeBytes, body.length);
assert.strictEqual(first.uri, 'https://api.geogi.cn/uploads/report-customer001.pdf');
assert.deepStrictEqual(fs.readFileSync(path.join(root, input.fileName)), body);

const second = admitOsArtifact(input);
assert.deepStrictEqual(second, first, 'same immutable bytes must be idempotent');

assert.throws(
  () => admitOsArtifact({ ...input, body: Buffer.from('different-bytes'), expectedSize: Buffer.byteLength('different-bytes'), expectedSha256: crypto.createHash('sha256').update('different-bytes').digest('hex') }),
  (error) => error instanceof OsArtifactIngressError && error.code === 'OS_ARTIFACT_IMMUTABLE_CONFLICT'
);

assert.throws(
  () => admitOsArtifact({ ...input, expectedSha256: '0'.repeat(64) }),
  (error) => error instanceof OsArtifactIngressError && error.code === 'OS_ARTIFACT_HASH_MISMATCH'
);

assert.throws(
  () => admitOsArtifact({ ...input, fileName: '../escape.pdf' }),
  (error) => error instanceof OsArtifactIngressError && error.code === 'OS_ARTIFACT_FILE_NAME_INVALID'
);

fs.rmSync(root, { recursive: true, force: true });
console.log('os_artifact_ingress_regression: ok');
