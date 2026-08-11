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
    fileId: path.basename(file.filename, path.extname(file.filename)),
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

function findStoredUpload(fileId) {
  const cleanId = safeName(fileId);
  if (!cleanId || !fs.existsSync(uploadRoot)) return null;
  const dirs = fs.readdirSync(uploadRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const dir of dirs) {
    const dirPath = path.join(uploadRoot, dir.name);
    const match = fs.readdirSync(dirPath).find((name) => path.basename(name, path.extname(name)) === cleanId);
    if (match) {
      const filePath = path.join(dirPath, match);
      if (filePath.startsWith(`${uploadRoot}${path.sep}`) && fs.statSync(filePath).isFile()) return filePath;
    }
  }
  return null;
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
}

module.exports = {
  uploadMiddleware,
  normalizeUpload,
  validateStoredUpload,
  findStoredUpload,
  getUploadRoot
};
