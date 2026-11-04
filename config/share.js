// Public share presentation is independent of internal referral source names.
const HOME_SHARE_TITLE = 'GeoGi｜199 元品牌 GEO 诊断报告';
const HOME_SHARE_IMAGE = '/assets/share/home-cover.png';

function homeShare(sourceToken = '') {
  const token = String(sourceToken || '').trim();
  return {
    title: HOME_SHARE_TITLE,
    path: '/pages/index/index' + (token ? '?src=' + encodeURIComponent(token) : ''),
    imageUrl: HOME_SHARE_IMAGE
  };
}

module.exports = { HOME_SHARE_TITLE, HOME_SHARE_IMAGE, homeShare };
