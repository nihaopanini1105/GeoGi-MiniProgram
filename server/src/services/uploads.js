const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png']);
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const now = new Date();
    const dir = path.join(uploadRoot, `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const submissionId = safeName(req.body.submissionId || 'anonymous') || 'upload';
    const ext = extension(file.originalname);
    cb(null, `${submissionId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${ext}`);
  }
});

const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = extension(file.originalname);
    if (!allowedExtensions.has(ext)) {
      cb(new Error('FILE_TYPE_NOT_ALLOWED'));
      return;
    }
    cb(null, true);
  }
}).single('file');

function normalizeUpload(file) {
  return {
    ok: true,
    fileId: fileIdFromPath(file.path || file.filename),
    name: file.originalname,
    size: file.size
  };
}

function validateStoredUpload(file) {
  if (!file || !file.path) return false;
  const ext = extension(file.originalname);
  let fd;
  try {
    fd = fs.openSync(file.path, 'r');
    const header = Buffer.alloc(8);
    const bytes = fs.readSync(fd, header, 0, 8, 0);
    const sig = header.subarray(0, bytes);
    const isPdf = ext === 'pdf' && sig.subarray(0, 5).toString() === '%PDF-';
    const isJpeg = ['jpg', 'jpeg'].includes(ext) && sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff;
    const isPng = ext === 'png' && sig.length >= 8 && sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isZipOffice = ['docx', 'pptx'].includes(ext) && sig[0] === 0x50 && sig[1] === 0x4b;
    const isOleOffice = ['doc', 'ppt'].includes(ext) && sig.length >= 8 && sig.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    const valid = isPdf || isJpeg || isPng || isZipOffice || isOleOffice;
    if (!valid) removeQuietly(file.path);
    return valid;
  } catch (error) {
    console.error('validateStoredUpload failed', error);
    removeQuietly(file.path);
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_error) {}
    }
  }
}

function registerUpload(file, { phoneNumber } = {}) {
  if (!file || !file.path || !fs.existsSync(file.path)) return null;
  const metadata = {
    fileId: fileIdFromPath(file.path),
    name: String(file.originalname || '').slice(0, 240),
    size: Number(file.size || 0),
    ownerHash: identityHash(phoneNumber),
    uploadedAt: new Date().toISOString(),
    clientId: '',
    projectId: '',
    boundAt: ''
  };
  writeMetadata(file.path, metadata);
  return metadata;
}

function bindUploadsToProject(uploads, { phoneNumber, clientId, projectId } = {}) {
  const ownerHash = identityHash(phoneNumber);
  const cleanClientId = safeName(clientId);
  const cleanProjectId = safeName(projectId);
  const bound = [];
  const rejected = [];

  for (const item of Array.isArray(uploads) ? uploads : []) {
    const fileId = safeName(item && item.fileId);
    if (!fileId) continue;
    const storedPath = findStoredUpload(fileId);
    if (!storedPath) {
      rejected.push({ fileId, reason: 'FILE_NOT_FOUND' });
      continue;
    }
    const metadata = readMetadata(storedPath);
    if (!metadata || !metadata.ownerHash || metadata.ownerHash !== ownerHash) {
      rejected.push({ fileId, reason: 'OWNER_MISMATCH' });
      continue;
    }
    const next = {
      ...metadata,
      clientId: cleanClientId,
      projectId: cleanProjectId,
      boundAt: new Date().toISOString()
    };
    writeMetadata(storedPath, next);
    bound.push(publicMetadata(next));
  }

  return { ok: rejected.length === 0, bound, rejected };
}

function listProjectUploads(projectId) {
  const cleanProjectId = safeName(projectId);
  if (!cleanProjectId || !fs.existsSync(uploadRoot)) return [];
  const output = [];
  forEachStoredFile((filePath) => {
    const metadata = readMetadata(filePath);
    if (metadata && metadata.projectId === cleanProjectId) output.push(publicMetadata(metadata));
  });
  return output.sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
}

function getBoundUpload(fileId) {
  const storedPath = findStoredUpload(fileId);
  if (!storedPath) return null;
  const metadata = readMetadata(storedPath);
  if (!metadata || !metadata.clientId || !metadata.projectId) return null;
  return { path: storedPath, metadata: publicMetadata(metadata) };
}

function findStoredUpload(fileId) {
  const cleanId = safeName(fileId);
  if (!cleanId || !fs.existsSync(uploadRoot)) return null;
  let found = null;
  forEachStoredFile((filePath) => {
    if (!found && fileIdFromPath(filePath) === cleanId) found = filePath;
  });
  return found;
}

function forEachStoredFile(visitor) {
  const dirs = fs.readdirSync(uploadRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const dir of dirs) {
    const dirPath = path.join(uploadRoot, dir.name);
    for (const name of fs.readdirSync(dirPath)) {
      if (name.endsWith('.meta.json')) continue;
      const filePath = path.join(dirPath, name);
      if (filePath.startsWith(`${uploadRoot}${path.sep}`) && fs.statSync(filePath).isFile()) visitor(filePath);
    }
  }
}

function publicMetadata(metadata) {
  return {
    fileId: metadata.fileId,
    name: metadata.name,
    size: metadata.size,
    uploadedAt: metadata.uploadedAt,
    clientId: metadata.clientId,
    projectId: metadata.projectId,
    boundAt: metadata.boundAt,
    downloadPath: metadata.fileId ? `/api/internal/uploads/${encodeURIComponent(metadata.fileId)}/download` : ''
  };
}

function readMetadata(filePath) {
  try {
    const metaPath = `${filePath}.meta.json`;
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    console.error('read upload metadata failed', error);
    return null;
  }
}

function writeMetadata(filePath, metadata) {
  fs.writeFileSync(`${filePath}.meta.json`, JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function identityHash(value) {
  return crypto.createHash('sha256').update(String(value || '').trim()).digest('hex');
}

function fileIdFromPath(value) {
  const fileName = path.basename(String(value || ''));
  return path.basename(fileName, path.extname(fileName));
}

function getUploadRoot() {
  return uploadRoot;
}

function extension(name) {
  return String(name || '').split('.').pop().toLowerCase();
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function removeQuietly(filePath) {
  try { fs.unlinkSync(filePath); } catch (_error) {}
  try { fs.unlinkSync(`${filePath}.meta.json`); } catch (_error) {}
}

module.exports = {
  uploadMiddleware,
  normalizeUpload,
  validateStoredUpload,
  registerUpload,
  bindUploadsToProject,
  listProjectUploads,
  getBoundUpload,
  findStoredUpload,
  getUploadRoot
};
