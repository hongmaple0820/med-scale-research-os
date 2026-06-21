# Review - GenUI Action Drafts

Date: 2026-06-20
Level: M

## Decision

Accept the slice as a safe pre-execution bridge from generated UI controls to Research OS
entrypoints.

## Findings

- The new endpoint validates action intent without mutating artifact state.
- Mapping selection drafts reject unknown IDs outside the reviewed candidate snapshot.
- PubMed claim drafts reject unapproved worksheets and locators outside the reviewed worksheet
  snapshot.
- Browser smoke confirmed a page-level click produces a ready dry-run draft with
  `write_enabled=false`.

## Residual Risks

- The page still polls status every two seconds, so long-lived draft messages are transient.
- There is no authenticated reviewer session yet.
- Real execution remains intentionally absent and needs a separate safety review.
