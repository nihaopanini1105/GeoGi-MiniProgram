const { site } =
  require('../../config/site');

const DEFAULT_ARTICLE_ID =
  'what-is-geo-ai-search-era';

const DEFAULT_SHARE_TITLE =
  'GeoGi GEO 研究中心';

Page({
  data: {
    webUrl: '',
    shareTitle:
      DEFAULT_SHARE_TITLE
  },

  onLoad(options = {}) {
    const id =
      normalizeArticleId(
        options.id
      ) ||
      DEFAULT_ARTICLE_ID;

    const title =
      decodeOption(
        options.title
      ) ||
      DEFAULT_SHARE_TITLE;

    this.articleId = id;

    this.setData({
      webUrl:
        buildArticleUrl(id),
      shareTitle:
        title
    });
  },

  handleWebViewLoad() {
    console.log(
      'GeoGi research web-view loaded:',
      this.data.webUrl
    );
  },

  handleWebViewError(event) {
    console.error(
      'GeoGi research web-view failed:',
      event &&
      event.detail
        ? event.detail
        : event
    );

    wx.showToast({
      title:
        '研究文章暂时无法打开',
      icon: 'none'
    });
  },

  onShareAppMessage() {
    const id =
      this.articleId ||
      DEFAULT_ARTICLE_ID;

    const title =
      this.data.shareTitle ||
      DEFAULT_SHARE_TITLE;

    return {
      title,
      path:
        '/pages/research-detail/research-detail' +
        '?id=' +
        encodeURIComponent(id) +
        '&title=' +
        encodeURIComponent(title) +
        '&from=share'
    };
  },

  onShareTimeline() {
    const id =
      this.articleId ||
      DEFAULT_ARTICLE_ID;

    const title =
      this.data.shareTitle ||
      DEFAULT_SHARE_TITLE;

    return {
      title,
      query:
        'id=' +
        encodeURIComponent(id) +
        '&title=' +
        encodeURIComponent(title) +
        '&from=timeline'
    };
  }
});

function buildArticleUrl(id) {
  const origin =
    String(
      site.officialUrl ||
      site.researchCenterUrl ||
      'https://www.geogi.cn'
    )
      .trim()
      .replace(/\/+$/, '');

  return (
    origin +
    '/insights/' +
    encodeURIComponent(id) +
    '/?embed=miniprogram'
  );
}

function normalizeArticleId(value) {
  const id =
    decodeOption(value)
      .trim()
      .toLowerCase();

  if (
    !id ||
    !/^[a-z0-9-]+$/.test(id)
  ) {
    return '';
  }

  return id;
}

function decodeOption(value) {
  const input =
    String(value || '');

  if (!input) {
    return '';
  }

  try {
    return decodeURIComponent(
      input
    );
  } catch (error) {
    return input;
  }
}
