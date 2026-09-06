'use strict';

const {
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord
} = require('./feishu');

const REQUIRED_ENV = [
  'FEISHU_BASE_APP_TOKEN',
  'FEISHU_LEADS_TABLE_ID',
  'FEISHU_PROJECTS_TABLE_ID',
  'FEISHU_AI_QUESTION_TABLE_ID',
  'FEISHU_TEST_RECORDS_TABLE_ID',
  'FEISHU_ANALYSIS_TABLE_ID',
  'FEISHU_REPORTS_TABLE_ID'
];

async function evaluateReportRelease({ projectId } = {}) {
  const cleanProjectId = clean(projectId);
  if (!cleanProjectId) throw new Error('缺少项目编号');
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`缺少飞书表配置：${missing.join(', ')}`);

  const tenantToken = await getTenantAccessToken();
  const [leads, projects, expectedQuestions, tests, analyses, reports] = await Promise.all([
    listProjectRows(tenantToken, process.env.FEISHU_LEADS_TABLE_ID, cleanProjectId),
    listProjectRows(tenantToken, process.env.FEISHU_PROJECTS_TABLE_ID, cleanProjectId),
    listProjectRows(tenantToken, process.env.FEISHU_AI_QUESTION_TABLE_ID, cleanProjectId),
    listProjectRows(tenantToken, process.env.FEISHU_TEST_RECORDS_TABLE_ID, cleanProjectId),
    listProjectRows(tenantToken, process.env.FEISHU_ANALYSIS_TABLE_ID, cleanProjectId),
    listProjectRows(tenantToken, process.env.FEISHU_REPORTS_TABLE_ID, cleanProjectId)
  ]);

  const blockers = [];
  const warnings = [];
  if (!leads.length) blockers.push('missing_customer_record');
  if (!projects.length) blockers.push('missing_project_record');
  if (!expectedQuestions.length) blockers.push('missing_expected_ai_questions');
  if (!reports.length) blockers.push('missing_report_draft');

  const report = reports[0] || null;
  const reportFields = (report && report.fields) || {};
  const expectedCount = expectedQuestions.length;

  if (expectedCount && tests.length !== expectedCount) {
    blockers.push(`platform_test_count_mismatch:${tests.length}/${expectedCount}`);
  }
  if (expectedCount && analyses.length !== expectedCount) {
    blockers.push(`analysis_count_mismatch:${analyses.length}/${expectedCount}`);
  }

  const incompleteTests = tests.filter((row) => {
    const fields = row.fields || {};
    const answer = text(fields.回答原文);
    const readCompleteness = text(fields.读取完整性);
    return !answer
      || /未读取到完整回答原文|待补充回答原文/.test(answer)
      || /^0$/.test(text(fields.原始内容长度))
      || /读取受限|待补充/.test(readCompleteness);
  });
  if (incompleteTests.length) {
    blockers.push(`incomplete_platform_answers:${incompleteTests.length}`);
  }

  const pendingAnalyses = analyses.filter((row) => {
    const fields = row.fields || {};
    return /待补充|待复核/.test(text(fields.分析状态));
  });
  if (pendingAnalyses.length) warnings.push(`analysis_needs_manual_review:${pendingAnalyses.length}`);

  if (report) {
    if (!text(reportFields.报告正文)) blockers.push('report_body_missing');
    if (!text(reportFields.报告链接)) blockers.push('report_pdf_missing');
    if (text(reportFields.报告状态) === '待补充回答原文') blockers.push('report_waiting_for_answer_text');
    if (!/报告待复核|已确认/.test(text(reportFields.审核状态))) {
      warnings.push(`unexpected_report_review_status:${text(reportFields.审核状态) || 'empty'}`);
    }
  }

  return {
    ok: true,
    projectId: cleanProjectId,
    readyForH6: blockers.length === 0,
    blockers,
    warnings,
    counts: {
      expectedAiQuestions: expectedCount,
      platformTests: tests.length,
      analyses: analyses.length,
      reports: reports.length,
      incompletePlatformAnswers: incompleteTests.length
    },
    report: report ? {
      recordId: report.record_id,
      status: text(reportFields.报告状态),
      reviewStatus: text(reportFields.审核状态),
      pdfUrl: text(reportFields.报告链接),
      version: text(reportFields.报告版本)
    } : null,
    operationalBoundary: 'assisted_v1_release_gate_not_full_g19_h6_runtime'
  };
}

async function publishReport({ projectId, confirmedBy = 'GeoGi 负责人' } = {}) {
  const evaluation = await evaluateReportRelease({ projectId });
  if (!evaluation.readyForH6) {
    return {
      ...evaluation,
      published: false,
      userMessage: `报告尚不能发布：${evaluation.blockers.join('、')}`
    };
  }

  const tenantToken = await getTenantAccessToken();
  const [reports, leads, projects] = await Promise.all([
    listProjectRows(tenantToken, process.env.FEISHU_REPORTS_TABLE_ID, projectId),
    listProjectRows(tenantToken, process.env.FEISHU_LEADS_TABLE_ID, projectId),
    listProjectRows(tenantToken, process.env.FEISHU_PROJECTS_TABLE_ID, projectId)
  ]);
  const report = reports[0];
  if (!report || !report.record_id) throw new Error('报告记录不存在');

  const now = new Date().toISOString();
  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_REPORTS_TABLE_ID,
    recordId: report.record_id,
    fields: {
      报告状态: '已发布',
      审核状态: '已确认',
      更新时间: now,
      交付说明: appendLine(text(report.fields && report.fields.交付说明), `H6人工确认：${confirmedBy}；${now}`)
    }
  });

  if (leads[0] && leads[0].record_id) {
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      recordId: leads[0].record_id,
      fields: {
        当前状态: '报告已完成',
        下一步动作: '客户可在小程序查看正式报告'
      }
    });
  }

  if (projects[0] && projects[0].record_id) {
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      recordId: projects[0].record_id,
      fields: {
        当前阶段: '已交付',
        实际交付时间: now,
        内部备注: appendLine(text(projects[0].fields && projects[0].fields.内部备注), `Customer Delivery V1 H6人工确认并发布：${confirmedBy}；${now}`)
      }
    });
  }

  return {
    ...evaluation,
    published: true,
    publishedAt: now,
    confirmedBy,
    status: '已发布',
    reviewStatus: '已确认'
  };
}

async function listProjectRows(tenantToken, tableId, projectId) {
  if (!tableId) return [];
  const rows = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return rows.filter((row) => text((row.fields || {}).项目编号).includes(projectId));
}

function appendLine(current, line) {
  return current ? `${current}\n${line}` : line;
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.name) return String(value.name).trim();
    if (value.value) return String(value.value).trim();
    if (value.link) return String(value.link).trim();
    return JSON.stringify(value);
  }
  return String(value || '').trim();
}

function clean(value) {
  return String(value || '').trim();
}

module.exports = {
  evaluateReportRelease,
  publishReport
};
