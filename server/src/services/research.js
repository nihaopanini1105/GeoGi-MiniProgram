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
      console.error('Research service missing configuration', missingEnv);
      return unavailable();
    }

    const tenantToken = await getTenantAccessToken();
    const records = await listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_CONTENT_APP_TOKEN,
      tableId: process.env.FEISHU_ARTICLES_TABLE_ID,
      pageSize: 100
    });

    const published = records
      .map(normalizeArticle)
      .filter((article) => article.status === '已发布')
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const categories = ['全部'].concat(unique(published.map((article) => article.category).filter(Boolean)));
    const category = text(query.category) || '全部';
    const keyword = text(query.keyword || query.q).toLowerCase();
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);

    const articles = published
      .filter((article) => category === '全部' || article.category === category)
      .filter((article) => {
        if (!keyword) return true;
        const haystack = [article.title, article.desc, article.keywords, article.category]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(keyword);
      })
      .slice(0, limit);

    return {
      ok: true,
      items: articles,
      articles,
      categories,
      page: 1,
      hasMore: false
    };
  } catch (error) {
    console.error('getResearchArticles failed', error);
    return unavailable();
  }
}

async function getResearchArticle(id) {
  try {
    const result = await getResearchArticles({ limit: 100 });
    if (!result.ok) return result;
    const article = result.items.find((item) => item.id === id || item.recordId === id);
    if (!article) {
      return {
        ok: false,
        userMessage: '文章不存在'
      };
    }
    return {
      ok: true,
      article
    };
  } catch (error) {
    console.error('getResearchArticle failed', error);
    return {
      ok: false,
      userMessage: '文章暂时无法打开'
    };
  }
}

function normalizeArticle(record) {
  const fields = record.fields || {};
  return {
    id: text(fields.文章ID || fields.slug || record.record_id),
    title: text(fields.标题),
    desc: text(fields.摘要),
    category: text(fields.分类),
    date: text(fields.发布日期 || fields.更新时间),
    updatedAt: text(fields.更新时间 || fields.发布日期),
    author: text(fields.作者),
    status: text(fields.状态 || '草稿'),
    body: text(fields.正文),
    keywords: text(fields.关键词),
    source: text(fields.参考来源),
    canonicalUrl: text(fields.官网原文链接 || fields.canonical_url || fields.URL || fields.url),
    cover: text(fields.封面图 || fields.cover || fields.cover_url),
    recordId: record.record_id
  };
}

function unavailable() {
  return {
    ok: false,
    userMessage: '研究中心暂时不可用，请稍后再试',
    items: [],
    articles: [],
    categories: ['全部']
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
    if (value.url) return String(value.url);
    return JSON.stringify(value);
  }
  return String(value || '').trim();
}

function unique(values) {
  return Array.from(new Set(values));
}

module.exports = {
  getResearchArticles,
  getResearchArticle
};
