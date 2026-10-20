# GeoGi V2.1 小程序独立交付协议与上线门禁

状态：**开发分支实现，默认关闭，未部署，未发布**。本协议与旧 V2 并存，禁止覆盖其客户指针、付款状态、支付渠道和佣金记录。

## 配套仓库

- OS：`nihaopanini1105/GeoGi-OS` 的 `integration/v21-formal-release-20261019`，权威构建器 `apps/operations_admin/report_v2_1_customer_delivery_contract.py`。
- 小程序：本分支新增 `server/src/services/report-v21-bridge-operations.js`；使用 **同一份 OS 编译的 H5/PDF 字节**，不在小程序重新生成评分、摘要或诊断。
- 生产安全前提：没有真实客户/项目/订单及双签名完整报告验收时，不得开启发布。

## 受保护的独立 OS 接口

全部由现有 `requireOsBridge` Bearer 鉴权：

- `GET /internal/os/report-v21/capabilities`：`enabled` 和 `general_customer_delivery_enabled` 默认均为 `false`。
- `POST /internal/os/report-v21/verify-customer-binding`：同时查验飞书登记的真实客户与项目归属、同名订单的客户/项目关系、已确认付款状态与付款交易时间，不接受单纯报告记录自我证明。
- `POST /internal/os/artifacts`：沿用原始字节上传，文件必须经 SHA-256 和长度核对；V2.1 PDF/H5 不得从公共 `/uploads` 访问。
- `POST /internal/os/delivery-packages`：经 V2.1 authority 路由到独立、不可变包/指针存储；不得调用 V2 `publishOsDeliveryPackage`，从而避免重复支付/佣金结算。
- `POST /internal/os/report-v21/verify-customer-access`：反查最新非撤销版本、当前订单付款资格及两个文件字节完整性。
- `POST /internal/os/report-v21/revoke`：追加式撤销标记，旧链接在复检时自动失效。不能重复发布已经撤销的同一包。

V2.1 字节的 OS 算法与 Node 合同由 `server/tests/fixtures/report_v21_python_generated.json` 的真实 Python builder 合成样本交叉验证，二者不允许漂移。

## 独立客户阅读入口

小程序采用手机号签名会话认证客户，再核对项目、当前付款与 V2.1 版本：

- `GET /api/customer/report-v21/:projectId`
- `POST /api/customer/report-v21/:projectId/h5-ticket`
- `POST /api/customer/report-v21/:projectId/pdf-ticket`
- `GET /api/customer/report-v21/h5-reader/:ticket`
- `GET /api/customer/report-v21/pdf-reader/:ticket`

H5/PDF 仅通过有效期 60 秒的一次性票据访问。实际打开前再次核对当期版本、付款和哈希；不提供文件直链。原 `/api/customer/reports/:projectId`、V2 数据及付款流程不变。

## 部署配置（目前禁止在生产启用）

| 变量 | 默认 | 作用 |
|---|---|---|
| `GEOGI_REPORT_V21_PUBLISH_ENABLED` | false | 开启版本服务和 V2.1 发布入口 |
| `GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED` | false | 允许非试点客户在实付订单及归属检查通过后使用 |
| `GEOGI_REPORT_V21_PRIVATE_ROOT` | 服务端 `data/report-v21` | 私有、持久化、非 `/uploads` 的版本及撤销账本 |
| `GEOGI_V2_EXACT_PILOT_ENABLED` 等试点限定变量 | false | 仅保留精确命名的旧试点例外，不可授权普通免费客户 |

OS 一侧仍须另行开启对应的 `GEOGI_REPORT_V21_GENERAL_PUBLISH_ENABLED`，并先通过真实来源、专业指标、批准订单与报告发布门禁。这些变量全部由运维专用私有配置管理，不能暴露给用户。

## 验收

- 独立本地 Node 域模块专项：`node server/tests/report_v21_bridge_regression.js`（27 项断言，含未付款、试点、跨客户、哈希、签名包 ID、撤回和幂等）。
- 静态跨层契约：`node server/tests/report_v21_end_to_end_contract.js`。
- 正式验收入口：`GEOGI_EXPECTED_HEAD_SHA=$(git rev-parse HEAD) bash tools/ci/paid_diagnostic_release_gate.sh`（必须干净工作区、真实小程序 AppID，且包含原全部旧 V2 测试）。
- **GitHub Actions 不作为验收前提**。
- 启用前还需在非生产真实隔离服务完成：OS→小程序字节上传→付费归属→独立包发布→客户手机号登录→两种票据→H5/PDF→撤销/退款与跨客户拒绝的完整 HTTP E2E，以及数据库、备份、恢复和配置验收。

当前仅完成合成样本及 Node 层专项，不表示真实新客户已获可发布资格。正式生产数据迁移、真实客户模型外发、补采和部署仍需分别授权。


## 2026-10-20 补充：实际复测发现并修复的隐私与撤回缺陷

- V2.1 追加撤回审计记录最初由于每次更新 `revoked_at` 而不满足幂等，现对既有记录校验 `client_id/project_id/delivery_package_id/artifact_sha256`，原子写入、并发 `EEXIST` 复核、异常篡改 fail-closed；重复撤回不覆盖第一次撤回时间。专项增补重复/并发/篡改用例。
- 原 `/uploads` 限制只匹配根层 PDF，可能让 `/./`、`/../`、大小写或编码的等价路径在静态服务规整后被读取。改为在 Express static 之前调用 `private-report-upload-guard.js`，以规范化 basename 拒绝 V2/V2.1 PDF 和 HTML，二次路径编码也 fail-closed。普通附件 PDF 未受影响。
- Linux Node22 隔离专项真实运行：`node server/tests/report_v21_bridge_regression.js` PASS，`node server/tests/private_report_upload_guard_regression.js` **18/18** PASS，两个服务模块 `node --check` PASS。新专项纳入默认 `npm test` 及平台无关 Release Gate。
- 这是独立专项不是精确提交的完整 MiniProgram `npm test`。Draft PR #83 仍保持未合并，发布开关仍关，严禁生产默认启用。


## 2026-10-20 最新隐私存储路径与跨语言 HTTP 复核（隔离开发）

1. V2.1 `GEOGI_REPORT_V21_PRIVATE_ROOT` 及 `packages/pointers/revocations/locks` 子目录必须在**物理路径**上与所有公开静态目录隔离（`/uploads` 与 `/source-codes`）。即使私有配置文字路径不同，符号链接到公开目录也必须 fail-closed；悬空链接、服务账本子目录软链接也拒绝。改动见 `report-v21-bridge-operations.js`。
2. 新增常规数据根别名、悬空软链接、四类子目录软链接、第二公开静态根及其软链接的隔离回归。
3. Linux Node22.16.0：本地源码副本执行完整 `server/npm test` 成功，日志 SHA-256 `134ee8d648f6e58ce4e37b3d5140ad0a41aa4f03deafc8f9abe53d9a3b20d5e5`，26 个串联测试脚本通过、无失败。**此副本起始于用户上传的旧分支 ZIP，手工叠加本轮两项修复，不是 GitHub 最新完整树的精确 HEAD 验收；不得误称正式版本全量 Gate PASS**。
4. 本地通过真正的 TCP loopback HTTP 请求，使用 GeoGi OS **Python MiniProgramBridgeClient** 向 Node.js 原始 `http` 测试适配器发送认证请求，后端实际调用 `createV21Bridge` 和 `admitOsArtifact`，完成 capabilities、实名付费约束（合成订单）、跨客户拒绝、Bearer 鉴权、双原文字节上传、财务无变动、发布后的哈希验证、幂等发布、撤销和撤销后访问拒绝共 **10 项**。日志 SHA-256 `672db98af6718e2066d5aa2ba56f088a6f6b9bb2bbfcec026d8265d80a185b94`。
5. **范围界限**：这是本机真实 HTTP + 实际 Python 客户端 + 实际 Node 域服务，但 Node 端使用测试专用 `node:http` 适配器；没有调用 Express 正式路由、真实微信/飞书/支付 API、真实供应商或生产数据，不能当生产 E2E。两个服务版本开关仍默认关闭。
6. 后续 P0：完整最新 HEAD 的平台无关 Release Gate、装有 Express/dotenv/helmet 的正式沙盒 HTTP 服务联测、微信客户真机授权、支付/退款、真实客户品牌事实/专业指标完成与双供应商合法联调，随后方能申请生产变更许可。


## 2026-10-20 追加：防版本回退与可复现跨语言 HTTP 验收

- `report-v21-bridge-operations.js` 增加 **冻结客户发布指针** 检查：不可变发布包 ID 相同但时间或其它字段不同时不允许冒称幂等发布；新报告必须有严格晚于已发布报告的 `released_at`；上一版本撤回不解除时间单调性约束；客户指针失配或不可解析时阻断而非当作不存在。对应 `report_v21_bridge_regression.js` 新增正常升级、恶意重复包、旧版回滚、客户指针篡改和撤回后旧版复活负测。
- Linux Node22 隔离源码副本的默认 26 组 `npm test` 全部成功。日志：`geogi-v21-rollback-release-regression-20261020.log`，SHA-256 `134ee8d648f6e58ce4e37b3d5140ad0a41aa4f03deafc8f9abe53d9a3b20d5e5`。日志文件在本次对话隔离工作区，**并非当前 GitHub 精确 HEAD Gate**；测试副本包含对应逻辑补丁，其他来源文件与远端最新 HEAD 不能认定逐字一致。
- 为避免之前10项 HTTP 联测仅存在于临时脚本，新增可重复运行的 `server/tests/v21_cross_repo_http_adapter.js`，由 OS 仓库 `tools/ci/report_v21_miniprogram_crossrepo_http.py` 启动。使用随机本机端口、合成客户、临时文件夹和合成凭据；验证真实 Python urllib 客户端到 Node 域服务的 10 项 TCP HTTP 契约，不需要 npm 外部依赖。
- 在 OS 仓库根目录运行：`GEOGI_V21_MINIPROGRAM_CHECKOUT=/absolute/path/to/GeoGi-MiniProgram PYTHONPATH=.:capture_agent/src python tools/ci/report_v21_miniprogram_crossrepo_http.py`。本次隔离实跑 `REAL_LOCAL_HTTP_CONTRACT=PASS`，日志 SHA-256 `672db98af6718e2066d5aa2ba56f088a6f6b9bb2bbfcec026d8265d80a185b94`；Python/Node 源码语法检查通过。**此联测 Node 端使用独立 node:http 测试适配器，不是生产 Express/WeChat/真实支付 API**。
- 两仓库生产均未修改，MiniProgram Draft PR #83 未合并，V2.1 发布开关默认关闭；未发出真实客户内容，不使用 GitHub Actions 做 Release Gate。


## 2026-10-20 客户「我的」完成状态联动（隔离开发，未上线）

- 真实业务缺口：V2.1 采用独立交付指针，旧 V2/Feishu 诊断订单可能仍显示“诊断处理中”，即使 V2.1 已正式发布，导致客户没有报告完成提醒。
- `customer-portal.listCustomerProjects` 在 V2.1 发布开关打开时，只根据服务端 `getV21CustomerReport(clientId,projectId)` **独立确认**的当前客户/项目/签名版本/当前付费/双文件哈希可访问结果，更新订单**展示投影**与结果通知。校验失败、撤回、跨客户、服务错误时保持 V2 状态，不得伪造已发布。不会修改旧 V2 客户指针、支付/佣金记录或生产数据库。
- 客户「我的」增加 V2.1 已交付文案；报告详情页 V2.1 独立状态和“无需重复付款”说明，已有旧 V2 报告仍通过原入口访问；V2.1 阅读使用现有独立 ticket/reader 鉴权。
- 新增 `server/tests/customer_portal_v21_visibility_regression.js`，覆盖：已验证客户展示与提醒、没有 V2 伪链接、保留实际 paymentStatus、撤回后不再展示、跨客户不展示、服务错误 fail-closed、开关关闭零探测。
- Linux Node22 隔离源码副本在本轮执行：完整 `npm test` **27/27** 串联脚本 PASS，无失败；复测 OS 正式 Python 客户端调用 Node 合成 HTTP 测试适配器 **10/10 PASS**。QA 日志 SHA-256 可由工作区 `geogi-v21-mine-v21-final-27-suites.log` 核实。这不等于 GitHub 最新 HEAD 精确 Release Gate，也不等于微信真机/真实客户验收。
- 当前仍 Draft、未合并、未部署，V2.1 生产开关仍关闭。需正式 Express/飞书订单/手机号/微信支付隔离 HTTP 联调及专业报告真实源证据/双模型全量验收。
