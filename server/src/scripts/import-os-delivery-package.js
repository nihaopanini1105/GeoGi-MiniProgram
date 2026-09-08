'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getPackageRoot,
  getArtifactRoot,
  validateDeliveryPackage
} = require('../services/delivery-package-store');

function usage() {
  console.error('usage: node src/scripts/import-os-delivery-package.js <package.json> <artifact-dir>');
  process.exit(2);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeFileName(value) {
  const name = path.basename(String(value || '').trim());
  if (!name || name !== String(value || '').trim()) throw new Error('ARTIFACT_FILE_NAME_INVALID');
  return name;
}

function main() {
  const packageFile = process.argv[2];
  const sourceArtifactDir = process.argv[3];
  if (!packageFile || !sourceArtifactDir) usage();
  const payload = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const projectId = String(payload.external_project_id || '').trim();
  if (!projectId) throw new Error('EXTERNAL_PROJECT_ID_REQUIRED');
  validateDeliveryPackage(payload, projectId);

  fs.mkdirSync(getPackageRoot(), { recursive: true });
  fs.mkdirSync(getArtifactRoot(), { recursive: true });

  const staged = [];
  for (const artifact of payload.artifacts) {
    const fileName = safeFileName(artifact.file_name);
    const source = path.resolve(sourceArtifactDir, fileName);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`ARTIFACT_FILE_MISSING:${fileName}`);
    const actualSha = sha256(source);
    if (actualSha !== artifact.sha256) throw new Error(`ARTIFACT_SHA_MISMATCH:${fileName}`);
    const expectedUri = `/delivery/${fileName}`;
    if (artifact.uri !== expectedUri && !/^https:\/\//i.test(String(artifact.uri || ''))) {
      throw new Error(`ARTIFACT_URI_INVALID:${fileName}`);
    }
    staged.push({ source, target: path.join(getArtifactRoot(), fileName) });
  }

  for (const item of staged) fs.copyFileSync(item.source, item.target);
  const targetPackage = path.join(getPackageRoot(), `${projectId}.json`);
  const tempPackage = `${targetPackage}.tmp-${process.pid}`;
  fs.writeFileSync(tempPackage, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPackage, targetPackage);

  console.log(`DELIVERY_PACKAGE_ID=${payload.delivery_package_id}`);
  console.log(`EXTERNAL_PROJECT_ID=${projectId}`);
  console.log(`ARTIFACT_COUNT=${payload.artifacts.length}`);
  console.log('OS_DELIVERY_PACKAGE_IMPORTED=True');
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}
