# Task - Decision Entrypoints

Date: 2026-06-20
Level: CRITICAL
Task ID: `TASK-2026-06-20-DECISION-ENTRYPOINTS`
Implementation status: COMPLETE
Research workflow status: AWAITING_HUMAN_DECISIONS

## Implemented

- Added `TerminologyMappingDecisionRecorder`.
- Added `TerminologyDecisionError`.
- Added `PubMedWorksheetClaimSubmitter`.
- Exported the new entrypoints from `src.research_os`.
- Added tests for approval gates, unknown candidate rejection, reject-all recording, worksheet-gated
  claim submission, and claim ledger integration.

## Still Not Done By Machine

- No canonical terminology mapping was selected for the real `melanoma` request.
- No medical claim was created for the real PubMed worksheet.
- No disease project definition was supplied.

## Human Decisions Still Required

1. Approve the mapping request structure, then select `D008545` or reject all candidates.
2. Approve the PubMed worksheet structure, then submit human-authored claim text only if needed.
3. Approve each submitted mapping decision or claim before downstream use.
