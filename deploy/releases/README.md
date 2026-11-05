# GeoGi release adapter kits

Start with [the developer handoff](../../docs/development/GEOGI_RELEASE_HANDOFF.md).
No branch, PR, SHA, image, version or production host is fixed in these kits.

- `dev3-admin`: Dev3 server; shared `geogi-admin` release resource.
- `dev3-worker`: Dev3 Mac Worker; shared `capture-worker` release resource.
- `report`: report software; shared `geogi-admin` release resource.

Implement each native hook as part of the feature's development, verify it on
an isolated runtime, and return `{"verified": true}` only after its real check.
Unfinished kits deliberately fail `doctor` and `prepare`; they cannot silently
deploy. `doctor` parses source and never imports or executes the adapter.

For future modules: `make release ARGS="scaffold --module NAME --profile feature --runtime admin"`.
After development: `doctor` -> formal exact-SHA gate -> `prepare` -> authorized `publish`.
Do not replace these hooks with unconditional success or weaken a legacy
publisher's frozen baseline, native locking, backup, rollback or authorization.

Source transfer is the version developer's responsibility. A handoff must use
`make release ARGS="bundle --verify --output /private/toolkit.zip"`, not a document
or a local source path alone. The complete archive contains standalone
`bootstrap.py check/install`, the native-hook ABI, source, tests and dependencies.
`prepare` automatically includes this reusable archive with its release plan.
