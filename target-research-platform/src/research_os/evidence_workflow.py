"""Human-review queue builders for terminology mappings and literature evidence."""
from __future__ import annotations

import json
from typing import Any

from .artifacts import ArtifactLayer, ArtifactManifest, ThreeLayerArtifactStore
from .governance import ReviewStage
from .literature import ClaimLedgerStore, ClaimRecord, PubMedRecordInspector
from .terminology import MeshDescriptorInspector


class TerminologyDecisionError(ValueError):
    """Raised when a human terminology decision is incomplete or inconsistent."""


class TerminologyMappingQueue:
    """Create an unselected terminology candidate artifact for human review."""

    METHOD_CARD_ID = "mesh-exact-candidate-resolution-v1"

    def __init__(self, inspector: MeshDescriptorInspector | None = None) -> None:
        self.inspector = inspector or MeshDescriptorInspector()

    def create_request(
        self,
        *,
        store: ThreeLayerArtifactStore,
        project_id: str,
        terminology_artifact_id: str,
        query: str,
        requested_entity_domain: str,
    ) -> ArtifactManifest:
        store.reviews.require_approved(terminology_artifact_id)
        if not store.verify(terminology_artifact_id):
            raise ValueError("Terminology artifact failed integrity verification.")
        source = store.get(terminology_artifact_id)
        if not any(
            record_id.startswith("MeSH:")
            for record_id in source.stable_record_ids
        ):
            raise ValueError("Terminology mapping requires an approved MeSH release.")
        resolution = self.inspector.resolve_candidates(
            store.read_bytes(terminology_artifact_id),
            query,
        )
        payload: dict[str, Any] = {
            "schema": "medscale.terminology_mapping_request.v1",
            "source_artifact_id": terminology_artifact_id,
            "source_record_ids": list(source.stable_record_ids),
            "requested_entity_domain": requested_entity_domain,
            "query": resolution["query"],
            "normalized_query": resolution["normalized_query"],
            "status": resolution["status"],
            "selected_id": None,
            "candidates": resolution["candidates"],
            "decision_fields": {
                "selected_id": None,
                "reviewer_rationale": None,
                "reject_all": None,
            },
            "automatic_selection_performed": False,
        }
        content = (
            json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
            + "\n"
        ).encode("utf-8")
        return store.derive(
            project_id=project_id,
            layer=ArtifactLayer.ANALYSIS,
            filename="terminology_mapping_request.json",
            content=content,
            parent_artifact_ids=(terminology_artifact_id,),
            producer={
                "name": "terminology-mapping-queue",
                "version": "1.0.0",
                "parameters": {
                    "match_mode": "exact-preferred-or-term",
                    "automatic_selection": False,
                },
            },
            method_card_id=self.METHOD_CARD_ID,
            media_type="application/json",
            review_stage=ReviewStage.NORMALIZATION,
        )


class TerminologyMappingDecisionRecorder:
    """Persist human terminology decisions without inferring the canonical ID."""

    METHOD_CARD_ID = "mesh-human-mapping-decision-v1"

    @staticmethod
    def _load_request(
        *,
        store: ThreeLayerArtifactStore,
        mapping_request_artifact_id: str,
    ) -> tuple[ArtifactManifest, dict[str, Any]]:
        if not store.verify(mapping_request_artifact_id):
            raise TerminologyDecisionError(
                "Terminology mapping request failed integrity verification."
            )
        manifest = store.get(mapping_request_artifact_id)
        payload = json.loads(store.read_bytes(mapping_request_artifact_id))
        if payload.get("schema") != "medscale.terminology_mapping_request.v1":
            raise TerminologyDecisionError(
                "Artifact is not a terminology mapping request."
            )
        return manifest, payload

    @staticmethod
    def _candidate_by_id(
        payload: dict[str, Any],
        selected_id: str,
    ) -> dict[str, Any]:
        for candidate in payload.get("candidates") or []:
            if candidate.get("descriptor_ui") == selected_id:
                return dict(candidate)
        raise TerminologyDecisionError(
            "Selected terminology ID is not present in the reviewed candidate set."
        )

    @staticmethod
    def _require_rationale(reviewer_rationale: str) -> str:
        rationale = reviewer_rationale.strip()
        if not rationale:
            raise TerminologyDecisionError(
                "Reviewer rationale is required for terminology decisions."
            )
        return rationale

    def select(
        self,
        *,
        store: ThreeLayerArtifactStore,
        project_id: str,
        mapping_request_artifact_id: str,
        selected_id: str,
        reviewer_rationale: str,
    ) -> ArtifactManifest:
        """Record a human-selected candidate and require a separate approval."""

        _, request = self._load_request(
            store=store,
            mapping_request_artifact_id=mapping_request_artifact_id,
        )
        candidate = self._candidate_by_id(request, selected_id)
        payload = {
            "schema": "medscale.terminology_mapping_decision.v1",
            "mapping_request_artifact_id": mapping_request_artifact_id,
            "source_artifact_id": request["source_artifact_id"],
            "source_record_ids": list(request["source_record_ids"]),
            "requested_entity_domain": request["requested_entity_domain"],
            "query": request["query"],
            "normalized_query": request["normalized_query"],
            "decision": {
                "status": "selected",
                "selected_id": selected_id,
                "selected_candidate": candidate,
                "reject_all": False,
                "reviewer_rationale": self._require_rationale(
                    reviewer_rationale
                ),
            },
            "candidate_count": len(request.get("candidates") or []),
            "candidate_snapshot": request.get("candidates") or [],
            "automatic_selection_performed": False,
        }
        return self._write_decision(
            store=store,
            project_id=project_id,
            mapping_request_artifact_id=mapping_request_artifact_id,
            payload=payload,
        )

    def reject_all(
        self,
        *,
        store: ThreeLayerArtifactStore,
        project_id: str,
        mapping_request_artifact_id: str,
        reviewer_rationale: str,
    ) -> ArtifactManifest:
        """Record that no candidate should be used as the canonical mapping."""

        _, request = self._load_request(
            store=store,
            mapping_request_artifact_id=mapping_request_artifact_id,
        )
        payload = {
            "schema": "medscale.terminology_mapping_decision.v1",
            "mapping_request_artifact_id": mapping_request_artifact_id,
            "source_artifact_id": request["source_artifact_id"],
            "source_record_ids": list(request["source_record_ids"]),
            "requested_entity_domain": request["requested_entity_domain"],
            "query": request["query"],
            "normalized_query": request["normalized_query"],
            "decision": {
                "status": "rejected",
                "selected_id": None,
                "selected_candidate": None,
                "reject_all": True,
                "reviewer_rationale": self._require_rationale(
                    reviewer_rationale
                ),
            },
            "candidate_count": len(request.get("candidates") or []),
            "candidate_snapshot": request.get("candidates") or [],
            "automatic_selection_performed": False,
        }
        return self._write_decision(
            store=store,
            project_id=project_id,
            mapping_request_artifact_id=mapping_request_artifact_id,
            payload=payload,
        )

    def _write_decision(
        self,
        *,
        store: ThreeLayerArtifactStore,
        project_id: str,
        mapping_request_artifact_id: str,
        payload: dict[str, Any],
    ) -> ArtifactManifest:
        content = (
            json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
            + "\n"
        ).encode("utf-8")
        return store.derive(
            project_id=project_id,
            layer=ArtifactLayer.ANALYSIS,
            filename="terminology_mapping_decision.json",
            content=content,
            parent_artifact_ids=(mapping_request_artifact_id,),
            producer={
                "name": "terminology-mapping-decision-recorder",
                "version": "1.0.0",
                "parameters": {
                    "automatic_selection": False,
                    "requires_candidate_snapshot": True,
                },
            },
            method_card_id=self.METHOD_CARD_ID,
            media_type="application/json",
            review_stage=ReviewStage.NORMALIZATION,
        )

    def require_approved_selection(
        self,
        *,
        store: ThreeLayerArtifactStore,
        decision_artifact_id: str,
    ) -> dict[str, Any]:
        """Return a selected mapping only after integrity and approval pass."""

        store.reviews.require_approved(decision_artifact_id)
        if not store.verify(decision_artifact_id):
            raise TerminologyDecisionError(
                "Terminology mapping decision failed integrity verification."
            )
        payload = json.loads(store.read_bytes(decision_artifact_id))
        if payload.get("schema") != "medscale.terminology_mapping_decision.v1":
            raise TerminologyDecisionError(
                "Artifact is not a terminology mapping decision."
            )
        if payload.get("decision", {}).get("status") != "selected":
            raise TerminologyDecisionError(
                "Terminology mapping decision did not select a canonical ID."
            )
        return payload


class PubMedEvidenceWorksheetBuilder:
    """Build an empty human evidence worksheet from approved PubMed XML."""

    METHOD_CARD_ID = "pubmed-evidence-worksheet-v1"

    def __init__(self, inspector: PubMedRecordInspector | None = None) -> None:
        self.inspector = inspector or PubMedRecordInspector()

    def create(
        self,
        *,
        store: ThreeLayerArtifactStore,
        project_id: str,
        pubmed_artifact_id: str,
    ) -> ArtifactManifest:
        store.reviews.require_approved(pubmed_artifact_id)
        if not store.verify(pubmed_artifact_id):
            raise ValueError("PubMed artifact failed integrity verification.")
        source = store.get(pubmed_artifact_id)
        pmids = tuple(
            record_id.split(":", 1)[1]
            for record_id in source.stable_record_ids
            if record_id.startswith("PMID:")
        )
        if not pmids:
            raise ValueError("Evidence worksheet requires PMID stable record IDs.")
        profile = self.inspector.inspect(
            store.read_bytes(pubmed_artifact_id),
            expected_pmids=pmids,
        )
        records = []
        for record in profile["records"]:
            review_items = []
            for section in record["abstract_sections"]:
                review_items.append({
                    "locator": section["locator"],
                    "locator_text_sha256": section["text_sha256"],
                    "source_text_length": section["text_length"],
                    "claim_text": None,
                    "stance": None,
                    "evidence_assessment": {
                        "study_design": None,
                        "risk_of_bias": None,
                        "certainty": None,
                        "applicability": None,
                    },
                    "reviewer_notes": None,
                })
            records.append({
                "pmid": record["pmid"],
                "doi": record["doi"],
                "title": record["title"],
                "mesh_headings": record["mesh_headings"],
                "publication_types": record["publication_types"],
                "review_items": review_items,
            })
        payload = {
            "schema": "medscale.pubmed_evidence_worksheet.v1",
            "source_artifact_id": pubmed_artifact_id,
            "source_record_ids": list(source.stable_record_ids),
            "records": records,
            "claim_count": 0,
            "claims_created_automatically": False,
            "source_text_copied_into_worksheet": False,
            "instructions": [
                "Open the approved local PubMed raw artifact to inspect source text.",
                "Write claim text manually and bind it to one exact locator.",
                "Assess study design, risk of bias, certainty, and applicability separately.",
                "Do not enter numeric pseudo-GRADE or journal-impact scores.",
            ],
        }
        content = (
            json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
            + "\n"
        ).encode("utf-8")
        return store.derive(
            project_id=project_id,
            layer=ArtifactLayer.ANALYSIS,
            filename="pubmed_evidence_worksheet.json",
            content=content,
            parent_artifact_ids=(pubmed_artifact_id,),
            producer={
                "name": "pubmed-evidence-worksheet-builder",
                "version": "1.0.0",
                "parameters": {
                    "copies_source_text": False,
                    "creates_claims": False,
                },
            },
            method_card_id=self.METHOD_CARD_ID,
            media_type="application/json",
            review_stage=ReviewStage.INTELLIGENCE,
        )


class PubMedWorksheetClaimSubmitter:
    """Submit human-authored claims through an approved worksheet locator."""

    @staticmethod
    def _load_worksheet(
        *,
        store: ThreeLayerArtifactStore,
        worksheet_artifact_id: str,
    ) -> dict[str, Any]:
        store.reviews.require_approved(worksheet_artifact_id)
        if not store.verify(worksheet_artifact_id):
            raise ValueError("Evidence worksheet failed integrity verification.")
        payload = json.loads(store.read_bytes(worksheet_artifact_id))
        if payload.get("schema") != "medscale.pubmed_evidence_worksheet.v1":
            raise ValueError("Artifact is not a PubMed evidence worksheet.")
        return payload

    @staticmethod
    def _review_item(
        worksheet: dict[str, Any],
        *,
        pmid: str,
        locator: str,
    ) -> dict[str, Any]:
        for record in worksheet.get("records") or []:
            if record.get("pmid") != pmid:
                continue
            for item in record.get("review_items") or []:
                if item.get("locator") == locator:
                    return dict(item)
        raise ValueError("Worksheet locator was not found.")

    def submit_claim(
        self,
        *,
        store: ThreeLayerArtifactStore,
        claims: ClaimLedgerStore,
        worksheet_artifact_id: str,
        pmid: str,
        locator: str,
        claim_text: str,
        stance: str,
        evidence_assessment: dict[str, Any],
    ) -> ClaimRecord:
        """Create a claim bound to a worksheet locator and raw PubMed source."""

        worksheet = self._load_worksheet(
            store=store,
            worksheet_artifact_id=worksheet_artifact_id,
        )
        item = self._review_item(worksheet, pmid=pmid, locator=locator)
        return claims.submit(
            claim_text=claim_text,
            stance=stance,
            source_artifact_id=worksheet["source_artifact_id"],
            source_record_id=f"PMID:{pmid}",
            locator=locator,
            locator_text_sha256=item["locator_text_sha256"],
            evidence_assessment=evidence_assessment,
        )
