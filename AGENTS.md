# Repository Rules

## GeoGi Engineering & Release Governance

All GPT Chat, Codex, other automated agents and human developers working in this repository MUST comply with GeoGi Engineering & Release Governance v1.0. A mirrored copy is stored at `docs/governance/GeoGi_Engineering_Release_Governance_v1.0.md`; the canonical governance authority is maintained in GeoGi-OS.

Mandatory before any modification:

1. verify repository, worktree, branch, HEAD, remote HEAD and workspace safety;
2. state target release and Change ID;
3. keep one bounded work package per branch/PR and one independent worktree per concurrent agent;
4. never alter frozen tags or another active worktree;
5. never commit secrets, cookies, customer data or production credentials;
6. create an ADR before changing Schema semantics, OS/MiniProgram authority, scoring/evaluation rules, workflow/trust/promotion policy, or breaking delivery contracts.

Architecture rule for v1.0.0 and later:

- GeoGi OS is the sole business and delivery authority.
- GeoGi MiniProgram is authentication, intake, upload, project/status display, notification and delivery-artifact display only.
- MiniProgram MUST NOT analyze AI answers, compute GEO scores, generate root causes/recommendations/report content/charts, render PDF/images, decide report versions or alter OS-released results.
- MiniProgram may display only OS-released DeliveryPackage/Artifact references.

Historical frozen baseline: `customer-delivery-v1.0-rc1`.
Working candidate: `v1.0.0-rc.2`.
First customer release target: `v1.0.0`.

## GeoGi Brand Logo Authority

GeoGi Logo System v1.0.0 is frozen as of 2026-08-13.

All GeoGi logos must come from `assets/brand/logo-system/v1.0/`. Do not generate, redraw, approximate, edit, stretch, recolor, or otherwise modify a GeoGi logo. Do not add a white backing card. Preserve the canonical Regular / 400 wordmark and source aspect ratio.

Legacy `geogi_logo_dark_*`, `geogi_logo_mark_dark_*`, `geogi_logo_core_*`, and `geogi_mark_transparent_*` assets are prohibited in production. All future Codex tasks must follow this authority.
