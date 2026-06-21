# Review - GenUI Draft Artifacts

Date: 2026-06-21
Level: M

## Decision

Accept the slice as an auditability improvement.

## Findings

- Draft persistence is opt-in at the API level and enabled by the frontend action path.
- Persisted artifacts use the same manifest schema as other local review artifacts.
- The persisted draft payload retains `dry_run=true` and `write_enabled=false`.
- The dashboard can rediscover saved drafts and render them as workbench cards.
- Browser smoke confirmed a UI click persists a draft artifact and returns its draft ID.

## Residual Risks

- Dashboard runtime artifacts are local-file based and not a multi-user review store.
- Persisted drafts are not signed by an authenticated reviewer yet.
- Repeated clicks create multiple audit drafts for the same proposed action.
