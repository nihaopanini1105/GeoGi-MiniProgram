# GeoGi 微信小程序

GeoGi 几何智引微信小程序，用于客户了解 AI 可见度诊断、提交品牌资料、阅读研究内容并联系顾问。视觉与交互以 `GeoGi_微信小程序UIUX与Codex开发需求文档_v1.1` 和正式视觉资产包为准。

## 当前版本

- 首页：简洁首屏、一个主 CTA、正式 GeoGi Hero 图、五个平台真实 Logo。
- 品牌诊断：入口说明 + 三步资料表单，支持草稿恢复、字段内错误、附件、隐私授权和防重复提交。
- 研究中心：直接打开 GeoGi 官网 `https://www.geogi.cn`，内容以官网为唯一来源。
- 联系顾问：复制企业微信/邮箱；正式留资统一进入品牌诊断表单。
- 后端：自有 Node.js 服务器，提供飞书多维表格写入、飞书通知、附件上传、研究内容和埋点接口。

## 正式视觉资产

正式 PNG 已接入 `assets/`：

- GeoGi Hero：`assets/hero/geogi_hero_mark_512.png`
- 平台 Logo：`assets/platforms/144/doubao.png`、`yuanbao.png`、`qianwen.png`、`deepseek.png`、`kimi.png`
- TabBar：`assets/tabbar/home.png`、`diagnosis.png`、`research.png` 及 selected 版本
- 设计 Token：`config/design-tokens.json`
- 平台配置：`config/platforms.js`
- 资产审计：`assets-audit.json`

平台显示顺序固定为：豆包、元宝、千问、DeepSeek、Kimi。

## 预览方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择：`/Users/dashaoye/Documents/MiniProgram_Wechat`
4. 打开右上角 `详情` → `本地设置`。
5. 勾选 `不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书`。
6. 先启动本地服务器，再点击“编译”预览首页和表单。

## 本地跑通业务流程

备案通过前，小程序开发环境会自动请求：

```text
http://127.0.0.1:3107
```

正式版和体验版仍会请求：

```text
https://api.geogi.cn
```

本地测试顺序：

1. 确认 `server/.env` 已配置飞书 App、多维表格和机器人。
2. 在项目根目录进入 `server/`。
3. 启动服务器：

```bash
PORT=3107 pnpm dev
```

4. 打开微信开发者工具，勾选“不校验合法域名”。
5. 编译小程序。
6. 进入 `品牌诊断`，填写表单并提交。
7. 检查飞书多维表格是否新增记录。
8. 检查飞书群是否收到通知。

## 服务器接口

小程序正式版不使用微信云开发。开发环境走本地服务器，正式环境走 `https://api.geogi.cn`。

服务器目录在 `server/`，正式接口包括：

- `GET /api/config`
- `GET /api/articles`
- `GET /api/articles/:id`
- `GET /api/sample-report`
- `POST /api/leads`
- `POST /api/uploads`
- `POST /api/events`

兼容旧路径：

- `POST /api/diagnosis/submit`
- `GET /api/research/articles`

## 飞书配置

服务器环境变量参考 `server/.env.example`。至少需要配置：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_APP_TOKEN`
- `FEISHU_LEADS_TABLE_ID`
- `FEISHU_NOTIFY_WEBHOOK` 或 `FEISHU_NOTIFY_RECEIVE_ID`

详细字段和配置步骤见：

- [docs/Feishu_Production_Setup.md](docs/Feishu_Production_Setup.md)
- [docs/Feishu_Bitable_Field_Dictionary.md](docs/Feishu_Bitable_Field_Dictionary.md)

## 微信后台

正式发客户体验前，需要在微信公众平台配置：

- request 合法域名：你的 API 域名
- uploadFile 合法域名：你的 API 域名
- downloadFile 合法域名：如有远程图片/附件域名，也要配置
- web-view 业务域名：`www.geogi.cn`
