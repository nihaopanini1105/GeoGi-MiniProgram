# GeoGi 小程序飞书正式集成配置手册

版本：v1.0  
适用阶段：客户可体验版本 / 第一阶段可运营 MVP

## 1. 正式链路

客户在微信小程序提交品牌诊断资料后，正式链路应为：

1. 小程序请求你的 HTTPS 服务器接口 `POST /api/leads`
2. 服务器校验字段并生成 `clientId` / `projectId`
3. 服务器通过飞书开放平台写入多维表格
4. 服务器发送飞书通知给负责人
5. 小程序展示提交成功页、客户编号和预计完成时间
6. 人工审核客户资料后，在飞书群触发品牌信息补齐和问题生成
7. 完成AI平台问答后，在飞书群触发报告生成

研究中心正式链路为：

1. 运营在 GeoGi 官网维护研究中心内容
2. 小程序 `研究中心` Tab 通过 `web-view` 直接打开 `https://www.geogi.cn`
3. 微信公众平台需要配置业务域名 `www.geogi.cn`
4. 飞书内容表接口保留为后续备用方案

重要原则：

- 飞书 `App Secret`、Webhook、访问令牌不得写入小程序前端。
- 所有飞书写入和通知必须通过你的服务器后端完成。
- 提交失败时保留用户输入，不展示虚假的提交成功。
- 客户资料表和研究中心内容表可以在同一个飞书多维表格，也可以拆成两个表格。

## 2. 飞书开放平台准备

在飞书开放平台创建一个企业自建应用。

建议应用名称：

`GeoGi 诊断工作台`

需要记录：

- `App ID`
- `App Secret`

需要开通的能力：

- 多维表格记录读取
- 多维表格记录写入
- 发送消息或使用自定义机器人 Webhook

推荐参考飞书官方文档：

- 自建应用获取 `tenant_access_token`：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
- 多维表格记录接口：https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview
- 发送消息接口：https://open.feishu.cn/document/server-docs/im-v1/message/create
- 自定义机器人：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

## 3. 飞书多维表格结构

第一阶段至少需要两个 P0 表：

- `客户与品牌`
- `研究中心文章`

后续完整诊断工作台再扩展九张核心表：

- 客户与品牌
- 诊断项目
- 全网信源
- 品牌基础档案
- 品牌关键词
- 行业热门问题
- AI 检测问题
- 平台测试记录
- 回答分析结果
- 报告管理

当前正式流程中，客户提交后会自动写入：

- `客户与品牌`：保留客户原始提交内容
- `诊断项目`：创建内部跟进项目
- `品牌基础档案`：生成待核验的品牌信息档案

## 4. 客户与品牌表字段

表名建议：

`客户与品牌`

字段建议：

| 字段名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| 提交ID | 文本 | 是 | 小程序生成，服务端用于防重复提交 |
| 客户编号 | 文本 | 是 | 服务器生成，例如 `GG-202607-0001` |
| 项目编号 | 文本 | 是 | 服务器生成，例如 `GG-P-202607-123456` |
| 品牌名称 | 文本 | 是 | 客户填写 |
| 企业名称 | 文本 | 否 | 客户填写 |
| 一级行业 | 单选或文本 | 是 | 旅游与文旅、教育培训等 |
| 细分业务 | 文本 | 是 | 客户填写 |
| 官方渠道 | 文本 | 否 | 官网、公众号、店铺等 |
| 主要市场 | 文本 | 是 | 全国市场、本地市场、海外市场等 |
| 核心业务 | 多行文本 | 是 | 客户填写 |
| 主要客户 | 多行文本 | 是 | 目标客户与需求 |
| 核心优势 | 多行文本 | 否 | 客户选择你的原因 |
| 竞品或对标品牌 | 文本 | 否 | 最多 3 个 |
| 诊断目标 | 文本 | 是 | 服务器把多选结果合并写入 |
| 附件资料 | 多行文本 | 否 | 上传文件名与 URL |
| 联系人 | 文本 | 是 | 客户填写 |
| 联系方式 | 文本 | 是 | 手机号或微信号 |
| 补充说明 | 多行文本 | 否 | 客户填写 |
| 隐私授权 | 复选框 | 是 | 必须为 true |
| 提交时间 | 文本 | 是 | ISO 时间，首版建议用文本避免日期格式兼容问题 |
| 当前状态 | 单选 | 是 | 默认 `新提交` |
| 负责人 | 文本 | 是 | 默认 `GeoGi 负责人` |
| 下一步动作 | 文本 | 是 | 默认 `审核资料并联系客户` |
| 通知状态 | 单选 | 是 | `待发送`、`已发送`、`发送失败` |
| 通知发送时间 | 文本 | 否 | 通知成功时写入 |
| 通知错误 | 多行文本 | 否 | 通知失败时写入 |
| 通知重试次数 | 数字 | 是 | 默认 `0` |
| 来源 | 文本 | 是 | 默认 `wechat_miniprogram` |
| 小程序OpenID | 文本 | 否 | 自有服务器方案首版可不写入；如后续需要，可由小程序登录态换取后写入 |

`当前状态` 建议选项：

- 新提交
- 待初步审核
- 待补充资料
- 有效
- 无效
- 已转项目

## 5. 研究中心文章表字段

表名建议：

`研究中心文章`

字段建议：

| 字段名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| 文章ID | 文本 | 是 | 小程序路由用，例如 `what-is-geo` |
| 标题 | 文本 | 是 | 文章标题 |
| 摘要 | 多行文本 | 是 | 2-3 行 |
| 分类 | 单选 | 是 | GEO 基础、品牌诊断、行业研究、AI 平台、指标与方法 |
| 发布日期 | 文本 | 是 | 建议 `YYYY-MM-DD` |
| 作者 | 文本 | 否 | 默认 `GeoGi Research` |
| 状态 | 单选 | 是 | 草稿、待审核、已发布、已下线 |
| 正文 | 多行文本 | 否 | 首版可放 Markdown 或纯文本 |
| 关键词 | 文本 | 否 | 用于后续官网 / GEO 内容复用 |
| 参考来源 | 多行文本 | 否 | 来源链接或说明 |
| 更新时间 | 文本 | 否 | 内容维护用 |

只有 `状态 = 已发布` 的文章会被小程序展示。

## 6. 自有服务器准备

项目已经准备好一个 Node.js 服务端骨架：

```text
server/
```

服务器需要满足：

- 可以访问公网
- 支持 HTTPS
- 域名已备案或符合微信小程序要求
- 域名已添加到微信小程序后台的 `request 合法域名`
- 可以访问 `open.feishu.cn`

本地或服务器启动：

```bash
cd server
npm install
cp .env.example .env
npm start
```

生产环境建议使用：

- Nginx 反向代理
- HTTPS 证书
- PM2 / systemd 保活
- 日志轮转
- 防火墙只开放必要端口

## 7. 服务器环境变量

在服务器 `server/.env` 中配置环境变量。生产环境也可以通过服务器环境变量管理，不一定使用 `.env` 文件。

基础配置：

```text
PORT=3000
```

飞书应用：

```text
FEISHU_APP_ID=飞书自建应用 App ID
FEISHU_APP_SECRET=飞书自建应用 App Secret
```

客户表：

```text
FEISHU_BASE_APP_TOKEN=客户诊断工作台多维表格 app_token
FEISHU_LEADS_TABLE_ID=客户与品牌表 table_id
FEISHU_RECORD_URL_TEMPLATE=飞书记录链接模板，可选
```

诊断工作台表：

```text
FEISHU_PROJECTS_TABLE_ID=诊断项目表 table_id
FEISHU_BRAND_PROFILE_TABLE_ID=品牌基础档案表 table_id
FEISHU_SOURCES_TABLE_ID=全网信源表 table_id
FEISHU_KEYWORDS_TABLE_ID=品牌关键词表 table_id
FEISHU_QUESTIONS_TABLE_ID=行业热门问题表 table_id
FEISHU_AI_QUESTION_TABLE_ID=AI 检测问题表 table_id
FEISHU_TEST_RECORDS_TABLE_ID=平台测试记录表 table_id
FEISHU_ANALYSIS_TABLE_ID=回答分析结果表 table_id
FEISHU_REPORTS_TABLE_ID=报告管理表 table_id
```

通知二选一即可：

### 方案 A：自定义机器人 Webhook

配置简单，适合第一阶段。

```text
FEISHU_NOTIFY_WEBHOOK=飞书自定义机器人 Webhook
FEISHU_NOTIFY_SECRET=机器人签名密钥，可选
```

### 方案 B：应用机器人私聊

更正式，但需要飞书应用消息权限和接收人的 `open_id` / `user_id`。

```text
FEISHU_NOTIFY_RECEIVE_ID=负责人 open_id 或 user_id
FEISHU_NOTIFY_RECEIVE_ID_TYPE=open_id
```

研究中心：

```text
FEISHU_CONTENT_APP_TOKEN=研究中心内容表所在多维表格 app_token
FEISHU_ARTICLES_TABLE_ID=研究中心文章表 table_id
```

如果研究中心文章表和客户表在同一个多维表格，`FEISHU_CONTENT_APP_TOKEN` 可以和 `FEISHU_BASE_APP_TOKEN` 相同。

## 8. 小程序接口域名配置

小程序端接口配置文件：

```text
config/api.js
```

把：

```js
const API_BASE_URL = 'https://your-api-domain.com';
```

改成你的正式 HTTPS 域名，例如：

```js
const API_BASE_URL = 'https://api.geogi.cn';
```

微信公众平台后台还需要配置：

```text
开发管理 → 开发设置 → 服务器域名 → request 合法域名
```

填入你的 API 域名。

## 9. 如何找到 app_token 和 table_id

打开飞书多维表格页面，URL 通常包含：

```text
base/<app_token>
table=<table_id>
```

把对应值复制到服务器环境变量即可。

如果飞书 URL 样式变化，以飞书开放平台接口调试台或多维表格开发者信息为准。

## 10. 通知模板

服务器发送的通知内容：

```text
【GeoGi 新客户提交】收到新的品牌 AI 可见度诊断申请。
品牌名称：{{品牌名称}}
所属行业：{{一级行业}} / {{细分业务}}
核心产品或服务：{{核心业务}}
诊断目标：{{诊断目标}}
联系人：{{联系人}}
联系方式：{{联系方式}}
提交时间：{{提交时间}}
客户编号：{{客户编号}}
项目编号：{{项目编号}}
当前状态：新提交
建议动作：请在 24 小时内审核资料并联系客户。
查看客户详情：{{飞书记录链接}}
```

## 11. 正式测试流程

上线前按以下顺序测试：

1. 在微信开发者工具中清缓存并重新编译
2. 打开首页，点击 `开始`
3. 填写三步表单
4. 提交后确认小程序进入提交成功页
5. 检查成功页是否显示客户编号
6. 打开飞书客户表，确认新增记录
7. 打开 `诊断项目` 表，确认自动生成同项目编号的项目记录
8. 打开 `品牌基础档案` 表，确认自动生成同项目编号的品牌档案
9. 打开 `全网信源` 表，确认自动生成候选信源和待检索任务
10. 打开 `品牌关键词` 表，确认自动生成品牌词、业务词、行业词和竞品词
11. 打开 `行业热门问题` 表，确认自动生成推荐型、比较型、场景型和信任型问题
12. 打开 `AI 检测问题` 表，确认自动生成各 AI 平台的测试任务
13. 检查负责人是否收到飞书通知，通知中应包含工作台状态和 P1 候选数量
14. 在研究中心文章表新增一篇 `已发布` 文章
15. 重新打开小程序研究中心，确认文章出现
16. 把文章状态改为 `已下线`，确认小程序不再展示

## 12. 常见问题

### 提交失败并提示“请先配置服务器域名”

说明小程序端 `config/api.js` 还没有替换正式 API 域名。

处理：

- 修改 `config/api.js`
- 在微信公众平台配置 request 合法域名
- 重新编译小程序

### 提交失败并提示“服务未完成配置”

说明服务器环境变量缺失。

处理：

- 检查 `FEISHU_APP_ID`
- 检查 `FEISHU_APP_SECRET`
- 检查 `FEISHU_BASE_APP_TOKEN`
- 检查 `FEISHU_LEADS_TABLE_ID`

### 飞书没有新增记录

检查：

- 飞书应用是否有多维表格写入权限
- 多维表格是否授权给自建应用
- 表字段名称是否与本文档一致
- `app_token` 和 `table_id` 是否填反

### 有记录但没有通知

检查：

- 是否配置 `FEISHU_NOTIFY_WEBHOOK`
- 自定义机器人是否启用签名
- 签名密钥是否填入 `FEISHU_NOTIFY_SECRET`
- 如果使用应用机器人，接收人 ID 类型是否正确

### 研究中心官网打不开

说明小程序 `web-view` 无法打开 `https://www.geogi.cn`。

检查：

- 微信公众平台是否配置业务域名 `www.geogi.cn`
- 官网是否已经开启 HTTPS
- 官网域名是否完成微信业务域名校验文件上传
- 开发者工具是否临时勾选了“不校验合法域名、web-view 域名”

## 13. 安全要求

- 不要把飞书 `App Secret` 写入 `app.js`、页面 JS 或 GitHub。
- 不要把机器人 Webhook 写入小程序前端。
- 不要在服务器日志中打印完整手机号、微信号和客户敏感资料。
- 飞书表格权限只开放给必要成员。
- 客户案例公开前必须获得授权或脱敏。

## 14. 当前代码状态

已准备：

- 自有服务器 Node.js 骨架
- `POST /api/leads`
- `POST /api/uploads`
- `GET /api/articles`
- `GET /api/articles/:id`
- `GET /api/config`
- `GET /api/sample-report`
- `POST /api/feishu/command`
- `POST /api/feishu/events`
- `pnpm setup:feishu-fields`
- `pnpm setup:diagnosis-workbench`
- `pnpm workflow:command`
- 表单提交正式链路
- 客户提交后进入待人工审核
- 飞书群指令触发品牌信息补齐、问题生成和报告生成
- 研究中心官网直连
- 飞书配置文档

待你在后台配置：

- 自有服务器和 HTTPS 域名
- 生产服务器环境变量
- 微信正式版服务器域名
- 服务器环境变量
- 飞书机器人或负责人私聊通知
