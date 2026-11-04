// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its module path.
// Reuses the homepage copy and canonical assets without altering the logo.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const { assets } = require('../config/assets');
const dataUrl = (asset) => 'data:image/png;base64,' + fs.readFileSync(path.join(root, asset)).toString('base64');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 400 }, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      * { box-sizing: border-box; } body { margin: 0; font-family: -apple-system, 'PingFang SC', sans-serif; }
      .hero { position: relative; width: 500px; height: 400px; padding: 24px 25px;
        overflow: hidden; background: linear-gradient(150deg,#fff 0%,#fbfdff 58%,#f2f7ff 100%); }
      .orbit { position: absolute; width: 413px; height: 413px; right: -90px; top: 55px; opacity: .42; }
      .logo { display: block; position: relative; width: 180px; height: auto; }
      .copy { position: relative; margin-top: 22px; }
      .kicker { color: #176bff; font-size: 13px; font-weight: 700; letter-spacing: .12em; }
      h1 { color: #081b3a; font-size: 32px; line-height: 1.28; margin: 19px 0 0; }
      p { color: #64738a; font-size: 18px; line-height: 1.7; margin: 19px 0 0; }
      .cta { display: flex; align-items: center; justify-content: center; width: 280px; height: 56px;
        margin-top: 22px; border-radius: 16px; color: #fff; background: #176bff; font-size: 19px; font-weight: 600; }
    </style><div class="hero"><img class="orbit" src="${dataUrl(assets.hero.background)}">
      <img class="logo" src="${dataUrl(assets.brand.logo)}"><div class="copy">
      <div class="kicker">GEO INTELLIGENCE FOR BRANDS</div>
      <h1>让品牌在 AI 时代<br>被看见、被理解、被选择</h1>
      <p>199元获取一次品牌 GEO诊断</p><div class="cta">获取诊断报告</div></div></div></html>`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    const output = path.join(root, 'assets/share/home-cover.png');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    console.log(output);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
