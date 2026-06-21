# Summary - GenUI Review Workbench

Date: 2026-06-20
Level: M

## What Changed

- Added a GenUI-style review workbench to the medical dashboard.
- The dashboard now turns local Research OS review artifacts into cards with structured,
  disabled-by-default reviewer controls.
- The API exposes `medscale.genui_review_workbench.v1` in the top-level summary and in the
  `medical_research_os` payload.
- The frontend now contains a `GenUI Review Workbench` panel with card rendering, empty state, and
  locked control rendering.
- Tests cover the frontend hook, idle status payload, and populated review artifact payload.

## What Did Not Change

- The dashboard does not approve review artifacts.
- The dashboard does not choose canonical medical terminology.
- The dashboard does not author or submit medical claims.
- OpenTiny GenUI SDK packages were checked but not installed.

## Current State

- The dashboard can show pending PubMed worksheets and terminology mapping requests as a concrete
  review surface.
- Real review write actions remain intentionally locked until authentication, audit, and approval
  semantics are designed.
