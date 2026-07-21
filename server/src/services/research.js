const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');

const REQUIRED_ENV = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_CONTENT_APP_TOKEN',
  'FEISHU_ARTICLES_TABLE_ID'
];

async function getResearchArticles(query) {
  try {
    const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missingEnv.length) {
      return {
        ok: false,
        userMessage: `研究中心未完成配置：${missingEnv.join(', ')}`,
        articles: []
      };
    }

    const tenantToken = await getTenantAccessToken();
    const records = await listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_CONTENT_APP_TOKEN,
      tableId: process.env.FEISHU_ARTICLES_TABLE_ID,
      pageSize: 100
    });
    const category = query.category || '全部';
    const limit = Math.min(Number(query.limit || 50), 100);
    const articles = records
      .map(normalizeArticle)
      .filter((article) => article.status === '已发布')
      .filter((article) => category === '全部' || article.category === category)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, limit);

    return {
      ok: true,
      articles
    };
  } catch (error) {
    console.error('getResearchArticles failed', error);
    return {
      ok: false,
      userMessage: '研究中心加载失败',
      articles: []
    };
  }
}

function normalizeArticle(record) {
  const fields = record.fields || {};
  return {
    id: text(fields.文章ID || fields.slug || record.record_id),
    title: text(fields.标题),
    desc: text(fields.摘要),
    category: text(fields.分类 || 'GEO 基础'),
    date: text(fields.发布日期 || fields.更新时间),
    author: text(fields.作者 || 'GeoGi Research'),
    status: text(fields.状态 || '草稿'),
    body: text(fields.正文),
    keywords: text(fields.关键词),
    source: text(fields.参考来源),
    recordId: record.record_id
  };
}

function text(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join('、');
  }
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.name) return String(value.name);
    if (value.value) return String(value.value);
    if (value.link) return String(value.link);
    return JSON.stringify(value);
  }
  return String(value || '').trim();
}

module.exports = {
  getResearchArticles
};
