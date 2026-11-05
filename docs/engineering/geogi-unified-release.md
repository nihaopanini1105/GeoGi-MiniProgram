# GeoGi 统一软件发布

入口：`python3.12 -m tools.live.geogi_release`，或 `make release ARGS="…"`。
适用于 dev3、report 和后续功能版本。执行既有 Admin / Mac Worker 发布器，
不依赖 Actions、不绑定某次历史 SHA、不替代客户报告对客发布。

## 完整工具自动交付与安装

统一交接命令为 `make release ARGS="bundle --verify --output /私有目录/toolkit.zip"`。
输出一个同时包含说明、源码、模板、测试、依赖和独立 bootstrap 的完整包；从真实
解压结果执行专项测试，测试失败或源码闭包缺失时不交付 ZIP。接收开发者无需用户
另找源码，直接使用包内 bootstrap check/install。安装保留业务代码、原生门禁与
已实现适配器，公共工具合并由开发者完成。职责写入根 AGENTS.md。
prepare 也会自动附带完整工具包；其源码已受本次正式精确 SHA 门禁约束，包内
完整性检查与全仓正式 Gate 分别记录，不能把模板安装称为生产成功。

## 功能尚未完成时，现在准备好工具

不需要用户提前确认分支或 PR。已提供 `dev3-admin`、`dev3-worker`、`report`
三个不绑定版本的接入模板；后续功能可用 `scaffold` 自动生成。开发者在开发过程中
接好该运行环境的原生动作，完成后直接调用 `doctor → prepare → publish`。
`prepare` 自动取最终 clean HEAD、生成配置并核对精确 SHA 门禁。
完整步骤见 `docs/development/GEOGI_RELEASE_HANDOFF.md`。

```bash
make release ARGS="doctor --module report"
make release ARGS="prepare --module report --version r1 --target production-admin --gate /private/evidence/full-gate/summary.json --output /private/reviewed/report-r1"
```

模板中的原生方法在功能未完成前会明确报缺失，不执行生产。
以下 `init/plan` 为兼容已有发布器的底层命令配置方式。

## 版本接入一次，后续复用

每个运行环境用一个受审查的 `commands.json`，将以下九个动作映射为 argv 数组。
原生发布器必须检查当前运行基线、目标、镜像/适配器摘要、配置和权限，并负责原生锁。
所有命令退出码为 0 才继续；命令自身必须真实验证对应条件，不能用 `echo PASS`。
统一层只证明这些命令执行成功，不把退出码当成真实业务来源/客户验收证明。

| 动作 | 原生发布器责任 |
| --- | --- |
| `check` | 只读核实目标、当前基线、待发布制品与权限 |
| `backup` | 创建并校验私有备份，保存基线和恢复位置到运行目录 |
| `stage` | 隔离预演，包括原生回滚/恢复验证；不得切换生产 |
| `before_switch` | 重读基线、空闲/在途任务、备份、授权有效期，拒绝漂移 |
| `switch` | 仅切换本次范围内的服务/Worker；允许失败后恢复 |
| `verify` | 健康、版本摘要、权限隔离、受保护服务/原件未改变 |
| `before_rollback` | 确认仍是本次切换的实例，拒绝覆盖其他发布 |
| `rollback` | 用本次备份恢复原运行版本；须可重入，不能依赖旧源码目录 |
| `verify_rollback` | 原版本、健康和保护边界实际恢复 |

配置示例（`tools/live/module_runtime_driver.py` 是**模块负责人提供的原生适配器**，
不是仓库内已存在的命令；不可照抄后声称已接入）：

```json
{
  "check": ["{python}", "{source}/tools/live/module_runtime_driver.py", "check"],
  "backup": ["{python}", "{source}/tools/live/module_runtime_driver.py", "backup"],
  "stage": ["{python}", "{source}/tools/live/module_runtime_driver.py", "stage"],
  "before_switch": ["{python}", "{source}/tools/live/module_runtime_driver.py", "before-switch"],
  "switch": ["{python}", "{source}/tools/live/module_runtime_driver.py", "switch"],
  "verify": ["{python}", "{source}/tools/live/module_runtime_driver.py", "verify"],
  "before_rollback": ["{python}", "{source}/tools/live/module_runtime_driver.py", "before-rollback"],
  "rollback": ["{python}", "{source}/tools/live/module_runtime_driver.py", "rollback"],
  "verify_rollback": ["{python}", "{source}/tools/live/module_runtime_driver.py", "verify-rollback"]
}
```

现有 `dev1_d52_f1_release.py`、`report_v2_controlled_release.py` 和 Mac R6 单步包
各自有精确基线/阶段/授权合同。接入时由原生适配器翻译这些动作，保留旧约束，
不要把历史 SHA 改成任意 SHA 后绕过原门禁。R6 的活动 Worker blob 不等于 main；
源码未整合时不能从旧 main 重建它。当前交付的是公共编排能力，**尚未把这些历史
发布器自动改造成通用原生适配器，也没有证明现网 Dev3/Report 已完成接入**。

示例创建 dev3 配置：

```bash
python3.12 -m tools.live.geogi_release init \
  --profile dev3 --module capture --version r8 \
  --target production-capture-mac --resource capture-worker \
  --commands /private/reviewed/dev3-commands.json \
  --output /private/reviewed/dev3-release.json
```

Report 改用 `--profile report --module report --resource geogi-admin`；
未来功能使用 `--profile feature --module <名称>`。**所有会改同一 Admin 的版本都用
`geogi-admin` 这个 resource，共用同一个 state-root**，不能各取一个名称绕过互斥。
Mac Worker 使用独立 resource。跨主机/旧发布器的互斥仍由原生发布器现有锁负责。
软件发布不写客户业务对象，不创建 CaptureJob，不向 AI 平台发送问题，不发布客户报告。
这些是原生适配器必须遵守的范围，不是命令执行器对任意脚本的沙箱限制。

## 正式使用

先在正式 clean checkout 完成既有真实 PG16、Chromium 和全仓精确 SHA 门禁。
本入口不会联网更新源码、构建镜像或伪造 gate/授权。先把原生发布器及其依赖提交，
再运行正式门禁。测试产物按既有流程归档并恢复 clean checkout。

```bash
python3.12 -m tools.live.geogi_release plan \
  --recipe /private/reviewed/dev3-release.json \
  --expected-sha <40位已验证SHA> \
  --gate /private/evidence/full-gate/summary.json \
  --output /private/reviewed/dev3-plan.json
```

该命令只读校验官方 origin、clean HEAD、原始/最终源码指纹、正式门禁分支、
四阶段退出码、测试非空/零失败/零错误/零跳过及每份证据文件的 SHA256。
输出完整计划与 `plan_sha256`；计划包含目标、resource、版本、完整 argv 和 gate 摘要。
原生脚本和配置应受可信操作员控制，凭据通过现有密钥文件提供，不能写入 argv/recipe。

用户审核具体计划并给出本次生产授权后：

```bash
python3.12 -m tools.live.geogi_release publish \
  --plan /private/reviewed/dev3-plan.json --plan-sha256 <计划摘要> \
  --state-root /private/persistent/geogi-releases --approval-ref <现有授权引用>
```

一次执行检查、备份、隔离预演、切换和验收。`approval-ref` 记录授权来源，
**不创建授权，不验证授权机构身份**；执行者必须已有权限，原生发布器仍须校验实际授权。
目标目录必须是 0700、检出目录以外的持久私有目录。备份和回执可通过
`GEOGI_RELEASE_RUN` 保存到该目录。`GEOGI_RELEASE_CONTEXT` 指向当前动作的 JSON，
包含 SHA、target/resource、计划摘要和授权引用；`GEOGI_RELEASE_PHASE` 为动作名。
不使用 shell=True，不展开 `$()`/环境变量。仅替换 `{python}` 和 `{source}`。

## 状态与故障恢复

```bash
python3.12 -m tools.live.geogi_release status --run <输出的run目录>
python3.12 -m tools.live.geogi_release rollback \
  --run <run目录> --plan-sha256 <同一计划摘要> --approval-ref <恢复授权引用>
```

每个动作有时间、退出码、私有日志摘要与追加式事件；`status.json` 原子落盘。
切换意图在执行前持久化；即使 switch 半途报错/超时/收到中断，也先补偿回滚再报告失败。
回滚失败明确标 `rollback_failed/runtime_state=unknown`，阻止同 resource 的新发布。
SIGKILL/断电留下的未完成记录也阻止下一次发布；先对原 run 执行恢复命令。
已尝试切换的计划不能再次执行；重发或回滚后重发必须生成并审核新计划。
切换前崩溃的 run 同样通过 rollback 命令解除阻断，保留隔离产物/备份而不执行生产回滚。
回滚使用切换前复制并校验的 Git 源码，原工作目录变动不阻断恢复。
原生恢复命令必须使用 `{source}/…`，相对文件由恢复副本读取，禁止硬编码旧 checkout。
回滚不能覆盖日志中更新的发布，且原生 `before_rollback` 必须再次核实真实实例，
确保远程切换进程已停止或被 fencing；终止本地 SSH 并不能证明远程执行已停止。
目录和 SHA256 提供可追溯性，不是独立签名/防管理员篡改的审计系统。

`deployed` 只表示本次原生软件切换与验收命令成功；不更新全局生产声明，不代表
Dev3 五平台真实 E2E、客户报告交付或生产迁移验收。`status` 是历史回执，不是实时巡检。
