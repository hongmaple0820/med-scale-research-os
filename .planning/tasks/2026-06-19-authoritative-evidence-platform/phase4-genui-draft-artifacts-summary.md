# Summary - GenUI Draft Artifacts

Date: 2026-06-21
Level: M

## What Changed

- GenUI action drafts can now be saved as local audit artifacts.
- Saved draft artifacts are represented by payload JSON plus a manifest JSON.
- The workbench now recognizes saved draft cards.
- The frontend persists a draft when an enabled GenUI action is clicked.
- JSON schema documentation now includes `medscale.genui_review_action_draft.v1`.

## What Did Not Change

- The persisted draft is still not an execution result.
- The dashboard still does not approve review artifacts.
- The dashboard still does not create medical decisions or claim records.

## Current State

- The GenUI workflow now has a traceable pre-execution audit step.
- The next step is a separate authenticated confirmation and execution design.
