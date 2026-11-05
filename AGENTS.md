# Repository Rules

## GeoGi Brand Logo Authority

GeoGi Logo System v1.0.0 is frozen as of 2026-08-13.

All GeoGi logos must come from `assets/brand/logo-system/v1.0/`. Do not generate, redraw, approximate, edit, stretch, recolor, or otherwise modify a GeoGi logo. Do not add a white backing card. Preserve the canonical Regular / 400 wordmark and source aspect ratio.

Legacy `geogi_logo_dark_*`, `geogi_logo_mark_dark_*`, `geogi_logo_core_*`, and `geogi_mark_transparent_*` assets are prohibited in production. All future Codex tasks must follow this authority.

<!-- BEGIN GEOGI RELEASE OWNER -->
## 版本发布由版本开发者完成

凡本版本需要发布，先读取 `docs/development/GEOGI_RELEASE_HANDOFF.md`，使用统一入口
`make release`。开发者负责工具同步、原生动作接入、测试、目标核实和发布记录。
不得把查找分支/PR/SHA、补传说明或工具源码、拼装发布命令的工作交回用户。

- 工具已在当前仓库：自行运行 `doctor`，修复工具或模块接入的缺项。
- 收到完整工具包：在开发环境解压，先运行包内独立 `bootstrap.py check`，再运行
  `bootstrap.py install --target 当前仓库`。安装器保护现有模块适配器、原生门禁和
  Makefile 的其他目标；代码合并由开发者处理，不覆盖功能分支的实现。
- 交接发布工具必须调用 `make release ARGS="bundle --verify --output 私有目录/toolkit.zip"`。
  交付该完整 ZIP；它必须同时含说明、源码、模板、测试、依赖、独立安装器和完整性清单。
  仅提供 Handoff 文档或本机路径不构成发布工具交付。
- 功能完成后自行核实最终 clean HEAD 和真实目标，按正式门禁、`prepare`、已有明确
  生产授权下的 `publish` 执行。`prepare` 自动附带可复用工具包，无需用户再索要源码。
- 当前尚未实现的原生动作由模块负责人完成；不能用空操作或假 PASS 代替备份、隔离、
  切换、验收和恢复。Dev3 的 Admin/Worker 按真实改动范围分别交付。
- 禁止 GitHub Actions。生产发布、客户报告交付和新平台问题发送保持各自既有授权。
  如果缺少真实业务决策、权限或明确生产授权，说明具体缺项；不得伪造授权或执行结果。
<!-- END GEOGI RELEASE OWNER -->
