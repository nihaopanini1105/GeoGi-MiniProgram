const assert = require('assert');

const {
  sanitizeSupplement,
  validateSupplement,
  buildLeadUpdates,
  buildProjectUpdates
} = require('../src/services/customer-supplement');

function run() {
  const supplement = sanitizeSupplement({
    clientId: 'GG-202609-0001',
    projectId: 'GG-P-202609-199511',
    companyName: '北京三甚科技有限公司',
    note: '用于企业主体核验',
    files: [{
      name: '营业执照.pdf',
      fileId: 'file_123',
      url: '/uploads/202609/license.pdf',
      size: 1024
    }]
  });

  assert.strictEqual(validateSupplement(supplement), '');
  assert.strictEqual(supplement.files.length, 1);

  const leadUpdates = buildLeadUpdates({
    fields: {
      当前状态: '已提交',
      补充说明: '原始说明',
      附件资料: ''
    },
    supplement
  });
  assert.strictEqual(leadUpdates.企业名称, '北京三甚科技有限公司');
  assert.strictEqual(leadUpdates.当前状态, '已补充资料');
  assert.strictEqual(leadUpdates.审核状态, '待 OS 核验补充资料');
  assert(leadUpdates.附件资料.includes('营业执照.pdf'));
  assert(leadUpdates.补充说明.includes('原始说明'));

  const protectedLeadUpdates = buildLeadUpdates({
    fields: { 当前状态: '诊断处理中' },
    supplement
  });
  assert.strictEqual(protectedLeadUpdates.当前状态, undefined);
  assert.strictEqual(protectedLeadUpdates.审核状态, undefined);

  const projectUpdates = buildProjectUpdates({
    fields: { 当前阶段: 'INTAKE', 内部备注: '原备注' },
    supplement
  });
  assert.strictEqual(projectUpdates.当前阶段, 'INTAKE_SUPPLEMENTED');
  assert.strictEqual(projectUpdates.审核状态, '待 OS 核验补充资料');
  assert(projectUpdates.内部备注.includes('北京三甚科技有限公司'));

  const protectedProjectUpdates = buildProjectUpdates({
    fields: { 当前阶段: 'CAPTURE' },
    supplement
  });
  assert.strictEqual(protectedProjectUpdates.当前阶段, undefined);

  assert.strictEqual(validateSupplement(sanitizeSupplement({
    clientId: 'GG-202609-0001',
    projectId: 'GG-P-202609-199511'
  })), '请填写补充信息或上传资料');

  console.log('GEOGI V1 CUSTOMER SUPPLEMENT BOUNDARY: OK');
}

run();
