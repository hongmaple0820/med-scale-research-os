# ADR-0006: Terminology, Retrieval, and Evidence Methodology

Date: 2026-06-19
Status: Accepted

## Context

The user supplied a broad medical AI implementation guide. It correctly emphasizes terminology,
retrieval, evidence traceability, and medical/business isolation, but also labels several custom
scores and fixed parameters as industry standards without reproducible support.

## Decision

1. Use a versioned Terminology Registry with domain-specific canonical identifiers.
2. Treat UMLS and SNOMED CT as licensed optional crosswalks, not universal mandatory truth.
3. Keep source-language indexes separate and fuse only traceable records.
4. Benchmark lexical, controlled-vocabulary, vector, and entity-expansion retrieval before choosing
   weights or Top-K values.
5. Separate study design, risk of bias, certainty of evidence, and applicability.
6. Do not call a numeric publication-type score GRADE.
7. Require a sentence/claim-level evidence ledger for formal outputs.
8. Treat knowledge graphs as derived, incomplete indexes whose edges require source locators.
9. Preserve the rule that models cannot make medical, target-selection, legal, market, or
   investment judgments.

## Consequences

- More metadata and human review are required before retrieval or evidence ranking can be used.
- Fixed ranking formulas and vendor/tool claims from the supplied guide are not requirements.
- Terminology and literature adapters become the next trusted vertical slices.
- Knowledge graph and external commercial-model work are deferred.

## Verification

- Every terminology release and mapping has a version, license, checksum, and review state.
- Retrieval comparisons use a frozen labeled benchmark.
- Every formal claim resolves to source records and original-text locators.
- Evidence certainty cannot be computed from journal impact factor or citation count alone.
