const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event) => {
  try {
    const requiredEnv = [
      'FEISHU_APP_ID',
      'FEISHU_APP_SECRET',
      'FEISHU_CONTENT_APP_TOKEN',
      'FEISHU_ARTICLES_TABLE_ID'
    ];
    const missingEnv = requiredEnv.filter((key) => !process.env[key]);
    if (missingEnv.length) {
      return {
        ok: false,
        userMessage: `研究中心未完成配置：${missingEnv.join(', ')}`,
        articles: []
      };
    }

    const tenantToken = await getTenantAccessToken();
    const records = await listArticleRecords(tenantToken);
    const category = event.category || '全部';
    const articles = records
      .map(normalizeArticle)
      .filter((article) => article.status === '已发布')
      .filter((article) => category === '全部' || article.category === category)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, Number(event.limit || 50));

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
};

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

async function getTenantAccessToken() {
  const result = await requestJson({
    method: 'POST',
    hostname: 'open.feishu.cn',
    path: '/open-apis/auth/v3/tenant_access_token/internal',
    body: {
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    }
  });

  if (result.code !== 0 || !result.tenant_access_token) {
    throw new Error(`tenant_access_token failed: ${JSON.stringify(result)}`);
  }
  return result.tenant_access_token;
}

async function listArticleRecords(tenantToken) {
  const appToken = process.env.FEISHU_CONTENT_APP_TOKEN;
  const tableId = process.env.FEISHU_ARTICLES_TABLE_ID;
  const result = await requestJson({
    method: 'GET',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=100`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    }
  });

  if (result.code !== 0) {
    throw new Error(`list records failed: ${JSON.stringify(result)}`);
  }
  return result.data && result.data.items ? result.data.items : [];
}

function requestJson({ method, hostname, path, headers = {}, body }) {
  const data = body ? JSON.stringify(body) : '';
  const options = {
    method,
    hostname,
    path,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      ...headers
    },
    timeout: 12000
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(new Error(`invalid json response: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    if (data) req.write(data);
    req.end();
  });
}
