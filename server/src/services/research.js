const DEFAULT_WEBSITE_ORIGIN = 'https://www.geogi.cn';
const DEFAULT_GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/nihaopanini1105/GeoGi-Official-Website-New/main';
const REGISTRY_PATH = '/data/research-index.json';

const FIXED_CATEGORIES = [
  'GEO 基础研究',
  'AI 平台研究',
  'GeoGi 方法论',
  '行业研究',
  '年度研究报告'
];

async function getResearchArticles(query = {}) {
  try {
    const registry = await loadRegistry();
    const published = normalizePublishedItems(registry);

    const category = text(query.category) || '全部';
    const keyword = text(query.keyword || query.q).toLowerCase();
    const limit = Math.min(
      Math.max(Number(query.limit || 50), 1),
      100
    );

    const articles = published
      .filter(
        (article) =>
          category === '全部' ||
          article.category === category
      )
      .filter((article) => {
        if (!keyword) return true;

        const haystack = [
          article.title,
          article.desc,
          article.keywords,
          article.category
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(keyword);
      })
      .slice(0, limit);

    const registryCategories = Array.isArray(
      registry.categories
    )
      ? registry.categories
          .map(text)
          .filter((item) =>
            FIXED_CATEGORIES.includes(item)
          )
      : [];

    const categories = [
      '全部',
      ...unique([
        ...registryCategories,
        ...FIXED_CATEGORIES
      ])
    ];

    return {
      ok: true,
      items: articles,
      articles,
      categories,
      page: 1,
      hasMore: false,
      source: 'GeoGi Official Website Research Registry'
    };
  } catch (error) {
    console.error(
      'getResearchArticles failed',
      error
    );

    return {
      ok: false,
      userMessage: '研究中心加载失败',
      items: [],
      articles: [],
      categories: ['全部']
    };
  }
}

async function getResearchArticle(id) {
  try {
    const cleanId = text(id);

    if (!cleanId) {
      return fail('缺少文章编号');
    }

    const registry = await loadRegistry();

    const article = normalizePublishedItems(
      registry
    ).find((item) => item.id === cleanId);

    if (!article) {
      return fail('文章不存在');
    }

    return {
      ok: true,
      article
    };
  } catch (error) {
    console.error(
      'getResearchArticle failed',
      error
    );

    return fail('文章加载失败');
  }
}

async function loadRegistry() {
  const resolvedWebsiteOrigin = websiteOrigin();
  const resolvedGithubRawBase = githubRawBase();

  const candidates = [
    `${resolvedWebsiteOrigin}${REGISTRY_PATH}`,
    `${resolvedGithubRawBase}${REGISTRY_PATH}`
  ];

  let lastError = null;

  for (const url of unique(candidates)) {
    try {
      const response =
        await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(
          `HTTP_${response.status}`
        );
      }

      const registry = await response.json();

      if (
        !registry ||
        !Array.isArray(registry.items)
      ) {
        throw new Error(
          'invalid research registry'
        );
      }

      return registry;
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error(
      'research registry unavailable'
    )
  );
}

function normalizePublishedItems(registry) {
  return (
    Array.isArray(registry.items)
      ? registry.items
      : []
  )
    .filter(
      (item) =>
        item &&
        item.status === 'published'
    )
    .map(normalizeRegistryItem)
    .filter(Boolean)
    .sort(
      (a, b) =>
        String(b.date).localeCompare(
          String(a.date)
        ) ||
        a.title.localeCompare(
          b.title,
          'zh-CN'
        )
    );
}

function normalizeRegistryItem(item) {
  const slug = text(item.slug);
  const canonicalPath = text(
    item.canonical_path
  );

  if (
    !isSafeSlug(slug) ||
    !isSafeCanonicalPath(
      canonicalPath,
      slug
    )
  ) {
    return null;
  }

  const tags = Array.isArray(item.tags)
    ? item.tags.map(text).filter(Boolean)
    : [];

  return {
    id: slug,
    title: text(item.title),
    desc: text(item.description),

    category: FIXED_CATEGORIES.includes(
      text(item.category)
    )
      ? text(item.category)
      : 'GEO 基础研究',

    date: text(
      item.published_at ||
      item.updated_at
    ),

    updatedAt: text(
      item.updated_at ||
      item.published_at
    ),

    author: 'GeoGi Research',
    status: '已发布',

    body: '',
    sections: [],

    keywords: tags.join('、'),

    source: 'GeoGi 官方研究中心',

    canonicalPath,

    canonicalUrl:
      `${websiteOrigin()}${canonicalPath}`,

    cover: ''
  };
}





async function fetchWithTimeout(url) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    8000
  );

  try {
    return await fetch(url, {
      headers: {
        accept:
          'application/json,text/html;q=0.9,*/*;q=0.8',
        'user-agent':
          'GeoGi-MiniProgram-Research/1.0'
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function websiteOrigin() {
  return text(
    process.env
      .GEOGI_RESEARCH_WEBSITE_ORIGIN ||
      DEFAULT_WEBSITE_ORIGIN
  ).replace(/\/$/, '');
}

function githubRawBase() {
  return text(
    process.env
      .GEOGI_RESEARCH_GITHUB_RAW_BASE ||
      DEFAULT_GITHUB_RAW_BASE
  ).replace(/\/$/, '');
}

function isSafeSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
    value
  );
}

function isSafeCanonicalPath(
  value,
  slug
) {
  return (
    value ===
    `/insights/${slug}/`
  );
}

function unique(values) {
  return Array.from(
    new Set(
      values.filter(Boolean)
    )
  );
}

function text(value) {
  return String(
    value || ''
  ).trim();
}

function fail(userMessage) {
  return {
    ok: false,
    userMessage
  };
}

module.exports = {
  getResearchArticles,
  getResearchArticle
};
