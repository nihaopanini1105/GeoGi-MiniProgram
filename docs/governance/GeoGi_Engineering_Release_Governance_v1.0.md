# GeoGi Engineering & Release Governance v1.0

Status: ACCEPTED
Canonical authority: GeoGi-OS repository.
Applies to all GeoGi GPT Chat, Codex, other agent and human development.

## Core rules

1. GitHub is the only source of truth for code. Production versions are defined by repository + commit SHA + immutable tag + release manifest + production snapshot hash.
2. Frozen tags, including `customer-delivery-v1.0-rc1`, are immutable and must never be moved, deleted, force-updated or overwritten.
3. Customer-specific behavior is data/configuration, not product code. Long-lived `customer/*` branches are prohibited.
4. Allowed branches: `main`, `release/vX.Y.Z-rc.N`, `feat/<work-id>-<slug>`, `fix/<work-id>-<slug>`, `hotfix/<version>-<slug>`, `docs/<work-id>-<slug>`.
5. Each concurrent agent/task uses its own branch and worktree. Never reset/stash/abort/clean another active worktree.
6. Every task begins with preflight: repository, working directory, branch, HEAD, remote HEAD, git status, base tag/SHA, target release, Change ID, authority docs, scope/out-of-scope.
7. One PR = one bounded work package. Cross-repo work uses the same Change ID and exact commits are bound in the Release Manifest.
8. ADR required for Schema semantics, OS/MiniProgram authority, scoring/evaluation, workflow/trust/promotion policy, or breaking delivery/API changes.
9. Product releases use SemVer. Current candidate is `v1.0.0-rc.2`; first customer target is `v1.0.0`.
10. Every customer-visible report/score must carry exact module/data versions. Every deploy requires a machine-readable Release Manifest.
11. Normal production deployment uses an accepted release tag/bundle only. Production-only code drift is prohibited. Hotfixes must return to Git and receive a patch tag.
12. Secrets, cookies, credentials, private customer data and raw access tokens must never be committed.

## Architecture authority

GeoGi OS is the sole business and delivery authority. It owns Brand Digital Twin, evidence, query/prompt governance, capture governance, evaluation, scoring, root cause, opportunity, recommendations, Strategy Learning, report content, charts, report rendering, report QA, artifact versioning and release eligibility.

GeoGi MiniProgram is a customer terminal only. It may own authentication, information intake, uploads, project/status display, notification and display of OS-released artifacts.

MiniProgram MUST NOT recompute, reinterpret or modify OS intelligence and MUST NOT generate report content, charts, PDF/images or report versions.

## Release path

Feature PR -> CI -> release candidate -> deterministic fixtures/golden dataset -> contract QA -> evidence QA -> customer-auth E2E -> delivery E2E -> production snapshot -> tagged bundle -> deploy -> production smoke -> immutable release tag.
