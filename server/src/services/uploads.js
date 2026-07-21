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
    const submissionId = safeName(req.body.submissionId || 'anonymous');
    const ext = extension(file.originalname);
    cb(null, `${submissionId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${ext}`);
  }
});

const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024
  },
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
  const relativePath = path.relative(uploadRoot, file.path).split(path.sep).join('/');
  const publicBaseUrl = process.env.PUBLIC_UPLOAD_BASE_URL || '';
  return {
    ok: true,
    fileId: path.basename(file.filename, path.extname(file.filename)),
    name: file.originalname,
    size: file.size,
    url: publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/${relativePath}` : `/uploads/${relativePath}`
  };
}

function getUploadRoot() {
  return uploadRoot;
}

function extension(name) {
  return String(name || '').split('.').pop().toLowerCase();
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

module.exports = {
  uploadMiddleware,
  normalizeUpload,
  getUploadRoot
};
