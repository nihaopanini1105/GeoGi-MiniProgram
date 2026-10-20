'use strict';
// Public file serving must not expose V2/V2.1 report artifacts via alternative
// path spellings. The authenticated ticket reader is their only download path.
const path = require('node:path');
function isProtectedReportUploadPath(value) {
  let decoded;
  try { decoded = decodeURIComponent(String(value || '')).toLowerCase(); }
  catch (_) { return true; }
  // Never permit public paths that require a second decoding of slashes/dots;
  // a downstream static middleware may normalize them into another pathname.
  if (/%(?:2e|2f|5c|25)/i.test(decoded)) return true;
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'));
  const filename = path.posix.basename(normalized);
  return /\.html?$/.test(filename) || /^geogi-v2(?:1)?-[a-f0-9]{16}\.pdf$/.test(filename);
}
module.exports = { isProtectedReportUploadPath };
