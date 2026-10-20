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


## 2026-10-20 客户付款资格跨租户核验（新增 P0，尚未上线）

- 在联测中发现潜在跨客户同项目编号导致的安全漏洞：旧客户报告 `getCustomerReport`、`listCustomerProjects` 与运营 `listOsIntakes` 的支付关联只使用 `projectId`，未交叉检查支付记录的 `clientId`，可能使另一个客户的实付订单被当作本客户的付款证明（条件：数据源存在重复 projectId 或错误关联）。
- 修复后 **客户编号+项目编号** 必须同时与订单字段逐字一致，否则不返回该付款，也不能作为 V2/V2.1 读取或 OS 接单的财务凭据。客户展示中的 Feishu 项目索引也改用客户+项目复合键，不再让两名客户的项目行互相覆盖。
- `payment-service` 的支付创建、查单、取消、同步与 `payment-store` 的已有订单重用必须核对复合范围；发现已有同 projectId 但不同客户的付款时，创建支付一律显式拒绝（`PAYMENT_CLIENT_PROJECT_SCOPE_CONFLICT`），防止重复购买或错误退款投影。独立补充资料流程亦不读取其他客户的退款状态。
- `customer_portal_payment_scope_regression.js` 及 `payment_customer_scope_crossservice_regression.js` 已纳入 `npm test`，模拟两个客户拥有相同项目编号，测试对错付款、旧 V2 报告读取、运营接单资格、支付创建/同步/取消均 fail-closed。此为合成负测，不意味着生产存在实际重复项目编号。
- 本轮隔离 Linux Node22 源码副本执行 **29/29 组 npm test PASS**；并运行平台无关、绑定本地干净 QA SHA `1503eaf427f36bd89da5f5bbd77947acb3ec1ecb` 的付费诊断 Release Gate：**PASS**，日志 SHA-256 `9fc2aded6c2ad59bd989ad78fc9f6e628b7ab3d987e9cf3ddc7da3cae91d833f`。QA 源码副本与最新 GitHub 完整文件树仍有部分差异，不得冒称最新远端分支精确 HEAD Gate。
- 原 V2 历史业务仅改变跨客户错误绑定的安全约束；对符合真实客户、项目、已付订单三者相同的正常用户不改变金额或支付接口。小程序 Draft PR #83 未合并，配置默认关闭，生产零修改。


### 2026-10-20 支付状态回写安全加固

- 补查发现旧微信支付/退款通知调用的 `projectPaymentProjection` 仍只用 `projectId` 选择飞书记录，若客户间发生同编号或异常重复数据，可能把真实付款/退款状态写入**其他客户的项目**。这不同于前述只读订单展示，属于更高风险的写操作。
- 已将 `projectPaymentProjection` 的客户端、项目双重范围设为必填；同时检查飞书 leads/projects 各**恰好一条**符合当前 `clientId + projectId` 的记录，否则直接返回不更新，防止模糊记录或重复映射被写入。同步、取消、超时订单、运营退款、微信付款及退款 webhook 均从实际订单传入 `clientId`。
- 新增同项目编号双客户写入负测、缺失客户时零写入、真实同范围两张飞书表写入指定 record_id 的测试；使用全合成数据与注入存储，不触达飞书线上。
- 隔离 Linux Node22 完整本地 29组 `npm test` 通过，`/mnt/data/geogi-v21-payment-projection-29.log` 保存QA记录。前述本地独立 Gate 的绑定快照**早于本次投影写入修复**，不得冒称它已覆盖最新提交；仍需要新 HEAD 完整 Gate+非生产真实接口验收。


## 2026-10-20 本轮：修复旧版 OS RELEASED 阶段和佣金入账边界（已入开发分支）

**实际发现的兼容路径风险：** V2.1 独立交付不再使用旧财务副作用，但旧 V2 仍会收到 `POST /internal/os/projects/:projectId/stage` 和 `POST /internal/os/delivery-packages`。原 `updateOsProjectStage` 使用单一 projectId 从两张飞书表取首条记录，而 `markProjectReportReleased` 用单一 projectId 标记“报告已发布”。如果上游同项目编号跨客户重复，这两条旧链路可能写错客户。

**已修复：**
- `updateOsProjectStage` 新增可选 clientId 兼容历史调用；无 clientId 时必须确保 leads 和 projects 各唯一一个项目编号且其客户一致，有 clientId 时还须相符，否则 fail-closed、不写飞书。内部按此校验后才允许写阶段。
- 旧 V2 `publishOsDeliveryPackage` 在**文件导入前**预检真实客户/项目唯一归属和客户订单归属，避免导入错误客户报告后才发现不匹配。
- `markProjectReportReleased` 强制 clientId + projectId，同时核对支付订单客户归属。订单匹配后才修改 reportReleasedAt，进而允许已有佣金流程按规则结算。
- 旧 OS bridge API 兼容：stage body 可传 `clientId` 或 `client_id`，不传时仅允许无歧义的旧项目；完整历史委托中真实客户/项目一致的合法订单继续正常执行。
- 新增 `server/tests/os_project_scope_regression.js`，涵盖两客户同编号、两张表分别属于不同客户、显式错误客户、唯一客户无 clientId 的兼容、错误客户付款拒绝、早于导入的范围预检及正常佣金通道。已纳入 `server/npm test` 的默认测试序列。

**隔离验收证据：** Linux Node22，使用用户上传的**较早小程序 ZIP**加本轮 bridge/payment-store 修复（`server/src/services/os-operations-bridge.js`, `server/src/services/payment-store.js`）在临时工作区执行 `os_project_scope_regression`、`os_operations_bridge_regression`、`channel_redemption_commission_regression` **均 PASS**；对历史 ZIP 的两条已知过期静态断言作 QA-only 兼容后，`npm test` 完成且无失败。日志 `/mnt/data/geogi-v21-os-stage-payment-scope-local-qa.log`。**并非最新远端 HEAD 全量 Gate，亦未测试真实飞书或微信支付。**

发布状态：仍然 Draft PR #83，默认关闭 V2.1，未修改生产、未部署、未上线。继续需要最新 Git HEAD 对应完整 Gate、正式 Express/Feishu/微信联测及 OS 全量 GEO 实证指标/合规双供应商验收。


## 2026-10-20：旧 V2 付费诊断最后一道发布门禁（P0）

- 核查发现：在修复客户/项目归属后，`publishOsDeliveryPackage` 仍没有在**真正导入并交付 V2 诊断包前**重新确认客户付费资格。只要 OS Bridge Bearer 获得授权，即使是 2026-09-22 正式付费产品推出后的未付款订单，也可能由旧 V2 包的发布入口导入，违反小程序付费交付规则。此项为**代码级风险**，未发现生产实际发生证据。
- 在 `server/src/services/os-v2-release-eligibility.js` 新增无副作用的判断：`geo_diagnostic_html_release_v2 + baseline_diagnostic_report` 必须满足已付费/部分退款有效单、合法渠道优惠免付、付费产品上线前真实历史记录、或**明确配置且客户+项目严格匹配的 GeoGi 试点**之一。已退款/退款处理中、未付款、无合法渠道的免费订单、付款客户错配或 CRM 身份错配拒绝；已有其它报告 authority 不被此专项错误误伤。
- `os-operations-bridge.publishOsDeliveryPackage` 在真正 `importDeliveryPackage` 和 `updateOsProjectStage(RELEASED)` **之前**调用上述判断，不满足则返回 `OS_BRIDGE_V2_RELEASE_NOT_ELIGIBLE`，没有包导入、阶段回写、付款标记或佣金写入。
- `server/tests/os_v2_release_eligibility_regression.js` **18项断言 PASS**（涵盖有/无付款、渠道优惠、历史期、试点、退款/跨客户否定）；`server/tests/os_v2_release_admission_integration_regression.js` 通过隔离模拟飞书/支付/存储，运行**8个实际 OS bridge 发布场景**并断言拒绝时无交付副作用；两者已加入本地 `npm test`，Release Gate 增加新策略文件 JS 语法检查。
- Linux Node22 真实本地独立执行两组专项 + JS 语法检查 **PASS**；日志 SHA256 `64c1e3436bf8f02920fdbf6e10dc777532452c7e88ae180cc2375a60a6cffd19`。集成测试在用户旧 ZIP 源码上应用**等价发布入口改动**的隔离 twin，非 GitHub 当前最新 HEAD 精确代码树、非正式 Express / 真飞书支付。正式的最新 HEAD 完整 `npm test` + 真实新客户付费联调仍为上线阻断。
- GitHub Actions 不作为门禁。Draft PR #83 未合并，未修改生产、未部署、未改变真实支付订单。


## 2026-10-20：旧 V2 发布端与客户阅读端的资格一致性（新增客户真实体验阻断修复）

- 发现旧 V2 `customer-portal.isPaidForReport` 把任意 `payment.status='free'` 都视为可读取报告，但小程序最终 `os-v2-release-eligibility` 发布门禁只认可有 `channelId+sourceId` 的渠道优惠免付；原先即使无法在发布端取得正式资格，也可能在旧客户阅读入口被误判为“优惠已生效”。已统一免费访问依据，另外未找到准确匹配的飞书项目记录时不授予可阅读权限。
- 客户「我的」及详情页对**缺少渠道证据的 free 状态**显示“优惠资格待核验”，不得显示“优惠免付/已交付”；原始 `paymentStatus` 保留以供内部审计，后续正式付款或真实具名渠道优惠仍如常处理。
- 同时修复反方向历史资格不一致：收费政策生效前（`2026-09-22T07:33:31Z` 前）的真实已发布 V2 订单，本来发布端允许无已付交易交付，但阅读端会误要求再次付款。现在 `customer-portal` 调用**同一 `assessV2ReleaseEligibility`** 判定，并共享原收费生效截止常量；只接受特定 V2 authority、合法项目归属且 verdict.reason 明确为 `prepaid_product_launch_legacy` 的历史记录。后来未付款、已退款/退款中、伪造项目和错误 V2 authority 都不获得历史例外。
- 旧 GeoGi 精确试点授予仍独立且须真实项目归属；新 V2.1 正式专业报告继续使用独立 H5/PDF 验签与发布门禁，**不受历史例外的弱化**。
- 新增 `server/tests/customer_report_free_grant_regression.js` 并纳入常规 `npm test`，验证无来源 free 拒绝、具名真实优惠允许、缺项目拒绝、历史收费前允许、退款否定、新收费后未付否定、前端显示以及旧付款状态审计保留。
- 隔离 Node22 QA：用户上传的**较早** MiniProgram 源码 ZIP + 相同业务变更，17 个 JS 语法检查和默认25组 `npm test` **通过**，本地干净QA SHA `d08e7907aad58aff37fe95c7070025121a23bef3` 的平台无关 `paid_diagnostic_release_gate.sh` **PASS**，日志 SHA256 `89c188b58f94b14f5176b1da69c783029e5e65bd94d922c6f15a48e4f4add4d6`。
- **证据界限：** 本地 QA 提交不是当前 GitHub 开发分支的完整同树 HEAD；旧 ZIP 测试链仅25组而新分支有更多测试。尚须最新远端全量 Gate、正式 Express/飞书/微信隔离 E2E、真实合法专业 GEO 证据与双供应商验收。没有生产客户读写、迁移、付款操作或正式部署；发布开关默认关闭，PR仍Draft，Actions不作为权威门禁。
