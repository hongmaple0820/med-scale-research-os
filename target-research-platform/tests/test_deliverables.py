import json
import inspect
import threading
from contextlib import contextmanager
from functools import partial
from http import HTTPStatus
from urllib.error import HTTPError
from urllib.parse import quote
from pathlib import Path
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

from src.dashboard import app as dashboard_app
from src.dashboard.app import DashboardHandler, DashboardState, build_content_disposition, serve_dashboard
from src.dashboard.deliverables import (
    build_comparison_report,
    build_report_bundle,
    list_researcher_deliverables,
    summarize_json_preview,
)
from src.dashboard.status_tracker import LiveStatusTracker, build_idle_status


@contextmanager
def _serve_dashboard_state(base_dir: Path):
    state = DashboardState(base_dir)
    handler = partial(DashboardHandler, dashboard_state=state)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def _read_json_url(url: str) -> dict:
    with urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def _request_url(url: str) -> tuple[int, dict[str, str], bytes]:
    try:
        with urlopen(url, timeout=5) as response:
            return response.status, dict(response.headers.items()), response.read()
    except HTTPError as exc:
        return exc.code, dict(exc.headers.items()), exc.read()


def _post_json_url(url: str, payload: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def _post_json_url_status(url: str, payload: dict) -> tuple[int, dict]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _write_model_usage(base_dir: Path, **overrides):
    usage_dir = base_dir / ".scale" / "model-usage"
    usage_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "id": "USAGE-medscale-test",
        "timestamp": "2026-06-15T10:00:00.000Z",
        "provider": "anthropic",
        "model": "claude-sonnet-4",
        "taskId": "literature-review-CDK4",
        "sessionId": "SESSION-medscale",
        "inputTokens": 1000,
        "outputTokens": 250,
        "cacheEligibleTokens": 700,
        "cacheCreationInputTokens": 300,
        "cacheReadInputTokens": 500,
        "cachedTokens": 0,
        "estimatedCostUsd": 0.12,
        "metadata": {"medical_lane": "literature", "target": "CDK4", "disease": "breast cancer"},
        "totalTokens": 1250,
        "cacheSavingsTokens": 500,
    }
    record.update(overrides)
    (usage_dir / "usage.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")


def _write_review_artifact(
    base_dir: Path,
    *,
    artifact_id: str,
    payload: dict,
    review_status: str = "review_required",
) -> Path:
    project_root = (
        base_dir
        / "output"
        / "terminology-literature"
        / "artifact-store"
        / "review-controls"
    )
    analysis_dir = project_root / "analysis"
    manifest_dir = project_root / "manifests"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    manifest_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = analysis_dir / f"{artifact_id}.json"
    artifact_path.write_text(json.dumps(payload), encoding="utf-8")
    manifest_path = manifest_dir / f"{artifact_id}.json"
    manifest_path.write_text(json.dumps({
        "schema": "medscale.artifact_manifest.v1",
        "artifact_id": artifact_id,
        "project_id": "review-controls",
        "layer": "analysis",
        "source_id": "nlm-mesh",
        "source_ids": ["nlm-mesh"],
        "stable_record_ids": payload.get("source_record_ids") or [],
        "retrieval": {},
        "license": {"scope": "public", "public_export_allowed": False},
        "sha256": "0" * 64,
        "size_bytes": artifact_path.stat().st_size,
        "media_type": "application/json",
        "producer": {"name": "test", "version": "1"},
        "parent_artifact_ids": [],
        "method_card_id": "test",
        "relative_path": f"analysis/{artifact_path.name}",
        "absolute_path": str(artifact_path),
        "manifest_path": str(manifest_path),
        "created_at": "2026-06-20T00:00:00+00:00",
        "review_status": review_status,
    }), encoding="utf-8")
    return artifact_path


def test_dashboard_copy_is_researcher_workbench():
    html = (Path(__file__).resolve().parents[1] / "src" / "dashboard" / "static" / "index.html").read_text(encoding="utf-8")

    assert "医学研究工作台" in html
    assert "研究者交付工作台" in html
    assert "运行完整研究流程" in html
    assert "Live Pipeline Monitor" not in html
    assert "Run Full Pipeline" not in html


def test_dashboard_frontend_preview_supports_inline_images():
    html = (Path(__file__).resolve().parents[1] / "src" / "dashboard" / "static" / "index.html").read_text(encoding="utf-8")

    assert '["png", "svg", "jpg", "jpeg", "gif", "webp"].includes(suffix)' in html
    assert 'preview-image-shell' in html
    assert '/api/download?inline=1&path=' in html


def test_dashboard_frontend_prefers_researcher_readiness_cards():
    html = (Path(__file__).resolve().parents[1] / "src" / "dashboard" / "static" / "index.html").read_text(encoding="utf-8")

    assert "readiness.researcher_cards" in html
    assert "researcherReadinessCard" in html
    assert "readiness-status" in html
    assert "next_action" in html
    assert "Memory review:" in html
    assert "review_status" in html
    assert "memoryReviewActions" in html
    assert "data-memory-review-action" in html
    assert "/api/memory-review" in html


def test_dashboard_frontend_exposes_medscale_research_os_panel():
    html = (Path(__file__).resolve().parents[1] / "src" / "dashboard" / "static" / "index.html").read_text(encoding="utf-8")

    assert "MedSCALE Research OS" in html
    assert "medicalResearchOs" in html
    assert "renderMedicalResearchOs" in html
    assert "medical_research_os" in html
    assert "Agent Loop Readiness" in html
    assert "runtime_readiness" in html
    assert "Runtime Doctor" in html
    assert "医学 Prompt Studio" in html
    assert "memory.review_status" in html
    assert "Token / Cost" in html
    assert "token_cost" in html
    assert "by_medical_lane" in html


def test_dashboard_frontend_exposes_genui_review_workbench():
    html = (Path(__file__).resolve().parents[1] / "src" / "dashboard" / "static" / "index.html").read_text(encoding="utf-8")

    assert "GenUI Review Workbench" in html
    assert "genuiReviewWorkbench" in html
    assert "renderGenuiReviewWorkbench" in html
    assert "genui_review_workbench" in html
    assert "data-genui-review-action" in html
    assert "renderGenuiControl" in html
    assert "/api/genui-review-action-draft" in html
    assert "submitGenuiReviewActionDraft" in html
    assert "persist: true" in html
    assert "draft_artifact_id" in html
    assert "/api/genui-review-action-confirmation" in html
    assert "submitGenuiReviewActionConfirmation" in html
    assert 'input.type === "checkbox"' in html


def test_dashboard_python_entry_defaults_to_medical_port():
    signature = inspect.signature(serve_dashboard)

    assert signature.parameters["host"].default == "127.0.0.1"
    assert signature.parameters["port"].default == 18766


def test_dashboard_idle_status_exposes_medscale_research_os(tmp_path: Path):
    status = DashboardState(tmp_path).load_status()
    med_os = status["summary"]["medical_research_os"]

    assert med_os["product"]["name"] == "MedSCALE Research OS"
    assert med_os["product"]["cn_name"] == "MedSCALE 医研操作系统"
    assert med_os["product"]["source_upgrade"] == "MedSCALE native workflow"
    assert med_os["operating_model"]["status"] == "insufficient-evidence"
    assert med_os["operating_model"]["readiness_score"] == 0
    assert med_os["memory_strategy"]["routing"] == "gbrain-only"
    assert len(med_os["loop_readiness"]["signals"]) == 6
    assert len(med_os["research_team"]["roles"]) == 6
    assert len(med_os["prompt_studio"]["templates"]) == 6
    assert med_os["token_cost"]["schema"] == "medscale.token_cost.v1"
    assert med_os["token_cost"]["status"] == "pending"
    assert med_os["token_cost"]["summary"]["total_records"] == 0
    assert any("独立 JSON" in item for item in med_os["next_migrations"])
    assert not any("SCALE 0.50" in item for item in med_os["next_migrations"])
    runtime = med_os["runtime_readiness"]
    assert runtime["schema"] == "medscale.runtime_readiness.v1"
    assert status["summary"]["medical_runtime_readiness"] == runtime
    assert {card["id"] for card in runtime["cards"]} == {
        "third_party_memory",
        "code_intelligence",
        "cli_runtime",
        "medical_skills",
        "mcp_surface",
        "token_cost",
        "medical_workflow",
    }
    assert status["summary"]["genui_review_workbench"]["schema"] == "medscale.genui_review_workbench.v1"
    assert status["summary"]["genui_review_workbench"]["card_count"] == 0
    assert med_os["genui_review_workbench"]["mode"] == "deterministic-local-renderer"


def test_dashboard_status_builds_genui_review_workbench_from_artifacts(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "status": "human_review_required",
            "selected_id": None,
            "candidates": [
                {
                    "descriptor_ui": "D008545",
                    "preferred_name": "Melanoma",
                    "tree_numbers": ["C04.1"],
                    "matched_as": "preferred_name",
                }
            ],
            "decision_fields": {
                "selected_id": None,
                "reviewer_rationale": None,
                "reject_all": None,
            },
            "automatic_selection_performed": False,
        },
    )
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-pubmed-worksheet",
        review_status="review_required",
        payload={
            "schema": "medscale.pubmed_evidence_worksheet.v1",
            "source_artifact_id": "msa-pubmed-raw",
            "source_record_ids": ["PMID:10952317"],
            "records": [
                {
                    "pmid": "10952317",
                    "doi": "10.1038/35020115",
                    "title": "Article title.",
                    "mesh_headings": [],
                    "publication_types": [],
                    "review_items": [
                        {
                            "locator": "pubmed:10952317:abstract:0",
                            "locator_text_sha256": "1" * 64,
                            "source_text_length": 123,
                            "claim_text": None,
                            "stance": None,
                            "evidence_assessment": {
                                "study_design": None,
                                "risk_of_bias": None,
                                "certainty": None,
                                "applicability": None,
                            },
                            "reviewer_notes": None,
                        }
                    ],
                }
            ],
            "claim_count": 0,
            "claims_created_automatically": False,
            "source_text_copied_into_worksheet": False,
        },
    )

    status = DashboardState(tmp_path).load_status()
    workbench = status["summary"]["genui_review_workbench"]
    cards = {card["id"]: card for card in workbench["cards"]}

    assert workbench["card_count"] == 2
    assert workbench["actionable_count"] == 2
    assert workbench["sdk_reference"]["vue_package"] == "@opentiny/genui-sdk-vue"
    assert status["summary"]["medical_research_os"]["genui_review_workbench"] == workbench
    assert cards["msa-mapping-request"]["state"] == "pass"
    assert cards["msa-mapping-request"]["controls"][0]["id"] == "selected_id"
    assert cards["msa-mapping-request"]["controls"][0]["enabled"] is True
    assert "query=melanoma" in cards["msa-mapping-request"]["details"]
    assert cards["msa-pubmed-worksheet"]["state"] == "pending"
    worksheet_controls = {control["id"]: control for control in cards["msa-pubmed-worksheet"]["controls"]}
    assert worksheet_controls["locator"]["options"][0]["value"] == "pubmed:10952317:abstract:0"
    assert worksheet_controls["claim_text"]["enabled"] is False
    assert "source_text_copied=False" in cards["msa-pubmed-worksheet"]["details"]


def test_dashboard_genui_action_draft_validates_mapping_selection(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "status": "human_review_required",
            "selected_id": None,
            "candidates": [
                {
                    "descriptor_ui": "D008545",
                    "preferred_name": "Melanoma",
                    "tree_numbers": ["C04.1"],
                    "matched_as": "preferred_name",
                }
            ],
            "decision_fields": {},
            "automatic_selection_performed": False,
        },
    )

    ok, draft, status = DashboardState(tmp_path).build_genui_review_action_draft({
        "artifact_id": "msa-mapping-request",
        "action": "select",
        "fields": {
            "selected_id": "D008545",
            "reviewer_rationale": "Reviewer confirmed the exact MeSH disease descriptor.",
        },
    })

    assert ok is True
    assert status == HTTPStatus.OK
    assert draft["schema"] == "medscale.genui_review_action_draft.v1"
    assert draft["dry_run"] is True
    assert draft["write_enabled"] is False
    assert draft["proposed_operation"]["entrypoint"] == "TerminologyMappingDecisionRecorder.select"
    assert draft["proposed_operation"]["payload"]["selected_id"] == "D008545"


def test_dashboard_genui_action_draft_can_persist_audit_artifact(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "status": "human_review_required",
            "selected_id": None,
            "candidates": [{"descriptor_ui": "D008545", "preferred_name": "Melanoma"}],
            "decision_fields": {},
            "automatic_selection_performed": False,
        },
    )

    state = DashboardState(tmp_path)
    ok, draft, status = state.build_genui_review_action_draft({
        "artifact_id": "msa-mapping-request",
        "action": "select",
        "persist": True,
        "fields": {
            "selected_id": "D008545",
            "reviewer_rationale": "Reviewer confirmed the exact MeSH disease descriptor.",
        },
    })

    assert ok is True
    assert status == HTTPStatus.OK
    assert draft["persisted"] is True
    assert draft["draft_artifact_id"].startswith("msa-genui-draft-")
    artifact_path = Path(draft["draft_artifact_path"])
    manifest_path = Path(draft["draft_manifest_path"])
    assert artifact_path.exists()
    assert manifest_path.exists()

    payload = json.loads(artifact_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert payload["schema"] == "medscale.genui_review_action_draft.v1"
    assert payload["dry_run"] is True
    assert payload["write_enabled"] is False
    assert payload["proposed_operation"]["entrypoint"] == "TerminologyMappingDecisionRecorder.select"
    assert manifest["schema"] == "medscale.artifact_manifest.v1"
    assert manifest["artifact_id"] == draft["draft_artifact_id"]
    assert manifest["review_status"] == "review_required"
    assert manifest["parent_artifact_ids"] == ["msa-mapping-request"]
    assert state.load_status()["summary"]["genui_review_workbench"]["card_count"] == 2


def test_dashboard_genui_action_draft_rejects_unapproved_worksheet(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-pubmed-worksheet",
        review_status="review_required",
        payload={
            "schema": "medscale.pubmed_evidence_worksheet.v1",
            "source_artifact_id": "msa-pubmed-raw",
            "source_record_ids": ["PMID:10952317"],
            "records": [
                {
                    "pmid": "10952317",
                    "review_items": [
                        {
                            "locator": "pubmed:10952317:abstract:0",
                            "locator_text_sha256": "1" * 64,
                            "evidence_assessment": {},
                        }
                    ],
                }
            ],
        },
    )

    ok, draft, status = DashboardState(tmp_path).build_genui_review_action_draft({
        "artifact_id": "msa-pubmed-worksheet",
        "action": "submit_claim",
        "fields": {
            "locator": "pubmed:10952317:abstract:0",
            "claim_text": "A human-authored claim.",
            "stance": "support",
            "evidence_assessment": {
                "study_design": "reviewed",
                "risk_of_bias": "reviewed",
                "certainty": "reviewed",
                "applicability": "reviewed",
            },
        },
    })

    assert ok is False
    assert status == HTTPStatus.CONFLICT
    assert draft["dry_run"] is True
    assert "approved" in draft["error"]


def test_dashboard_genui_action_draft_endpoint_returns_validation_status(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "candidates": [{"descriptor_ui": "D008545", "preferred_name": "Melanoma"}],
        },
    )

    with _serve_dashboard_state(tmp_path) as base_url:
        status, payload = _post_json_url_status(f"{base_url}/api/genui-review-action-draft", {
            "artifact_id": "msa-mapping-request",
            "action": "select",
            "fields": {
                "selected_id": "D000000",
                "reviewer_rationale": "Wrong candidate should fail.",
            },
        })

    assert status == HTTPStatus.CONFLICT
    assert payload["ok"] is False
    assert payload["artifact_id"] == "msa-mapping-request"
    assert "candidate snapshot" in payload["error"]


def test_dashboard_genui_action_draft_endpoint_can_persist(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "candidates": [{"descriptor_ui": "D008545", "preferred_name": "Melanoma"}],
        },
    )

    with _serve_dashboard_state(tmp_path) as base_url:
        status, payload = _post_json_url_status(f"{base_url}/api/genui-review-action-draft", {
            "artifact_id": "msa-mapping-request",
            "action": "select",
            "persist": True,
            "fields": {
                "selected_id": "D008545",
                "reviewer_rationale": "Reviewer confirmed the exact MeSH disease descriptor.",
            },
        })

    assert status == HTTPStatus.OK
    assert payload["ok"] is True
    assert payload["persisted"] is True
    assert Path(payload["draft_manifest_path"]).exists()


def test_dashboard_genui_action_confirmation_persists_envelope(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "candidates": [{"descriptor_ui": "D008545", "preferred_name": "Melanoma"}],
        },
    )
    state = DashboardState(tmp_path)
    ok, draft, status = state.build_genui_review_action_draft({
        "artifact_id": "msa-mapping-request",
        "action": "select",
        "persist": True,
        "fields": {
            "selected_id": "D008545",
            "reviewer_rationale": "Reviewer confirmed the exact MeSH disease descriptor.",
        },
    })
    assert ok is True
    assert status == HTTPStatus.OK

    ok, confirmation, status = state.build_genui_review_action_confirmation({
        "draft_artifact_id": draft["draft_artifact_id"],
        "fields": {
            "reviewer_id": "reviewer@example.test",
            "reviewer_role": "principal_investigator",
            "confirmation_rationale": "Ready for separate execution review.",
            "acknowledge_no_execution": True,
        },
    })

    assert ok is True
    assert status == HTTPStatus.OK
    assert confirmation["schema"] == "medscale.genui_review_action_confirmation.v1"
    assert confirmation["dry_run"] is True
    assert confirmation["write_enabled"] is False
    assert confirmation["persisted"] is True
    assert confirmation["confirmation_artifact_id"].startswith("msa-genui-confirm-")
    assert Path(confirmation["confirmation_artifact_path"]).exists()
    assert Path(confirmation["confirmation_manifest_path"]).exists()

    payload = json.loads(Path(confirmation["confirmation_artifact_path"]).read_text(encoding="utf-8"))
    manifest = json.loads(Path(confirmation["confirmation_manifest_path"]).read_text(encoding="utf-8"))
    assert payload["reviewer"]["id"] == "reviewer@example.test"
    assert payload["acknowledgements"]["no_execution_performed"] is True
    assert manifest["review_status"] == "review_required"
    assert draft["draft_artifact_id"] in manifest["parent_artifact_ids"]
    assert "msa-mapping-request" in manifest["parent_artifact_ids"]
    assert state.load_status()["summary"]["genui_review_workbench"]["card_count"] == 3


def test_dashboard_genui_action_confirmation_requires_acknowledgement(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "candidates": [{"descriptor_ui": "D008545", "preferred_name": "Melanoma"}],
        },
    )
    state = DashboardState(tmp_path)
    ok, draft, _status = state.build_genui_review_action_draft({
        "artifact_id": "msa-mapping-request",
        "action": "select",
        "persist": True,
        "fields": {
            "selected_id": "D008545",
            "reviewer_rationale": "Reviewer confirmed the exact MeSH disease descriptor.",
        },
    })
    assert ok is True

    ok, confirmation, status = state.build_genui_review_action_confirmation({
        "draft_artifact_id": draft["draft_artifact_id"],
        "fields": {
            "reviewer_id": "reviewer@example.test",
            "reviewer_role": "principal_investigator",
            "confirmation_rationale": "Ready for separate execution review.",
            "acknowledge_no_execution": False,
        },
    })

    assert ok is False
    assert status == HTTPStatus.BAD_REQUEST
    assert confirmation["persisted"] is False
    assert "acknowledge_no_execution" in confirmation["error"]


def test_dashboard_genui_action_confirmation_endpoint_persists(tmp_path: Path):
    _write_review_artifact(
        tmp_path,
        artifact_id="msa-mapping-request",
        review_status="approved",
        payload={
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": "msa-mesh-raw",
            "source_record_ids": ["MeSH:2026"],
            "requested_entity_domain": "disease",
            "query": "melanoma",
            "normalized_query": "melanoma",
            "candidates": [{"descriptor_ui": "D008545", "preferred_name": "Melanoma"}],
        },
    )
    state = DashboardState(tmp_path)
    ok, draft, _status = state.build_genui_review_action_draft({
        "artifact_id": "msa-mapping-request",
        "action": "select",
        "persist": True,
        "fields": {
            "selected_id": "D008545",
            "reviewer_rationale": "Reviewer confirmed the exact MeSH disease descriptor.",
        },
    })
    assert ok is True

    with _serve_dashboard_state(tmp_path) as base_url:
        status, payload = _post_json_url_status(f"{base_url}/api/genui-review-action-confirmation", {
            "draft_artifact_id": draft["draft_artifact_id"],
            "fields": {
                "reviewer_id": "reviewer@example.test",
                "reviewer_role": "principal_investigator",
                "confirmation_rationale": "Ready for separate execution review.",
                "acknowledge_no_execution": True,
            },
        })

    assert status == HTTPStatus.OK
    assert payload["ok"] is True
    assert payload["persisted"] is True
    assert payload["confirmation_artifact_id"].startswith("msa-genui-confirm-")
    assert Path(payload["confirmation_manifest_path"]).exists()


def test_dashboard_exposes_medscale_token_cost_panel(tmp_path: Path):
    _write_model_usage(tmp_path)

    state = DashboardState(tmp_path)
    status = state.load_status()
    med_os = status["summary"]["medical_research_os"]
    token_cost = med_os["token_cost"]
    token_card = next(card for card in med_os["runtime_readiness"]["cards"] if card["id"] == "token_cost")
    plan = state.build_medical_research_os_plan()

    assert token_cost["status"] == "ready"
    assert token_cost["summary"]["total_records"] == 1
    assert token_cost["summary"]["total_tokens"] == 1250
    assert token_cost["summary"]["cache_savings_tokens"] == 500
    assert token_cost["summary"]["estimated_cost_usd"] == 0.12
    assert token_cost["by_medical_lane"][0]["key"] == "literature"
    assert token_cost["by_medical_lane"][0]["label"] == "Literature review"
    assert token_card["state"] == "pass"
    assert token_card["status_label"] == "COST TRACKED"
    assert plan["token_cost"]["summary"]["total_tokens"] == 1250


def test_dashboard_learning_candidate_card_maps_memory_review_statuses(tmp_path: Path):
    state = DashboardState(tmp_path)
    base_candidate = {
        "candidate_id": "MLC-medical-review-state",
        "record_ready": True,
        "summary_ready": True,
        "recommended_action": "review-for-knowledge-base",
        "promotable": True,
        "brain_ingest_ok": True,
        "brain_node_id": "MEM-MLC-medical-review-state",
        "review_ready": True,
        "reviewer": "medical-reviewer",
    }
    cases = {
        "approved": ("pass", "APPROVED", "已批准"),
        "rejected": ("fail", "REJECTED", "已拒绝"),
        "stale": ("warning", "STALE", "证据过期"),
        "restored": ("warning", "RESTORED", "已恢复复审"),
    }

    for review_status, expected in cases.items():
        card = state._learning_candidate_researcher_card({
            **base_candidate,
            "review_status": review_status,
        })
        assert (card["state"], card["value"], card["status_label"]) == expected
        assert card["review_status"] == review_status
        assert "review=ready; status=" + review_status in card["details"]


def test_dashboard_memory_review_action_invokes_medscale_cli(tmp_path: Path, monkeypatch):
    (tmp_path / "src" / "api").mkdir(parents=True)
    (tmp_path / "src" / "api" / "medscale.ts").write_text("", encoding="utf-8")
    (tmp_path / "dist" / "api").mkdir(parents=True)
    (tmp_path / "dist" / "api" / "medscale.js").write_text("", encoding="utf-8")
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")
    captured: dict[str, object] = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["cwd"] = kwargs.get("cwd")
        return dashboard_app.subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps({
                "ok": True,
                "status": "approved",
                "candidateId": "MLC-medical-review-state",
                "nodeId": "MEM-MLC-medical-review-state",
                "nodeStatus": "active",
                "reviewPath": str(tmp_path / ".scale" / "memory" / "learning-candidates" / "MLC-medical-review-state.review.json"),
                "reviewMarkdownPath": str(tmp_path / ".scale" / "memory" / "learning-candidates" / "MLC-medical-review-state.review.md"),
                "promoted": True,
                "warnings": [],
            }),
            stderr="",
        )

    monkeypatch.setattr(dashboard_app.subprocess, "run", fake_run)

    ok, payload, status = DashboardState(tmp_path).review_memory_candidate({
        "action": "approve",
        "candidate_id": "MLC-medical-review-state",
        "reviewer": "18766-dashboard",
        "reason": "quality/fact/package evidence reviewed",
    })

    assert ok is True
    assert status == HTTPStatus.OK
    assert payload["status"] == "approved"
    assert payload["candidate_id"] == "MLC-medical-review-state"
    assert payload["node_status"] == "active"
    command = captured["command"]
    assert command[:3] == ["node", str(tmp_path / "dist" / "api" / "medscale.js"), "memory-review"]
    assert "--candidate-id" in command
    assert "MLC-medical-review-state" in command
    assert captured["cwd"] == str(tmp_path)


def test_dashboard_http_memory_review_endpoint(tmp_path: Path, monkeypatch):
    (tmp_path / "src" / "api").mkdir(parents=True)
    (tmp_path / "src" / "api" / "medscale.ts").write_text("", encoding="utf-8")
    (tmp_path / "dist" / "api").mkdir(parents=True)
    (tmp_path / "dist" / "api" / "medscale.js").write_text("", encoding="utf-8")
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")

    def fake_run(command, **kwargs):
        return dashboard_app.subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps({
                "ok": True,
                "status": "stale",
                "candidateId": "MLC-medical-review-state",
                "nodeStatus": "stale",
                "promoted": False,
                "warnings": [],
            }),
            stderr="",
        )

    monkeypatch.setattr(dashboard_app.subprocess, "run", fake_run)

    with _serve_dashboard_state(tmp_path) as base_url:
        payload = _post_json_url(f"{base_url}/api/memory-review", {
            "action": "stale",
            "candidate_id": "MLC-medical-review-state",
            "reason": "new evidence superseded this candidate",
        })

    assert payload["ok"] is True
    assert payload["action"] == "stale"
    assert payload["status"] == "stale"
    assert payload["node_status"] == "stale"


def test_medscale_runtime_readiness_reports_optional_third_party_gaps(tmp_path: Path, monkeypatch):
    scale_dir = tmp_path / ".scale"
    scale_dir.mkdir()
    (scale_dir / "memory-providers.json").write_text(json.dumps({
        "routing": {"mode": "external-first", "defaultOrder": ["gbrain", "scale-local"]},
        "providers": [
            {"id": "gbrain", "enabled": True, "writeMode": "disabled"},
            {"id": "scale-local", "enabled": True, "writeMode": "candidate-only"},
            {"id": "agentmemory", "enabled": False},
        ],
    }), encoding="utf-8")
    (scale_dir / "skills.json").write_text(json.dumps({
        "policy": {"mode": "warn"},
        "domains": {"ui": {}, "webResearch": {}},
    }), encoding="utf-8")
    (scale_dir / "code-intelligence.json").write_text(json.dumps({
        "providers": {"codegraph": {"enabled": True}, "graphify": {"enabled": True}},
    }), encoding="utf-8")
    mcp_dir = tmp_path / "mcp-configs"
    mcp_dir.mkdir()
    (mcp_dir / "memory").mkdir()
    (mcp_dir / "playwright").mkdir()
    (tmp_path / "graphify-out").mkdir()
    (tmp_path / "graphify-out" / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".codegraph").mkdir()
    (tmp_path / ".codegraph" / "codegraph.db").write_text("", encoding="utf-8")
    platform = tmp_path / "target-research-platform"
    (platform / "src" / "dashboard").mkdir(parents=True)
    (platform / "tests").mkdir()
    (platform / "main.py").write_text("print('ok')\n", encoding="utf-8")
    (platform / "requirements.txt").write_text("pytest\n", encoding="utf-8")
    (platform / "src" / "dashboard" / "app.py").write_text("", encoding="utf-8")

    def fake_which(command: str):
        if command in {"gbrain", "graphify", "python", "uv", "node"}:
            return f"C:/tools/{command}.exe"
        return None

    monkeypatch.setattr(dashboard_app.shutil, "which", fake_which)

    status = DashboardState(tmp_path).load_status()
    runtime = status["summary"]["medical_runtime_readiness"]
    cards = {card["id"]: card for card in runtime["cards"]}

    assert runtime["status"] == "degraded"
    assert cards["third_party_memory"]["state"] == "pass"
    assert cards["code_intelligence"]["state"] == "warning"
    assert cards["cli_runtime"]["state"] == "pass"
    assert cards["medical_skills"]["state"] == "warning"
    assert cards["mcp_surface"]["state"] == "warning"
    assert cards["token_cost"]["state"] == "warning"
    assert cards["token_cost"]["status_label"] == "COST PENDING"
    assert cards["medical_workflow"]["state"] == "pass"
    assert runtime["required_missing"] == []


def test_dashboard_serves_medscale_research_os_plan_endpoint(tmp_path: Path):
    with _serve_dashboard_state(tmp_path) as base_url:
        payload = _read_json_url(f"{base_url}/api/medical-research-os")

    assert payload["schema"] == "medscale.research_os.plan.v1"
    assert payload["product"]["name"] == "MedSCALE Research OS"
    assert payload["runtime_readiness"]["schema"] == "medscale.runtime_readiness.v1"
    assert payload["token_cost"]["schema"] == "medscale.token_cost.v1"
    assert payload["safety"]["read_only"] is True
    assert payload["prompt_studio"]["templates"][0]["copy_prompt"].startswith("# ")


def test_build_content_disposition_supports_utf8_filename():
    header = build_content_disposition("sankey_EGFR_肺癌.png", inline=True)

    assert header.startswith('inline; filename="sankey_EGFR_.png";')
    assert "filename*=UTF-8''sankey_EGFR_%E8%82%BA%E7%99%8C.png" in header


def test_live_status_tracker_preserves_existing_status_file(tmp_path: Path):
    status_file = tmp_path / "output" / "dashboard_runtime" / "live_status.json"
    status_file.parent.mkdir(parents=True)
    status_file.write_text(json.dumps({
        "run_id": "package-1",
        "status": "completed",
        "target": "CDK4",
        "disease": "breast cancer",
        "summary": {"quality_gate": {"passed": True}},
        "artifacts": {},
    }), encoding="utf-8")

    tracker = LiveStatusTracker(status_file)

    assert tracker.snapshot()["status"] == "completed"
    assert tracker.snapshot()["target"] == "CDK4"


def test_dashboard_status_attaches_delivery_readiness_from_manifest(tmp_path: Path):
    runtime = tmp_path / "output" / "dashboard_runtime"
    manuscript_dir = tmp_path / "output" / "manuscripts"
    runtime.mkdir(parents=True)
    manuscript_dir.mkdir(parents=True)
    manifest_path = manuscript_dir / "CDK4_breast_cancer_delivery_manifest.json"
    meta_path = manuscript_dir / "CDK4_breast_cancer_manuscript_meta.json"
    review_tasks_path = manuscript_dir / "CDK4_breast_cancer_review_tasks.json"
    memory_summary_path = manuscript_dir / "CDK4_breast_cancer_memory_summary.md"
    memory_seed_path = manuscript_dir / "CDK4_breast_cancer_memory_seed.json"
    learning_summary_path = manuscript_dir / "CDK4_breast_cancer_memory_learning_candidate.md"
    learning_record_path = manuscript_dir / "CDK4_breast_cancer_memory_learning_candidate.json"
    candidate_dir = tmp_path / ".scale" / "memory" / "learning-candidates"
    candidate_dir.mkdir(parents=True)
    candidate_path = candidate_dir / "MLC-medical-cdk4-breast-cancer.json"
    candidate_markdown_path = candidate_dir / "MLC-medical-cdk4-breast-cancer.md"
    review_path = candidate_dir / "MLC-medical-cdk4-breast-cancer.review.json"
    review_markdown_path = candidate_dir / "MLC-medical-cdk4-breast-cancer.review.md"

    meta_path.write_text(json.dumps({
        "literature_reviews": [
            {
                "index": 1,
                "pmid": "12345678",
                "title": "Example review",
                "study_design": "review",
                "evidence_level": "IV",
                "source": "agent_cache",
            }
        ]
    }), encoding="utf-8")
    review_tasks_path.write_text(json.dumps({
        "papers": [{"index": 1, "pmid": "12345678", "study_design": "review"}]
    }), encoding="utf-8")
    memory_summary_path.write_text("# Memory Summary", encoding="utf-8")
    learning_summary_path.write_text("# Learning Candidate", encoding="utf-8")
    candidate_path.write_text(json.dumps({
        "id": "MLC-medical-cdk4-breast-cancer",
        "title": "CDK4 breast cancer delivery learning",
        "summary": "Quality gate and fact check passed.",
        "recommendedAction": "review-for-knowledge-base",
        "promotable": True,
    }), encoding="utf-8")
    candidate_markdown_path.write_text("# Candidate", encoding="utf-8")
    review_path.write_text(json.dumps({
        "version": "1.0",
        "candidateId": "MLC-medical-cdk4-breast-cancer",
        "status": "approved",
        "createdAt": "2026-06-15T09:00:00.000Z",
        "updatedAt": "2026-06-15T09:10:00.000Z",
        "reviewer": "medical-reviewer",
        "reason": "quality and fact checks passed",
        "candidatePath": str(candidate_path),
        "reviewPath": str(review_path),
        "reviewMarkdownPath": str(review_markdown_path),
        "nodeId": "MEM-MLC-medical-cdk4-breast-cancer",
        "nodeStatus": "active",
        "previousNodeStatus": None,
        "promoted": True,
        "candidate": {
            "title": "CDK4 breast cancer delivery learning",
            "summary": "Quality gate and fact check passed.",
            "recommendedAction": "review-for-knowledge-base",
            "promotable": True,
            "artifactPaths": [],
        },
        "history": [],
        "warnings": [],
    }), encoding="utf-8")
    review_markdown_path.write_text("# Memory Review", encoding="utf-8")
    memory_seed_path.write_text(json.dumps({
        "generated_at": "2026-06-14T12:00:00",
        "provider": "gbrain",
        "summary_path": str(memory_summary_path),
        "source_files": [str(memory_summary_path), str(manifest_path)],
        "staged_files": [str(memory_summary_path), str(manifest_path)],
        "missing_roles": [],
        "warnings": [],
        "import_ok": True,
    }), encoding="utf-8")
    learning_record_path.write_text(json.dumps({
        "generated_at": "2026-06-14T12:05:00",
        "candidate_id": "MLC-medical-cdk4-breast-cancer",
        "candidate_path": str(candidate_path),
        "candidate_markdown_path": str(candidate_markdown_path),
        "summary_path": str(learning_summary_path),
        "recommended_action": "review-for-knowledge-base",
        "promotable": True,
        "brain_ingest_ok": True,
        "brain_node_id": "MEM-MLC-medical-cdk4-breast-cancer",
        "warnings": [],
    }), encoding="utf-8")

    manifest_path.write_text(json.dumps({
        "quality_gate": {"passed": True, "grade": "A", "score": 98, "errors": 0, "warnings": 1},
        "fact_check": {"passed": True, "score": 97, "errors": 0, "warnings": 0},
        "quality_findings": [
            {
                "id": "literature.enrichment_coverage",
                "severity": "warning",
                "message": "Literature metadata should include PubMed MeSH or citation enrichment.",
            }
        ],
        "human_review_todo": ["Re-run PubMed/OpenAlex enrichment before external review."],
        "literature": {
            "count": 12,
            "agent_cache_count": 12,
            "llm_count": 0,
            "rule_based_count": 0,
            "enrichment": {
                "sources": [],
                "mesh_count": 0,
                "citation_count_available": 0,
                "cache_used": False,
            },
        },
        "files": [
            {"role": "manuscript_meta", "path": str(meta_path)},
            {"role": "agent_review_tasks", "path": str(review_tasks_path)},
        ],
        "disclaimer": "Not submission-ready.",
    }), encoding="utf-8")
    (runtime / "live_status.json").write_text(json.dumps({
        "run_id": "package-1",
        "status": "completed",
        "target": "CDK4",
        "disease": "breast cancer",
        "summary": {},
        "artifacts": {
            "delivery_manifest": "output/manuscripts/CDK4_breast_cancer_delivery_manifest.json",
        },
    }), encoding="utf-8")

    status = DashboardState(tmp_path).load_status()
    readiness = status["summary"]["delivery_readiness"]

    assert status["summary"]["quality_gate"]["score"] == 98
    assert status["summary"]["fact_check"]["score"] == 97
    assert readiness["manifest_path"].endswith("CDK4_breast_cancer_delivery_manifest.json")
    assert readiness["quality_findings"][0]["id"] == "literature.enrichment_coverage"
    assert readiness["human_review_todo"] == ["Re-run PubMed/OpenAlex enrichment before external review."]
    assert readiness["literature_evidence"]["count"] == 12
    assert readiness["literature_evidence"]["agent_cache_count"] == 12
    assert readiness["review_examples"][0]["pmid"] == "12345678"
    assert readiness["review_examples"][0]["source"] == "agent_cache"
    assert readiness["review_files"]["task_path"].endswith("CDK4_breast_cancer_review_tasks.json")
    assert readiness["review_files"]["cache_path"] is None
    assert readiness["memory_seed"]["provider"] == "gbrain"
    assert readiness["memory_seed"]["record_ready"] is True
    assert readiness["memory_seed"]["summary_ready"] is True
    assert readiness["memory_seed"]["import_ok"] is True
    assert readiness["memory_seed"]["source_file_count"] == 2
    assert readiness["memory_seed"]["record_path"].endswith("CDK4_breast_cancer_memory_seed.json")
    assert readiness["memory_seed"]["summary_path"].endswith("CDK4_breast_cancer_memory_summary.md")
    assert readiness["learning_candidate"]["candidate_id"] == "MLC-medical-cdk4-breast-cancer"
    assert readiness["learning_candidate"]["promotable"] is True
    assert readiness["learning_candidate"]["brain_ingest_ok"] is True
    assert readiness["learning_candidate"]["brain_node_id"] == "MEM-MLC-medical-cdk4-breast-cancer"
    assert readiness["learning_candidate"]["record_path"].endswith("CDK4_breast_cancer_memory_learning_candidate.json")
    assert readiness["learning_candidate"]["summary_path"].endswith("CDK4_breast_cancer_memory_learning_candidate.md")
    assert readiness["learning_candidate"]["review_status"] == "approved"
    assert readiness["learning_candidate"]["review_ready"] is True
    assert readiness["learning_candidate"]["review_path"].endswith("MLC-medical-cdk4-breast-cancer.review.json")
    assert readiness["learning_candidate"]["review_markdown_path"].endswith("MLC-medical-cdk4-breast-cancer.review.md")
    assert readiness["learning_candidate"]["reviewer"] == "medical-reviewer"
    assert readiness["learning_candidate"]["review_node_status"] == "active"
    assert readiness["learning_candidate"]["promoted"] is True
    researcher_cards = {card["id"]: card for card in readiness["researcher_cards"]}
    assert set(researcher_cards) == {"quality", "fact_check", "package_audit", "memory_seed", "learning_candidate"}
    assert researcher_cards["quality"]["state"] == "warning"
    assert researcher_cards["quality"]["status_label"] == "通过但需复核"
    assert researcher_cards["quality"]["value"] == "PASS A 98"
    assert researcher_cards["fact_check"]["state"] == "pass"
    assert researcher_cards["fact_check"]["value"] == "PASS 97"
    assert researcher_cards["package_audit"]["state"] == "pending"
    assert researcher_cards["memory_seed"]["state"] == "pass"
    assert researcher_cards["learning_candidate"]["state"] == "pass"
    assert researcher_cards["learning_candidate"]["value"] == "APPROVED"
    assert researcher_cards["learning_candidate"]["review_status"] == "approved"
    assert "review=ready; status=approved" in researcher_cards["learning_candidate"]["details"]
    assert "recall" in researcher_cards["learning_candidate"]["next_action"]
    assert readiness["disclaimer"] == "Not submission-ready."
    med_os = status["summary"]["medical_research_os"]
    assert med_os["product"]["name"] == "MedSCALE Research OS"
    assert med_os["operating_model"]["mode"] == "review-escalated"
    assert med_os["operating_model"]["readiness_score"] >= 70
    assert med_os["loop_readiness"]["signals"][0]["id"] == "quality_gate"
    role_ids = {role["id"] for role in med_os["research_team"]["roles"]}
    assert {"literature_reviewer", "medical_fact_checker", "memory_curator"}.issubset(role_ids)
    gate_ids = {gate["id"] for gate in med_os["research_team"]["review_gates"]}
    assert {"quality_gate", "fact_check", "memory_seed", "learning_candidate"}.issubset(gate_ids)
    template_ids = {template["id"] for template in med_os["prompt_studio"]["templates"]}
    assert {"med-literature-review", "med-fact-check", "med-memory-learning"}.issubset(template_ids)
    assert med_os["memory_strategy"]["seed_state"] == "ready"
    assert med_os["memory_strategy"]["candidate_state"] == "approved"
    assert med_os["memory_strategy"]["review_status"] == "approved"
    assert med_os["memory_strategy"]["review_ready"] is True


def test_dashboard_http_status_and_artifacts_reflect_memory_delivery_state(tmp_path: Path):
    runtime = tmp_path / "output" / "dashboard_runtime"
    manuscript_dir = tmp_path / "output" / "manuscripts"
    deliveries_dir = tmp_path / "output" / "deliveries"
    runtime.mkdir(parents=True)
    manuscript_dir.mkdir(parents=True)
    deliveries_dir.mkdir(parents=True)

    manifest_path = manuscript_dir / "EGFR_lung_cancer_delivery_manifest.json"
    meta_path = manuscript_dir / "EGFR_lung_cancer_manuscript_meta.json"
    review_tasks_path = manuscript_dir / "EGFR_lung_cancer_review_tasks.json"
    memory_summary_path = manuscript_dir / "EGFR_lung_cancer_memory_summary.md"
    memory_seed_path = manuscript_dir / "EGFR_lung_cancer_memory_seed.json"
    learning_summary_path = manuscript_dir / "EGFR_lung_cancer_memory_learning_candidate.md"
    learning_record_path = manuscript_dir / "EGFR_lung_cancer_memory_learning_candidate.json"
    package_path = deliveries_dir / "EGFR_lung_cancer_delivery.zip"
    candidate_dir = tmp_path / ".scale" / "memory" / "learning-candidates"
    candidate_dir.mkdir(parents=True)
    candidate_path = candidate_dir / "MLC-medical-egfr-lung-cancer.json"
    candidate_markdown_path = candidate_dir / "MLC-medical-egfr-lung-cancer.md"
    review_path = candidate_dir / "MLC-medical-egfr-lung-cancer.review.json"
    review_markdown_path = candidate_dir / "MLC-medical-egfr-lung-cancer.review.md"

    meta_path.write_text(json.dumps({
        "literature_reviews": [
            {
                "index": 1,
                "pmid": "12345678",
                "title": "EGFR review",
                "study_design": "review",
                "evidence_level": "IV",
                "source": "agent_cache",
            }
        ]
    }), encoding="utf-8")
    review_tasks_path.write_text(json.dumps({
        "papers": [{"index": 1, "pmid": "12345678", "study_design": "review"}]
    }), encoding="utf-8")
    memory_summary_path.write_text("# Memory Summary", encoding="utf-8")
    learning_summary_path.write_text("# Learning Candidate", encoding="utf-8")
    candidate_path.write_text(json.dumps({
        "id": "MLC-medical-egfr-lung-cancer",
        "title": "EGFR lung cancer delivery learning",
        "summary": "Quality gate and fact check passed.",
        "recommendedAction": "review-for-knowledge-base",
        "promotable": True,
    }), encoding="utf-8")
    candidate_markdown_path.write_text("# Candidate", encoding="utf-8")
    review_path.write_text(json.dumps({
        "version": "1.0",
        "candidateId": "MLC-medical-egfr-lung-cancer",
        "status": "approved",
        "createdAt": "2026-06-15T10:00:00.000Z",
        "updatedAt": "2026-06-15T10:15:00.000Z",
        "reviewer": "medical-reviewer",
        "reason": "ready for long-term recall",
        "candidatePath": str(candidate_path),
        "reviewPath": str(review_path),
        "reviewMarkdownPath": str(review_markdown_path),
        "nodeId": "MEM-MLC-medical-egfr-lung-cancer",
        "nodeStatus": "active",
        "previousNodeStatus": None,
        "promoted": True,
        "candidate": {
            "title": "EGFR lung cancer delivery learning",
            "summary": "Quality gate and fact check passed.",
            "recommendedAction": "review-for-knowledge-base",
            "promotable": True,
            "artifactPaths": [],
        },
        "history": [],
        "warnings": [],
    }), encoding="utf-8")
    review_markdown_path.write_text("# Memory Review", encoding="utf-8")
    memory_seed_path.write_text(json.dumps({
        "generated_at": "2026-06-14T12:00:00",
        "provider": "gbrain",
        "summary_path": str(memory_summary_path),
        "source_files": [str(memory_summary_path), str(manifest_path)],
        "staged_files": [str(memory_summary_path), str(manifest_path)],
        "missing_roles": [],
        "warnings": [],
        "import_ok": True,
    }), encoding="utf-8")
    learning_record_path.write_text(json.dumps({
        "generated_at": "2026-06-14T12:05:00",
        "candidate_id": "MLC-medical-egfr-lung-cancer",
        "candidate_path": str(candidate_path),
        "candidate_markdown_path": str(candidate_markdown_path),
        "summary_path": str(learning_summary_path),
        "recommended_action": "review-for-knowledge-base",
        "promotable": True,
        "brain_ingest_ok": True,
        "brain_node_id": "MEM-MLC-medical-egfr-lung-cancer",
        "warnings": [],
    }), encoding="utf-8")
    package_path.write_bytes(b"zip")

    manifest_path.write_text(json.dumps({
        "quality_findings": [],
        "human_review_todo": ["Expert review required before submission."],
        "literature": {
            "count": 12,
            "agent_cache_count": 12,
            "llm_count": 0,
            "rule_based_count": 0,
            "enrichment": {
                "sources": ["pubmed_efetch", "openalex"],
                "mesh_count": 12,
                "citation_count_available": 12,
                "cache_used": True,
            },
        },
        "memory_seed": {
            "provider": "gbrain",
            "record_path": str(memory_seed_path),
            "summary_path": str(memory_summary_path),
        },
        "learning_candidate": {
            "candidate_id": "MLC-medical-egfr-lung-cancer",
            "record_path": str(learning_record_path),
            "summary_path": str(learning_summary_path),
            "recommended_action": "review-for-knowledge-base",
            "brain_ingest_ok": True,
        },
        "files": [
            {"role": "manuscript_meta", "path": str(meta_path)},
            {"role": "agent_review_tasks", "path": str(review_tasks_path)},
            {"role": "memory_seed_record", "path": str(memory_seed_path)},
            {"role": "memory_seed_summary", "path": str(memory_summary_path)},
            {"role": "learning_candidate_record", "path": str(learning_record_path)},
            {"role": "learning_candidate_summary", "path": str(learning_summary_path)},
        ],
        "disclaimer": "Not submission-ready.",
    }), encoding="utf-8")
    (runtime / "live_status.json").write_text(json.dumps({
        "run_id": "package-http-1",
        "status": "completed",
        "target": "EGFR",
        "disease": "lung cancer",
        "current_stage_label": "交付包已就绪",
        "summary": {
            "delivery_package": "output/deliveries/EGFR_lung_cancer_delivery.zip",
            "package_audit": {
                "passed": True,
                "entry_count": 12,
                "files_checked": 10,
                "markdown_refs_checked": 0,
                "image_refs_checked": 4,
                "readme_present": True,
                "manifest_present": True,
                "errors": 0,
                "warnings": 0,
                "broken_markdown_refs": [],
                "broken_image_refs": [],
            },
        },
        "artifacts": {
            "delivery_manifest": "output/manuscripts/EGFR_lung_cancer_delivery_manifest.json",
            "delivery_package": "output/deliveries/EGFR_lung_cancer_delivery.zip",
        },
    }), encoding="utf-8")

    with _serve_dashboard_state(tmp_path) as base_url:
        status_payload = _read_json_url(f"{base_url}/api/status")
        artifacts_payload = _read_json_url(f"{base_url}/api/artifacts")

    readiness = status_payload["summary"]["delivery_readiness"]
    assert readiness["memory_seed"]["provider"] == "gbrain"
    assert readiness["learning_candidate"]["candidate_id"] == "MLC-medical-egfr-lung-cancer"
    assert readiness["learning_candidate"]["brain_ingest_ok"] is True
    assert readiness["learning_candidate"]["review_status"] == "approved"
    assert readiness["learning_candidate"]["review_ready"] is True
    assert readiness["learning_candidate"]["review_path"].endswith("MLC-medical-egfr-lung-cancer.review.json")
    assert readiness["package_audit"]["passed"] is True
    researcher_cards = {card["id"]: card for card in readiness["researcher_cards"]}
    assert researcher_cards["package_audit"]["state"] == "pass"
    assert researcher_cards["package_audit"]["status_label"] == "ZIP 可交付"
    assert researcher_cards["memory_seed"]["value"] == "gbrain READY"
    assert researcher_cards["learning_candidate"]["value"] == "APPROVED"
    assert researcher_cards["learning_candidate"]["review_status"] == "approved"
    assert status_payload["summary"]["medical_research_os"]["memory_strategy"]["candidate_state"] == "approved"
    assert status_payload["summary"]["package_audit"]["image_refs_checked"] == 4

    deliverable_paths = {item["relative_path"] for item in artifacts_payload["deliverables"]}
    assert "manuscripts/EGFR_lung_cancer_memory_summary.md" in deliverable_paths
    assert "manuscripts/EGFR_lung_cancer_memory_seed.json" in deliverable_paths
    assert "manuscripts/EGFR_lung_cancer_memory_learning_candidate.md" in deliverable_paths
    assert "manuscripts/EGFR_lung_cancer_memory_learning_candidate.json" in deliverable_paths


def test_dashboard_http_artifact_and_download_serve_markdown_and_png(tmp_path: Path):
    runtime = tmp_path / "output" / "dashboard_runtime"
    manuscript_dir = tmp_path / "output" / "manuscripts"
    figures_dir = manuscript_dir / "figures"
    runtime.mkdir(parents=True)
    figures_dir.mkdir(parents=True)

    manuscript_path = manuscript_dir / "EGFR_lung_cancer_manuscript.md"
    figure_path = figures_dir / "figure1.png"
    figure_bytes = b"\x89PNG\r\n\x1a\n" + b"0" * 128
    figure_path.write_bytes(figure_bytes)
    manuscript_path.write_text(
        "# Manuscript\n\n![Figure](figures/figure1.png)\n",
        encoding="utf-8",
    )
    (runtime / "live_status.json").write_text(json.dumps({
        "run_id": "http-artifact-1",
        "status": "completed",
        "target": "EGFR",
        "disease": "lung cancer",
        "summary": {},
        "artifacts": {
            "manuscript_markdown": "output/manuscripts/EGFR_lung_cancer_manuscript.md",
        },
    }), encoding="utf-8")

    with _serve_dashboard_state(tmp_path) as base_url:
        artifact_status, artifact_headers, artifact_body = _request_url(
            f"{base_url}/api/artifact?path={quote(str(manuscript_path))}"
        )
        download_status, download_headers, download_body = _request_url(
            f"{base_url}/api/download?inline=1&path={quote(str(figure_path))}"
        )

    assert artifact_status == 200
    assert artifact_headers["Content-Type"].startswith("text/markdown")
    assert "![Figure](figures/figure1.png)" in artifact_body.decode("utf-8")
    assert download_status == 200
    assert download_headers["Content-Type"] == "image/png"
    assert download_headers["Content-Disposition"].startswith("inline;")
    assert download_body == figure_bytes


def test_dashboard_http_download_rejects_paths_outside_output(tmp_path: Path):
    runtime = tmp_path / "output" / "dashboard_runtime"
    runtime.mkdir(parents=True)
    secret_path = tmp_path / "secret.txt"
    secret_path.write_text("nope", encoding="utf-8")
    (runtime / "live_status.json").write_text(json.dumps({
        "run_id": "http-download-guard",
        "status": "completed",
        "target": "EGFR",
        "disease": "lung cancer",
        "summary": {},
        "artifacts": {},
    }), encoding="utf-8")

    with _serve_dashboard_state(tmp_path) as base_url:
        status, headers, body = _request_url(
            f"{base_url}/api/download?path={quote(str(secret_path))}"
        )

    payload = json.loads(body.decode("utf-8"))
    assert status == 403
    assert headers["Content-Type"].startswith("application/json")
    assert payload["error"] == "Path outside output directory"


def test_dashboard_status_infers_completed_stages_from_existing_outputs(tmp_path: Path):
    output = tmp_path / "output"
    runtime = output / "dashboard_runtime"
    manuscripts = output / "manuscripts"
    stage1 = output / "stage1"
    stage2 = output / "stage2"
    stage3 = output / "stage3"
    stage4 = output / "stage4"
    for path in (runtime, manuscripts, stage1, stage2, stage3, stage4):
        path.mkdir(parents=True, exist_ok=True)

    manifest_path = manuscripts / "CDK4_breast_cancer_delivery_manifest.json"
    manifest_path.write_text(json.dumps({
        "quality_findings": [],
        "human_review_todo": [],
        "literature": {"count": 0, "agent_cache_count": 0, "llm_count": 0, "rule_based_count": 0, "enrichment": {}},
        "disclaimer": "Review required.",
    }), encoding="utf-8")
    (stage1 / "CDK4_stage1_report.md").write_text("# Stage1", encoding="utf-8")
    (stage2 / "breast cancer_stage2_report.md").write_text("# Stage2", encoding="utf-8")
    (stage3 / "CDK4_breast cancer_stage3_report.md").write_text("# Stage3", encoding="utf-8")
    (stage4 / "CDK4_breast cancer_business_plan.md").write_text("# Stage4", encoding="utf-8")
    (stage1 / "CDK4_stage1_results.json").write_text(json.dumps({
        "summary": {"confidence_level": "high", "key_findings": ["Breast"], "data_sources": ["GTEx"]},
    }), encoding="utf-8")
    (stage2 / "breast cancer_stage2_results.json").write_text(json.dumps({
        "summary": {"top_candidates": [{"gene": "CDK4", "score": 0.72, "druggability_score": 0.53}]},
    }), encoding="utf-8")
    (stage3 / "CDK4_breast cancer_stage3_results.json").write_text(json.dumps({
        "stages": {"clinical_pipeline": {"data": {"summary": {"total_trials": 45, "active_trials": 12, "competition_intensity": "high"}}}},
    }), encoding="utf-8")
    (stage4 / "CDK4_breast cancer_stage4_results.json").write_text(json.dumps({
        "target": "CDK4",
        "disease": "breast cancer",
        "stages": {"milestones": {"data": {"overall_success_rate": 0.01, "total_duration_months": 168, "total_cost_estimate": 98.4}}},
    }), encoding="utf-8")
    (runtime / "live_status.json").write_text(json.dumps({
        "run_id": "package-1",
        "status": "completed",
        "target": "CDK4",
        "disease": "breast cancer",
        "current_stage_label": None,
        "summary": {},
        "artifacts": {
            "delivery_manifest": "output/manuscripts/CDK4_breast_cancer_delivery_manifest.json",
            "delivery_package": "output/deliveries/CDK4_breast_cancer_delivery.zip",
        },
        "stages": build_idle_status()["stages"],
    }), encoding="utf-8")

    status = DashboardState(tmp_path).load_status()

    assert status["current_stage_label"] == "交付包已就绪"
    assert all(status["stages"][stage]["status"] == "completed" for stage in ("stage1", "stage2", "stage3", "stage4"))
    assert status["stages"]["stage3"]["metrics"]["trial_count"] == 45
    assert status["stages"]["stage4"]["metrics"]["overall_success_rate"] == 0.01


def test_list_researcher_deliverables_filters_noise(tmp_path: Path):
    output = tmp_path / "output"
    (output / "stage4").mkdir(parents=True)
    (output / "stage1" / "provenance").mkdir(parents=True)
    (output / "stage4" / "CDK4_breast cancer_business_plan.md").write_text("# plan", encoding="utf-8")
    (output / "stage4" / "CDK4_breast cancer_stage4_results.json").write_text("{}", encoding="utf-8")
    (output / "stage1" / "provenance" / "CDK4_provenance.json").write_text("{}", encoding="utf-8")

    result = list_researcher_deliverables(output)
    titles = [item["title_zh"] for item in result["deliverables"]]
    paths = [item["relative_path"] for item in result["deliverables"]]
    assert "商业计划书" in titles
    assert all(item["title_zh"] != "数据溯源记录" for item in result["deliverables"])
    assert any(item["title_zh"] == "原始分析数据" for item in result["advanced"])


def test_build_comparison_report_from_stage4(tmp_path: Path):
    output = tmp_path / "output"
    stage4 = output / "stage4"
    stage4.mkdir(parents=True)
    stage4.joinpath("CDK4_breast cancer_stage4_results.json").write_text(
        """
        {
          "target": "CDK4",
          "disease": "breast cancer",
          "stages": {
            "milestones": {
              "data": {
                "overall_success_rate": 0.01,
                "total_duration_months": 168,
                "total_cost_estimate": 98.4,
                "stage_adjustments": {
                  "adjustment_details": {
                    "druggability_score": 0.527,
                    "competitive_landscape": {"has_approved_drugs": true, "competition_intensity": "high"}
                  }
                }
              }
            }
          }
        }
        """,
        encoding="utf-8",
    )

    report = build_comparison_report(output)
    assert report["available"] is True
    assert len(report["profiles"]) == 1
    assert "CDK4" in report["recommendation"]


def test_build_report_bundle_discovers_sections(tmp_path: Path):
    output = tmp_path / "output"
    (output / "stage1").mkdir(parents=True)
    (output / "stage4").mkdir(parents=True)
    (output / "stage1" / "CDK4_stage1_report.md").write_text("# Stage1", encoding="utf-8")
    (output / "stage4" / "CDK4_breast cancer_business_plan.md").write_text("# Plan", encoding="utf-8")
    (output / "stage4" / "CDK4_breast cancer_stage4_results.json").write_text(
        '{"stages":{"milestones":{"data":{"overall_success_rate":0.01,"total_duration_months":168,"total_cost_estimate":98.4,"stage_adjustments":{"adjustment_details":{"druggability_score":0.527,"competitive_landscape":{"has_approved_drugs":true,"competition_intensity":"high"}}}}}}}',
        encoding="utf-8",
    )

    bundle = build_report_bundle(output)
    assert bundle["available"] is True
    assert bundle["target"] == "CDK4"
    assert bundle["disease"] == "breast cancer"
    assert "期刊论文" in bundle["note"]
    available = [s for s in bundle["sections"] if s["path"]]
    assert len(available) >= 2
    assert bundle["summary_cards"]


def test_build_report_bundle_includes_manuscript_section(tmp_path: Path):
    output = tmp_path / "output"
    (output / "manuscripts").mkdir(parents=True)
    (output / "manuscripts" / "CDK4_breast cancer_manuscript.md").write_text(
        "# Manuscript", encoding="utf-8"
    )
    (output / "stage1").mkdir(parents=True)
    (output / "stage1" / "CDK4_stage1_report.md").write_text("# Stage1", encoding="utf-8")

    bundle = build_report_bundle(
        output, current_target="CDK4", current_disease="breast cancer"
    )
    manuscript = next(s for s in bundle["sections"] if s["id"] == "manuscript")
    assert manuscript["path"] is not None
    assert "期刊论文" in manuscript["title_zh"]
    assert "中文 IMRaD" in manuscript["subtitle_zh"]
    assert "英文正文" not in manuscript["subtitle_zh"]


def test_list_deliverables_includes_manuscript(tmp_path: Path):
    output = tmp_path / "output"
    (output / "manuscripts").mkdir(parents=True)
    (output / "deliveries").mkdir(parents=True)
    (output / "manuscripts" / "CDK4_breast cancer_manuscript.md").write_text("# ms", encoding="utf-8")
    (output / "manuscripts" / "CDK4_breast cancer_manuscript_quality.json").write_text(
        '{"passed": true}', encoding="utf-8"
    )
    (output / "manuscripts" / "CDK4_breast cancer_manuscript_fact_check.json").write_text(
        '{"passed": true}', encoding="utf-8"
    )
    (output / "manuscripts" / "CDK4_breast cancer_literature_evidence_pack.json").write_text(
        '{"pack_version": "1.0", "paper_count": 1}', encoding="utf-8"
    )
    (output / "manuscripts" / "CDK4_breast cancer_delivery_manifest.json").write_text(
        '{"files": []}', encoding="utf-8"
    )
    (output / "manuscripts" / "CDK4_breast cancer_memory_summary.md").write_text(
        "# memory summary", encoding="utf-8"
    )
    (output / "manuscripts" / "CDK4_breast cancer_memory_seed.json").write_text(
        '{"provider": "gbrain", "import_ok": true}', encoding="utf-8"
    )
    (output / "manuscripts" / "CDK4_breast cancer_memory_learning_candidate.md").write_text(
        "# learning candidate", encoding="utf-8"
    )
    (output / "manuscripts" / "CDK4_breast cancer_memory_learning_candidate.json").write_text(
        '{"candidate_id": "MLC-medical-cdk4-breast-cancer", "promotable": true}', encoding="utf-8"
    )
    (output / "deliveries" / "CDK4_breast cancer_delivery.zip").write_bytes(b"zip")

    result = list_researcher_deliverables(output, current_target="CDK4", current_disease="breast cancer")
    titles = [item["title_zh"] for item in result["deliverables"]]
    paths = [item["relative_path"] for item in result["deliverables"]]
    assert "期刊论文草稿（Markdown）" in titles
    assert "论文质量门禁报告" in titles
    assert "医学事实核查报告" in titles
    assert "文献证据富化包" in titles
    assert "交付清单与溯源索引" in titles
    assert "医学研究交付 ZIP 包" in titles
    assert "manuscripts/CDK4_breast cancer_memory_summary.md" in paths
    assert "manuscripts/CDK4_breast cancer_memory_seed.json" in paths
    assert "manuscripts/CDK4_breast cancer_memory_learning_candidate.md" in paths
    assert "manuscripts/CDK4_breast cancer_memory_learning_candidate.json" in paths


def test_summarize_json_preview_stage4(tmp_path: Path):
    payload = {
        "target": "CDK4",
        "disease": "breast cancer",
        "stages": {"milestones": {"data": {"overall_success_rate": 0.01, "total_duration_months": 168, "total_cost_estimate": 98.4}}},
    }
    rows = summarize_json_preview("CDK4_breast cancer_stage4_results.json", payload)
    labels = [r["label"] for r in rows]
    assert "整体成功率" in labels
    assert "成本估算" in labels
