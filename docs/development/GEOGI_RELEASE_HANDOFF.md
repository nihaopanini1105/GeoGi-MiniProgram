# 给 Dev3、Report 和后续功能开发者的发布接入说明

发布工具交付、代码同步、原生动作接入、测试与发布记录由**版本开发者**负责。
用户无需提供分支、PR、SHA，无需补传源码、说明或拼装命令。
当前仓库 `AGENTS.md` 已登记这一职责，开发者收到发布任务时自行执行下面的流程。

## 开发者自行取得并安装完整工具

工具在共同基线中已有时直接使用。跨工作区/跨环境交接时，工具维护者必须生成并
交付一个完整 ZIP，不能只给本文或本机路径：

```bash
make release ARGS="bundle --verify --output /私有交付目录/geogi-release-toolkit.zip"
```

包内同时包含本文、工程说明、全部公共源码、模块模板、专项测试、依赖、独立
`bootstrap.py`、完整性清单和 `DEVELOPER_TASK.md`。生成时校验文件与导入依赖闭包；
`--verify` 会从实际 ZIP 解压后的源码运行专项测试，失败不生成可交付 ZIP。
仅说明、缺实现或缺依赖的包会失败，而不是留给用户发现。

接收版本的开发者将 ZIP 解压到当前仓库之外，**无需预先装好 GeoGi 工具**即可执行：

```bash
python3.12 bootstrap.py check
python3.12 bootstrap.py install --target /自己的/GeoGi仓库
```

安装器自动合并统一 Makefile 入口和发布职责说明，保留业务代码、现有原生门禁、
已实现模块适配器和原 Makefile 其他目标。公共工具有差异时由开发者审查、合并；
确认公共工具更新可加 `--update-tools`，更新前备份，失败恢复已写文件。
冲突由开发者处理，不再让用户寻找工具源码、转交 SHA/PR 或猜测安装目录。
安装不修改 Git 历史，不操作生产。开发者随后把工具/适配器按本分支治理要求提交。

## 已备好的接入点

| 模块名 | 用途 | 共用互斥资源 | 入口文件 |
| --- | --- | --- | --- |
| `dev3-admin` | Dev3 服务端软件 | `geogi-admin` | `deploy/releases/dev3-admin/adapter.py` |
| `dev3-worker` | Dev3 Mac Worker | `capture-worker` | `deploy/releases/dev3-worker/adapter.py` |
| `report` | Report 服务端软件 | `geogi-admin` | `deploy/releases/report/adapter.py` |

这些模板不固定版本、分支、PR、SHA、镜像或生产目标，当前尚未实现的动作会明确报缺失。
Dev3 若同时改变服务端和 Worker，分别准备、审核和执行两个模块的计划，按真实依赖
顺序安排；不能把其中一个成功说成两个都已上线。Report 软件部署与报告对客交付分开。

后续新功能复制流程即可，无需改公共发布器：

```bash
make release ARGS="scaffold --module my-feature --profile feature --runtime admin"
```

`admin` 强制共用 `geogi-admin`，`worker` 共用 `capture-worker`。
其他运行环境用 `--runtime custom --resource <同一资源共用的名称>`。
scaffold 不覆盖已有模块，也不执行生产命令。

## 开发过程中接好原生部署动作

在生成的 `Adapter(ReleaseAdapter)` 中接入该运行环境已有的部署代码。
九个方法的具体职责已写进方法注释；可调用既有函数/控制器，不要复制公共状态机。
共享类型位于 `tools.releasing.sdk`；适配器、模块描述及源码依赖须提交到 Git，
不能放在被忽略的本地目录。
原生发布器继续拥有实际制品、配置、空闲/在途任务、备份恢复、租户隔离和远程 fencing。
每个方法完成真实检查后返回 `{"verified": True}`；空实现、默认成功或伪造 PASS 不能验收。

`context` 提供：

- `source_sha`：当前被验证提交；不需要开发者硬编码。
- `module` / `version` / `profile`：本次模块、版本标签和发布配置类型。
- `target` / `resource`：本次部署目标与互斥资源。
- `run_directory`：本次持久私有目录，用于备份、隔离结果和原生回执。
- `approval_ref`：现有操作授权引用；恢复时为恢复授权引用。
- `path(name)` / `write_json(name, value)` / `read_json(name)`：在本次私有目录中保存和读取原生恢复资料。

方法无返回值或返回 `verified=false` 都会失败。恢复动作使用该 run 冻结的源码和备份，
不可依赖开发者旧工作目录。密钥走现有密钥文件，不能写入模块描述或提交到 Git。
不发送新平台问题、不修改原始采集/客户数据、不在软件发布中对客发布报告。

## 开发完成后的固定命令

先检查接入是否齐全，命令不会 import 或运行 adapter：

```bash
make release ARGS="doctor --module report"
# Dev3 分别使用 --module dev3-admin 或 --module dev3-worker
```

退出码 2 和 `needs_implementation` 表示逐项列出的原生方法还没实现；
`adapter_contract_ready` 只表示接口齐全/语法通过，不能替代真实发布验收。

完成模块测试和集成、在 clean checkout 通过既有正式 PG16/Chromium/全仓 Gate 后：

```bash
make release ARGS="prepare --module report --version r1 --target production-admin --gate /private/evidence/full-gate/summary.json --output /private/reviewed/report-r1"
```

这里的 `version` 是本次模块版本标签，`target` 由开发者/部署者填写实际环境标识。
`prepare` 自动取当前 HEAD，自动生成九阶段命令配置、`recipe.json`、`plan.json` 和
`preparation.json`，并校验正式门禁与全部证据摘要。
还会自动附带完整 `developer-toolkit.zip` 和开发者入口说明，不需要用户再次索要源码。不需要用户告诉工具开发分支或 PR。
若适配未完成、源不干净、证据缺失或 SHA 不一致，会在切换前拒绝。
正式门禁的集成分支要求继续沿用原仓库政策，不因新功能放宽。

审核具体计划、取得现有生产授权后，执行输出计划的同一摘要：

```bash
make release ARGS="publish --plan /private/reviewed/report-r1/plan.json --plan-sha256 <prepare输出的摘要> --state-root /private/persistent/geogi-releases --approval-ref <本次已有授权引用>"
```

新版本只需重新测试并 `prepare`，不需要再次生成模板或改公共发布逻辑。
开发完成不会自动触发生产部署；不使用 GitHub Actions。
底层命令配置兼容入口 `init/plan`、状态和故障恢复见
`docs/engineering/geogi-unified-release.md`。
