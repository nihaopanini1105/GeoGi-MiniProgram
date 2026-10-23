# Repository Rules

## GeoGi Brand Logo Authority

GeoGi Logo System v1.0.0 is frozen as of 2026-08-13.

All GeoGi logos must come from `assets/brand/logo-system/v1.0/`. Do not generate, redraw, approximate, edit, stretch, recolor, or otherwise modify a GeoGi logo. Do not add a white backing card. Preserve the canonical Regular / 400 wordmark and source aspect ratio.

Legacy `geogi_logo_dark_*`, `geogi_logo_mark_dark_*`, `geogi_logo_core_*`, and `geogi_mark_transparent_*` assets are prohibited in production. All future Codex tasks must follow this authority.


## GeoGi shared development workflow (2026-10-23; proposed, non-production)

Preserve ALL frozen brand Logo rules above. This repository is the customer input/display and payment/status front end; GeoGi-OS remains the sole authority for GEO research, diagnosis, 16 metrics, M10 evidence, reports and release decision. Do not clone GEO algorithm or storage into the mini program.

Shared workflow reference:
https://github.com/nihaopanini1105/GeoGi-OS/blob/feat/r03-diagnostic-intelligence-data-engine/docs/development/GEOGI_UNIFIED_ENGINEERING_WORKFLOW.md

Before development verify actual repository/main baseline, working branch, clean state, current client↔GeoGi-OS API contract, WeChat compatibility and permissions. Work by complete customer journeys: real input/payment/report authorization→API integration→success/failure/retry state→mobile UI/branding→negative scope test→real simulator/device verification. Do not use placeholder business data as acceptance.

Use the mini program's own authorized build/check/test procedures; never copy GeoGi-OS PG16/Chromium release gate as a substitute for WeChat testing. Never use GitHub Actions as the GeoGi acceptance or deployment path. Track exact SHA and actual test evidence; if not run, mark NOT_RUN. Protect production, private identities, order/payment state, access control and historical customer reports; no main merge or release without specific authorization and regression.

Codex/ChatGPT resume from current GitHub HEAD and repo-local handoff, avoiding duplicate development. Before quota exhaustion, push safe changes, record dirty/unpushed work, actual test results and next complete customer flow. Old SHA tests do not certify later changes.
