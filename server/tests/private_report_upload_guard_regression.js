'use strict';
const assert = require('node:assert/strict');
const { isProtectedReportUploadPath: hidden } = require('../src/services/private-report-upload-guard');
const stem = 'GeoGi-V21-0123456789abcdef.pdf';
const paths = [
  '/'+stem, '/'+stem.toUpperCase(), '/./'+stem,
  '/foo/../'+stem, '/foo/'+stem, '/foo//'+stem,
  '/foo%2f..%2f'+stem, '/%2e/'+stem,
  '/%252e/'+stem, '/%255c'+stem,
  '/GeoGi-V2-0123456789abcdef.pdf',
  '/Example.HTML', '/foo/../example.htm',
  '/broken%zz'
];
for (const value of paths) assert.equal(hidden(value), true, value);
for (const value of ['/invoice.pdf','/foo/manual.pdf','/my-image.png','/file.txt']) {
  assert.equal(hidden(value), false, value);
}
console.log('Private report public-path guard: '+(paths.length+4)+' cases passed');
