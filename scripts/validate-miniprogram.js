#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    fail(`${relativePath} 不是有效 JSON: ${error.message}`);
    return null;
  }
}

function walk(directory, extensions, output = []) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return output;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(relative, extensions, output);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      output.push(relative);
    }
  }
  return output;
}

function validateJsonFiles() {
  const files = [
    'app.json',
    'project.config.json',
    'sitemap.json',
    ...walk('pages', ['.json'])
  ];
  files.forEach(readJson);
}

function validateProjectConfig() {
  const project = readJson('project.config.json');
  if (!project) return;
  if (project.compileType !== 'miniprogram') fail('project.config.json compileType 必须为 miniprogram');
  if (project.appid !== 'wx1ac5bdb2d5bff31f') fail('project.config.json AppID 与 GeoGi 正式 AppID 不一致');
  if (!project.setting || project.setting.urlCheck !== true) fail('project.config.json 必须开启 urlCheck');
}

function validateAppStructure() {
  const app = readJson('app.json');
  if (!app) return;

  const expectedTabs = [
    ['pages/index/index', '首页'],
    ['pages/diagnosis/diagnosis', '诊断'],
    ['pages/research/research', '研究'],
    ['pages/mine/mine', '报告']
  ];
  const tabs = (app.tabBar && app.tabBar.list) || [];

  if (tabs.length !== expectedTabs.length) fail(`底部 Tab 数量应为 ${expectedTabs.length}，当前为 ${tabs.length}`);
  expectedTabs.forEach(([pagePath, text], index) => {
    const tab = tabs[index];
    if (!tab || tab.pagePath !== pagePath || tab.text !== text) {
      fail(`第 ${index + 1} 个 Tab 应为 ${text} -> ${pagePath}`);
    }
  });

  if (!app.tabBar || app.tabBar.backgroundColor !== '#FFFFFF') fail('TabBar 背景应为 #FFFFFF');
  if (!app.tabBar || app.tabBar.selectedColor !== '#176BFF') fail('TabBar 选中色应为 #176BFF');

  const pages = new Set(app.pages || []);
  for (const pagePath of pages) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      const file = `${pagePath}${extension}`;
      if (!exists(file)) fail(`app.json 声明页面缺少文件：${file}`);
    }
  }

  for (const tab of tabs) {
    if (!pages.has(tab.pagePath)) fail(`Tab 页面未在 app.json pages 中声明：${tab.pagePath}`);
    if (!exists(tab.iconPath)) fail(`Tab 图标不存在：${tab.iconPath}`);
    if (!exists(tab.selectedIconPath)) fail(`Tab 选中图标不存在：${tab.selectedIconPath}`);
  }
}

function validateAssets() {
  const required = [
    'assets/brand/geogi_logo_dark_512.png',
    'assets/brand/geogi_logo_mark_dark_512.png',
    'assets/hero/home_hero_orbit_bg_512.png',
    'assets/contact/geogi-wecom-qr.png',
    'assets/platforms/custom/doubao.png',
    'assets/platforms/custom/yuanbao.png',
    'assets/platforms/custom/qianwen.png',
    'assets/platforms/custom/deepseek.png',
    'assets/platforms/custom/kimi.png'
  ];
  required.forEach((file) => {
    if (!exists(file)) fail(`关键资源不存在：${file}`);
  });
}

function validateApiConfig() {
  const apiFile = 'config/api.js';
  if (!exists(apiFile)) {
    fail(`${apiFile} 不存在`);
    return;
  }
  const source = read(apiFile);
  if (!source.includes("const PROD_API_BASE_URL = 'https://api.geogi.cn';")) {
    fail('生产 API 必须为 https://api.geogi.cn');
  }
  if (!source.includes("const LOCAL_API_BASE_URL = 'http://127.0.0.1:3107';")) {
    note('本地 API 地址不是默认的 http://127.0.0.1:3107，请确认是否为有意修改');
  }
}

function validateRoutes() {
  const app = readJson('app.json');
  if (!app) return;
  const pageSet = new Set(app.pages || []);
  const tabSet = new Set(((app.tabBar && app.tabBar.list) || []).map((item) => item.pagePath));
  const files = [...walk('pages', ['.js', '.wxml'])];
  const routePattern = /(?:url\s*[:=]\s*|url=")[`'\"]?(\/pages\/[^?`'\"}\s]+)/g;

  for (const file of files) {
    const source = read(file);
    let match;
    while ((match = routePattern.exec(source))) {
      const route = match[1].replace(/^\//, '');
      if (!pageSet.has(route)) fail(`${file} 引用了未注册页面：/${route}`);
    }

    const switchPattern = /wx\.switchTab\s*\(\s*\{[\s\S]{0,180}?url\s*:\s*[`'\"](\/pages\/[^?`'\"]+)/g;
    while ((match = switchPattern.exec(source))) {
      const route = match[1].replace(/^\//, '');
      if (!tabSet.has(route)) fail(`${file} 使用 switchTab 打开非 Tab 页面：/${route}`);
    }

    const navigatePattern = /wx\.navigateTo\s*\(\s*\{[\s\S]{0,180}?url\s*:\s*[`'\"](\/pages\/[^?`'\"]+)/g;
    while ((match = navigatePattern.exec(source))) {
      const route = match[1].replace(/^\//, '');
      if (tabSet.has(route)) fail(`${file} 使用 navigateTo 打开 Tab 页面：/${route}`);
    }
  }
}

function validateVisibleCopy() {
  const banned = [
    '查看我的诊断报告',
    '我的诊断报告',
    '我的诊断',
    '中国市场 GEO',
    '免费检测',
    '返回我的',
    'GeoGi-Advisor',
    '工作日 10:00-19:00'
  ];
  const files = [
    ...walk('pages', ['.wxml']),
    'server/.env.example'
  ].filter(exists);

  for (const file of files) {
    const source = read(file);
    for (const phrase of banned) {
      if (source.includes(phrase)) fail(`${file} 仍包含禁用/占位文案：“${phrase}”`);
    }
  }
}

function validateJsSyntax() {
  const files = [
    'app.js',
    ...walk('config', ['.js']),
    ...walk('utils', ['.js']),
    ...walk('pages', ['.js']),
    ...walk('server/src', ['.js'])
  ].filter(exists);

  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    if (result.status !== 0) {
      fail(`${file} JavaScript 语法检查失败：${(result.stderr || result.stdout || '').trim()}`);
    }
  }
}

function validateServerSafety() {
  if (!exists('server/src/server.js')) return;
  const server = read('server/src/server.js');
  if (/express\.static\s*\(.*(?:uploads|reports)/s.test(server)) {
    fail('server/src/server.js 不应公开静态暴露客户 uploads/reports');
  }
  if (!server.includes("app.post('/api/feishu/command', internalLimiter, requireAdminSecret")) {
    fail('/api/feishu/command 必须经过管理员密钥保护');
  }
  if (!server.includes("app.post('/api/feishu/events', internalLimiter, requireFeishuVerificationToken")) {
    fail('/api/feishu/events 必须校验飞书 Verification Token');
  }
  if (!server.includes("app.post('/api/uploads', customerLimiter, authenticateCustomer")) {
    fail('/api/uploads 必须经过客户身份验证');
  }
}

validateJsonFiles();
validateProjectConfig();
validateAppStructure();
validateAssets();
validateApiConfig();
validateRoutes();
validateVisibleCopy();
validateJsSyntax();
validateServerSafety();

if (notes.length) {
  console.log('\n注意：');
  notes.forEach((message) => console.log(`- ${message}`));
}

if (failures.length) {
  console.error('\nGeoGi 小程序上线前自检失败：');
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('GeoGi 小程序上线前静态自检通过。');
