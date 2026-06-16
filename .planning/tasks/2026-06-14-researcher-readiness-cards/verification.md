# Verification - 2026-06-14-researcher-readiness-cards

Date: 2026-06-14
Level: M

## Commands Run

- `make new-task NAME=researcher-readiness-cards LEVEL=M`
  - Result: failed, `make` is not available in this Windows environment.
- `make plan NAME=researcher-readiness-cards LEVEL=M`
  - Result: failed, `make` is not available in this Windows environment.
- `bash scripts/workflow/new-task.sh researcher-readiness-cards M`
  - Result: failed, `/bin/bash` is not available.
- `python -m pytest target-research-platform/tests/test_deliverables.py`
  - Result: failed from repository root because pytest rootdir switched to `target-research-platform` and `src.dashboard.app` was not on import path.
- `python -m pytest tests/test_deliverables.py`
  - Result: passed, 17 tests.
- Playwright desktop smoke with temporary `/api/status`
  - Result: passed; rendered 5 readiness cards with statuses `通过但需复核`, `可审阅`, `ZIP 可交付`, `已播种`, `可复审`.
- Playwright mobile smoke at 390px width
  - Result: passed; 5 cards rendered, `scrollWidth=390`, `overflowingCards=0`.
- `node dist/api/cli.js target dashboard --dir E:\project\yixue-scale-engine --host 127.0.0.1 --port 18766`
  - Result: foreground run printed the 18766 dashboard URL, but the command was intentionally time-limited and left an inherited Python child process listening on 18766.
  - Cleanup: stopped the leftover Python process after confirming it was the 18766 listener.
- `python -m src.dashboard.app --host 127.0.0.1 --port <ephemeral>`
  - Result: passed; status API returned 5 researcher cards with ids `quality`, `fact_check`, `package_audit`, `memory_seed`, `learning_candidate`.
- `python -m src.dashboard.app --host 127.0.0.1 --port 18766`
  - Result: passed after cleanup; homepage HTTP 200 and status API returned 5 cards with values `PASS A 100`, `PASS 100`, `PASS`, `gbrain READY`, `READY`.
- `cmd /c netstat -ano | findstr LISTENING | findstr :18766`
  - Result: no listener after smoke cleanup.
- `git diff --check`
  - Result: passed. Caveat: this workspace reports the relevant files as untracked, so this only verifies tracked diff hygiene available to git.
- `python -m compileall src/dashboard/app.py`
  - Result: passed.
- `python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py`
  - Result: passed, 29 tests.
- `python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py`
  - Result after sandbox mode changed: failed because pytest could not create `C:\Users\Administrator\AppData\Local\Temp\pytest-of-Administrator` (`PermissionError: [WinError 5]`).
- `$env:TMP = E:\project\yixue-scale-engine\.tmp\pytest; $env:TEMP = E:\project\yixue-scale-engine\.tmp\pytest; python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py`
  - Result: passed, 29 tests.

## Unverified

- Full repository `make gate-quality` and `make verify PROFILE=default` were not run because `make` and bash are unavailable in this environment.
- A long-lived manual dashboard session on port 18766 was not left running; browser checks used temporary local servers and shut them down.
