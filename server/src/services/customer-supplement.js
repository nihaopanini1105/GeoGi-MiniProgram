const {
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord
} = require('./feishu');

async function submitCustomerSupplement(input = {}) {
  try {
    const supplement = sanitizeSupplement(input);
    const validationError = validateSupplement(supplement);
    if (validationError) return fail(validationError);

    const tenantToken = await getTenantAccessToken();
    const lead = await findRecord({
      tenantToken,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      predicate: (fields) => text(fields.客户编号) === supplement.clientId
        && text(fields.项目编号) === supplement.projectId
    });
    if (!lead) return fail('没有找到这条诊断记录');

    const leadFields = lead.fields || {};
    const leadUpdates = buildLeadUpdates({ fields: leadFields, supplement });
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      recordId: recordId(lead),
      fields: leadUpdates
    });

    let projectUpdated = false;
    if (process.env.FEISHU_PROJECTS_TABLE_ID) {
      const project = await findRecord({
        tenantToken,
        tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
        predicate: (fields) => text(fields.客户编号) === supplement.clientId
          && text(fields.项目编号) === supplement.projectId
      });
      if (project) {
        const projectUpdates = buildProjectUpdates({ fields: project.fields || {}, supplement });
        if (Object.keys(projectUpdates).length) {
          await updateBitableRecord({
            tenantToken,
            appToken: process.env.FEISHU_BASE_APP_TOKEN,
            tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
            recordId: recordId(project),
            fields: projectUpdates
          });
        }
        projectUpdated = true;
      }
    }

    return {
      ok: true,
      clientId: supplement.clientId,
      projectId: supplement.projectId,
      companyName: supplement.companyName || text(leadFields.企业名称),
      filesAccepted: supplement.files.length,
      projectUpdated,
      status: '补充资料已接收',
      canonicalStageMutated: false,
      authority: 'GeoGi OS',
      nextAction: 'GeoGi OS 将重新读取并核验补充资料；项目阶段仅由 OS 更新。'
    };
  } catch (error) {
    console.error('submitCustomerSupplement failed', error);
    return fail('补充资料提交失败，请稍后重试');
  }
}

function sanitizeSupplement(input = {}) {
  const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
  return {
    clientId: clean(input.clientId, 160),
    projectId: clean(input.projectId, 160),
    companyName: clean(input.companyName, 160),
    note: clean(input.note, 1000),
    files: normalizeFiles(input.files)
  };
}

function normalizeFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((item) => ({
    name: String(item && item.name || '').trim().slice(0, 160),
    fileId: String(item && item.fileId || '').trim().slice(0, 200),
    url: String(item && item.url || '').trim().slice(0, 1000),
    size: Number(item && item.size || 0)
  })).filter((item) => item.name && (item.fileId || item.url));
}

function validateSupplement(value) {
  if (!value.clientId) return '缺少客户编号';
  if (!value.projectId) return '缺少诊断编号';
  if (!value.companyName && !value.note && !value.files.length) return '请填写补充信息或上传资料';
  return '';
}

function buildLeadUpdates({ fields, supplement }) {
  const updates = {};
  if (supplement.companyName) updates.企业名称 = supplement.companyName;
  if (supplement.files.length) {
    updates.附件资料 = appendText(
      text(fields.附件资料),
      supplement.files.map(formatFile).join('\n')
    );
  }
  if (supplement.note) {
    updates.补充说明 = appendText(text(fields.补充说明), `【客户补充】${supplement.note}`);
  }

  // 当前状态 / 下一步动作 / 审核状态 are OS-owned projection fields.
  // Customer supplement ingress must never advance, regress, or override them.
  return updates;
}

function buildProjectUpdates({ fields, supplement }) {
  const updates = {};
  const summary = [
    supplement.companyName ? `企业主体：${supplement.companyName}` : '',
    supplement.files.length ? `补充附件 ${supplement.files.length} 个` : '',
    supplement.note ? `客户说明：${supplement.note}` : ''
  ].filter(Boolean).join('；');
  if (summary) {
    updates.内部备注 = appendText(text(fields.内部备注), `客户补充资料（待 GeoGi OS 重新摄取）：${summary}`);
  }

  // 当前阶段 / 审核状态 are projections written only by the authenticated OS bridge.
  return updates;
}

async function findRecord({ tenantToken, tableId, predicate }) {
  if (!tableId) return null;
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return records.find((record) => predicate(record.fields || {})) || null;
}

function recordId(record) {
  return record && (record.record_id || record.recordId || record.id) || '';
}

function formatFile(file) {
  return `${file.name}: ${file.url || file.fileId}`;
}

function appendText(existing, next) {
  return [String(existing || '').trim(), String(next || '').trim()].filter(Boolean).join('\n');
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

function fail(userMessage) {
  return { ok: false, userMessage };
}

module.exports = {
  submitCustomerSupplement,
  sanitizeSupplement,
  validateSupplement,
  buildLeadUpdates,
  buildProjectUpdates
};