const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPORT_DIR = path.resolve(__dirname, '../../output/reports');
const TMP_DIR = path.resolve(__dirname, '../../tmp/reports');

function getReportRoot() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  return REPORT_DIR;
}

async function generateReportPdf({ projectId, form, conversations, analyses, report, testedAt, quality }) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const fileName = `${safeFileName(projectId)}-geogi-report.pdf`;
  const outputPath = path.join(REPORT_DIR, fileName);
  const inputPath = path.join(TMP_DIR, `${safeFileName(projectId)}.json`);
  const payload = {
    projectId,
    form,
    conversations,
    analyses,
    report,
    quality,
    testedAt,
    outputPath
  };
  fs.writeFileSync(inputPath, JSON.stringify(payload, null, 2), 'utf8');

  const python = process.env.PYTHON_BIN || process.env.PYTHON || 'python3';
  const script = path.resolve(__dirname, '../scripts/render-report-pdf.py');
  const result = spawnSync(python, [script, inputPath, outputPath], {
    encoding: 'utf8',
    timeout: 30000
  });

  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const error = (result.stderr || result.stdout || 'PDF生成失败').slice(0, 500);
    return {
      ok: false,
      error,
      userMessage: `PDF报告生成失败：${error}`
    };
  }

  return {
    ok: true,
    fileName,
    path: outputPath,
    url: `${publicBaseUrl()}/reports/${encodeURIComponent(fileName)}`
  };
}

function publicBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const host = process.env.HOST || '127.0.0.1';
  const port = process.env.PORT || '3000';
  return `http://${host}:${port}`;
}

function safeFileName(value) {
  return String(value || 'report').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
}

module.exports = {
  generateReportPdf,
  getReportRoot
};
