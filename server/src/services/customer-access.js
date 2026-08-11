const { getTenantAccessToken, listBitableRecords } = require('./feishu');
const { normalizePhone } = require('./customer-auth');

async function verifyCustomerAccess({ phoneNumber, clientId, projectId }) {
  const phone = normalizePhone(phoneNumber);
  const cleanClientId = clean(clientId);
  const cleanProjectId = clean(projectId);
  if (!phone || !cleanClientId) {
    return { ok: false, userMessage: '客户身份验证失败' };
  }

  const tableId = process.env.FEISHU_LEADS_TABLE_ID;
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!tableId || !appToken) {
    console.error('Customer access verification missing Feishu lead configuration');
    return { ok: false, userMessage: '客户身份服务暂时不可用' };
  }

  try {
    const tenantToken = await getTenantAccessToken();
    const records = await listBitableRecords({
      tenantToken,
      appToken,
      tableId,
      pageSize: 100
    });

    const matched = records.find((record) => {
      const fields = (record && record.fields) || {};
      if (text(fields.客户编号) !== cleanClientId) return false;
      if (cleanProjectId && text(fields.项目编号) !== cleanProjectId) return false;
      return normalizePhone(text(fields.联系方式)) === phone;
    });

    return matched
      ? { ok: true }
      : { ok: false, userMessage: '没有权限查看这条诊断记录' };
  } catch (error) {
    console.error('verifyCustomerAccess failed', error);
    return { ok: false, userMessage: '客户身份验证暂时不可用' };
  }
}

function clean(value) {
  return String(value || '').trim();
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.name) return String(value.name);
    if (value.value) return String(value.value);
    if (value.link) return String(value.link);
    return '';
  }
  return String(value || '').trim();
}

module.exports = {
  verifyCustomerAccess
};
