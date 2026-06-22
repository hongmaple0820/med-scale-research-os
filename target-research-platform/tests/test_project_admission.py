from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.research_os import (
    LicenseScope,
    ProjectAdmissionError,
    ProjectAdmissionStore,
    ProjectDefinitionValidator,
    ReviewLedger,
    ReviewRequiredError,
    ReviewStage,
    ReviewStatus,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
)


def _registry() -> SourceRegistry:
    registry = SourceRegistry()
    registry.register(SourceDefinition(
        source_id="test-authority",
        name="Test Evidence Authority",
        authority="Test Authority",
        version="1",
        adapter_id="test-evidence-v1",
        base_urls=("https://evidence.example/records/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research", "public_export"),
        status=SourceStatus.APPROVED,
    ))
    registry.register(SourceDefinition(
        source_id="pending-authority",
        name="Pending Evidence Authority",
        authority="Pending",
        version="1",
        adapter_id="pending-v1",
        base_urls=("https://pending.example/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research",),
        status=SourceStatus.PENDING,
    ))
    registry.register(SourceDefinition(
        source_id="export-only-authority",
        name="Export-only Test Authority",
        authority="Test Authority",
        version="1",
        adapter_id="export-only-v1",
        base_urls=("https://export-only.example/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("public_export",),
        status=SourceStatus.APPROVED,
    ))
    return registry


def _valid_project() -> dict:
    return {
        "schema": "medscale.research_project.v1",
        "project_id": "project-alpha",
        "title": "Project Alpha",
        "research_question": "Does the case group differ from the defined control group?",
        "condition": {
            "system": "MONDO",
            "id": "0000001",
            "label": "Test condition",
        },
        "organism": {
            "system": "NCBITaxon",
            "id": "9606",
            "label": "Homo sapiens",
        },
        "tissue": {
            "system": "UBERON",
            "id": "0000001",
            "label": "Test tissue",
        },
        "omics_dimension": "transcriptomics",
        "case_definition": "Samples satisfying the explicit case inclusion criteria.",
        "control_definition": "Samples satisfying the explicit control inclusion criteria.",
        "minimum_case_samples": 5,
        "minimum_control_samples": 5,
        "positive_controls": [
            {
                "control_id": "control-1",
                "entity_type": "gene",
                "canonical_id": "TESTGENE:1",
                "label": "Test control gene",
                "expected_observation": "Detected with the project-defined direction.",
                "citations": [
                    {
                        "source_id": "test-authority",
                        "stable_record_id": "record-1",
                        "url": "https://evidence.example/records/record-1",
                    }
                ],
            }
        ],
    }


def test_template_placeholders_and_missing_fields_fail_closed(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    payload = json.loads(
        (root / "config" / "templates" / "research_project_v1.json").read_text(
            encoding="utf-8"
        )
    )

    issues = ProjectDefinitionValidator(_registry()).validate(payload)

    codes = {issue["code"] for issue in issues}
    assert "PLACEHOLDER_VALUE" in codes
    assert "INVALID_CANONICAL_ID" in codes
    assert "INVALID_EVIDENCE_URL" in codes


@pytest.mark.parametrize(
    ("mutation", "expected_code"),
    [
        (
            lambda payload: payload.update(
                control_definition=payload["case_definition"]
            ),
            "IDENTICAL_GROUP_DEFINITIONS",
        ),
        (
            lambda payload: payload.update(minimum_control_samples=4),
            "INSUFFICIENT_MINIMUM_SAMPLES",
        ),
        (
            lambda payload: payload.update(omics_dimension="metabolomics"),
            "UNSUPPORTED_OMICS_DIMENSION",
        ),
        (
            lambda payload: payload["organism"].update(id="10090"),
            "UNSUPPORTED_ORGANISM",
        ),
    ],
)
def test_invalid_project_boundaries_fail_closed(mutation, expected_code):
    payload = _valid_project()
    mutation(payload)

    issues = ProjectDefinitionValidator(_registry()).validate(payload)

    assert expected_code in {issue["code"] for issue in issues}


def test_unapproved_or_off_domain_control_evidence_fails_closed():
    pending = _valid_project()
    pending["positive_controls"][0]["citations"][0].update(
        source_id="pending-authority",
        url="https://pending.example/record-1",
    )
    off_domain = _valid_project()
    off_domain["positive_controls"][0]["citations"][0]["url"] = (
        "https://unapproved.example/record-1"
    )
    validator = ProjectDefinitionValidator(_registry())

    assert "UNAPPROVED_EVIDENCE_SOURCE" in {
        issue["code"] for issue in validator.validate(pending)
    }
    assert "INVALID_EVIDENCE_URL" in {
        issue["code"] for issue in validator.validate(off_domain)
    }


def test_evidence_source_without_research_permission_fails_closed():
    payload = _valid_project()
    payload["positive_controls"][0]["citations"][0].update(
        source_id="export-only-authority",
        url="https://export-only.example/record-1",
    )

    issues = ProjectDefinitionValidator(_registry()).validate(payload)

    assert "UNAPPROVED_EVIDENCE_SOURCE" in {
        issue["code"] for issue in issues
    }


def test_valid_project_is_canonicalized_without_inference():
    payload = _valid_project()

    validated = ProjectDefinitionValidator(_registry()).require_valid(payload)

    assert validated == payload
    assert validated["case_definition"] == payload["case_definition"]
    assert validated["positive_controls"][0]["expected_observation"] == (
        payload["positive_controls"][0]["expected_observation"]
    )


def test_project_submission_requires_human_approval_before_acquisition(
    tmp_path: Path,
):
    reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    store = ProjectAdmissionStore(
        tmp_path / "projects",
        registry=_registry(),
        reviews=reviews,
    )

    record = store.submit(_valid_project())

    assert Path(record.path).is_file()
    assert reviews.stage(record.record_id) is ReviewStage.ACQUISITION
    assert reviews.status(record.record_id) is ReviewStatus.REVIEW_REQUIRED
    with pytest.raises(ReviewRequiredError):
        store.require_ready_for_acquisition(record.record_id)

    reviews.approve(
        record.record_id,
        reviewer="human-user",
        note="Project definitions and controls reviewed.",
        signature="test:project-approved",
    )
    ready = store.require_ready_for_acquisition(record.record_id)
    assert ready.project_id == "project-alpha"


def test_project_tampering_is_detected_against_review_ledger(tmp_path: Path):
    reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    store = ProjectAdmissionStore(
        tmp_path / "projects",
        registry=_registry(),
        reviews=reviews,
    )
    record = store.submit(_valid_project())
    path = Path(record.path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["control_definition"] = payload["case_definition"]
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert store.verify(record.record_id) is False
    with pytest.raises(ProjectAdmissionError, match="integrity"):
        store.require_ready_for_acquisition(record.record_id)
