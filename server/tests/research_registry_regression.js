const assert = require('assert');

const registry = {
  updated: '2026-08-13',
  categories: [
    'GEO 基础研究',
    'AI 平台研究',
    'GeoGi 方法论',
    '行业研究',
    '年度研究报告'
  ],
  items: [
    {
      slug: 'what-is-geo',
      title: '什么是 GEO？',
      description: '用于验证研究中心列表、分类、搜索和详情读取的已发布测试文章。',
      category: 'GEO 基础研究',
      tags: ['GEO', 'AI 可见度'],
      status: 'published',
      published_at: '2026-08-13',
      updated_at: '2026-08-13',
      canonical_path: '/insights/what-is-geo/',
      featured: true
    },
    {
      slug: 'draft-article',
      title: '草稿文章',
      description: '这篇文章不能出现在客户可见的研究中心列表或文章详情中。',
      category: '行业研究',
      tags: ['draft'],
      status: 'draft',
      published_at: '2026-08-14',
      updated_at: '2026-08-14',
      canonical_path: '/insights/draft-article/',
      featured: false
    }
  ]
};

const articleHtml = `<!doctype html>
<html><body>
<article class="article-content">
<h2>第一部分</h2>
<p>研究正文第一段。</p>
<div class="article-callout"><strong>核心结论</strong><span>这是需要保留的正文信息。</span></div>
<h2>第二部分</h2>
<ul><li>要点一</li><li>要点二</li></ul>
</article>
</body></html>`;

const originalFetch = global.fetch;

global.fetch = async (url) => {
  const value = String(url);
  if (value.includes('/data/research-index.json')) {
    return {
      ok: true,
      status: 200,
      async json() { return registry; }
    };
  }
  if (value.includes('/insights/what-is-geo/')) {
    return {
      ok: true,
      status: 200,
      async text() { return articleHtml; }
    };
  }
  return {
    ok: false,
    status: 404,
    async json() { return {}; },
    async text() { return ''; }
  };
};

async function main() {
  try {
    delete process.env.FEISHU_CONTENT_APP_TOKEN;
    delete process.env.FEISHU_ARTICLES_TABLE_ID;

    const {
      getResearchArticles,
      getResearchArticle,
      extractArticleSections
    } = require('../src/services/research');

    const list = await getResearchArticles({ category: '全部', limit: 50 });
    assert.equal(list.ok, true, 'research list should load without Feishu content env');
    assert.equal(list.items.length, 1, 'only published registry items should be exposed');
    assert.equal(list.items[0].id, 'what-is-geo');
    assert.equal(list.items[0].status, '已发布');
    assert.equal(list.items[0].canonicalUrl, 'https://www.geogi.cn/insights/what-is-geo/');
    assert.deepEqual(list.categories, ['全部', ...registry.categories], 'fixed website taxonomy should be returned');

    const categoryMiss = await getResearchArticles({ category: '行业研究' });
    assert.equal(categoryMiss.items.length, 0, 'draft items must stay hidden even when category matches');

    const searchHit = await getResearchArticles({ keyword: 'AI 可见度' });
    assert.equal(searchHit.items.length, 1, 'keyword search should match registry tags');

    const searchMiss = await getResearchArticles({ keyword: '不存在的关键词' });
    assert.equal(searchMiss.items.length, 0, 'keyword search should filter non-matches');

    const detail = await getResearchArticle('what-is-geo');
    assert.equal(detail.ok, true, 'published article detail should load');
    assert.ok(Array.isArray(detail.article.sections));
    assert.ok(detail.article.sections.length >= 2, 'article HTML should become native Mini Program sections');
    assert.ok(detail.article.sections.some((section) => section.title === '第一部分'));
    assert.ok(detail.article.sections.some((section) => section.body.includes('核心结论')));
    assert.ok(detail.article.sections.some((section) => section.body.includes('要点一')));

    const draftDetail = await getResearchArticle('draft-article');
    assert.equal(draftDetail.ok, false, 'draft article detail must not be exposed');

    const unsafe = {
      ...registry,
      items: [{
        ...registry.items[0],
        slug: 'safe-slug',
        canonical_path: '/insights/not-the-same-slug/'
      }]
    };
    global.fetch = async (url) => {
      if (String(url).includes('/data/research-index.json')) {
        return {
          ok: true,
          status: 200,
          async json() { return unsafe; }
        };
      }
      throw new Error('unexpected fetch');
    };
    const unsafeList = await getResearchArticles({});
    assert.equal(unsafeList.items.length, 0, 'canonical path must be bound to the article slug');

    const extracted = extractArticleSections(articleHtml);
    assert.ok(extracted.some((section) => section.body.includes('研究正文第一段')));

    console.log('research_registry_regression: PASS');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
