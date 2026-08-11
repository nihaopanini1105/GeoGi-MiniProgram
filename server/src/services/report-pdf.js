const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPORT_DIR = path.resolve(__dirname, '../../output/reports');
const TMP_DIR = path.resolve(__dirname, '../../tmp/reports');

function getReportRoot() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  return REPORT_DIR;
}

function getReportPath(projectId) {
  const cleanProjectId = safeFileName(projectId);
  if (!cleanProjectId) return '';
  return path.join(getReportRoot(), `${cleanProjectId}-geogi-report.pdf`);
}

async function generateReportPdf({ projectId, form, conversations, analyses, report, testedAt, quality }) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const cleanProjectId = safeFileName(projectId);
  const fileName = `${cleanProjectId}-geogi-report.pdf`;
  const outputPath = getReportPath(projectId);
  const inputPath = path.join(TMP_DIR, `${cleanProjectId}.json`);
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
      userMessage: 'PDF报告生成失败，请检查服务器 PDF 组件'
    };
  }

  return {
    ok: true,
    fileName,
    path: outputPath,
    reportId: cleanProjectId,
    url: `/api/customer/reports/${encodeURIComponent(projectId)}/download`
  };
}

function safeFileName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
}

module.exports = {
  generateReportPdf,
  getReportRoot,
  getReportPath
};
