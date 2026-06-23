"""
API client unit tests.
"""

import gzip
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.api_clients.base_client import APIResponse
from src.api_clients.geo_client import GEOClient
from src.api_clients.gtex_client import GTExClient
from src.api_clients.hpa_client import HPAClient
from src.api_clients.immune_data_manager import ImmuneDataManager
from src.api_clients.openfda_client import OpenFDAClient
from src.api_clients.patentsview_client import PatentsViewClient
from src.api_clients.pubmed_client import PubMedClient
from src.api_clients.tcga_client import TCGAClient


class TestAPIResponse:
    def test_api_response_creation(self):
        response = APIResponse(
            success=True,
            data={"test": "data"},
            source="TestSource",
            endpoint="/test",
            params={"key": "value"},
            timestamp="2024-01-01T00:00:00",
        )

        assert response.success is True
        assert response.data == {"test": "data"}
        assert response.source == "TestSource"

    def test_api_response_provenance(self):
        response = APIResponse(
            success=True,
            data={},
            source="TestSource",
            endpoint="/test",
            params={"key": "value"},
            timestamp="2024-01-01T00:00:00",
        )

        provenance = response.get_provenance()
        assert provenance["source"] == "TestSource"
        assert provenance["endpoint"] == "/test"
        assert provenance["params"] == {"key": "value"}
        assert provenance["timestamp"] == "2024-01-01T00:00:00"
        assert "request_hash" in provenance

    def test_api_response_to_dict(self):
        response = APIResponse(
            success=True,
            data={"test": "data"},
            source="TestSource",
            endpoint="/test",
            params={},
            timestamp="2024-01-01T00:00:00",
        )

        payload = response.to_dict()
        assert payload["success"] is True
        assert payload["source"] == "TestSource"
        assert payload["data"] == {"test": "data"}


class TestOpenFDAClient:
    def test_parse_label_records_keeps_traceable_fields(self):
        client = OpenFDAClient()
        records = client._parse_label_records(
            {
                "results": [
                    {
                        "openfda": {
                            "application_number": ["NDA207103"],
                            "brand_name": ["IBRANCE"],
                            "generic_name": ["PALBOCICLIB"],
                            "manufacturer_name": ["Pfizer"],
                        },
                        "indications_and_usage": ["IBRANCE is indicated for breast cancer."],
                        "mechanism_of_action": ["Palbociclib is a CDK4/6 inhibitor."],
                    }
                ]
            }
        )

        assert records[0]["application_numbers"] == ["NDA207103"]
        assert records[0]["brand_names"] == ["IBRANCE"]
        assert records[0]["generic_names"] == ["PALBOCICLIB"]
        assert records[0]["manufacturers"] == ["Pfizer"]
        assert "accessdata.fda.gov" in records[0]["label_url"]


class TestPatentsViewClient:
    def test_missing_api_key_returns_traceable_failure(self, monkeypatch):
        monkeypatch.delenv("PATENTSVIEW_API_KEY", raising=False)
        monkeypatch.delenv("USPTO_API_KEY", raising=False)
        client = PatentsViewClient(api_key=None)

        response = client.search_patents("CDK4", "breast cancer")

        assert response.success is False
        assert response.error == "missing_patentsview_api_key"
        assert "PATENTSVIEW_API_KEY" in response.data["required_env"]


class TestGTExClient:
    def test_source_name(self):
        client = GTExClient()
        assert client.source_name == "GTEx"

    def test_base_url(self):
        client = GTExClient()
        assert "gtexportal.org" in client.base_url

    def test_validate_expression_valid(self):
        client = GTExClient()
        data = {"tissues": {f"tissue_{i}": float(i) for i in range(50)}}
        is_valid, issues = client.validate_expression(data)
        assert is_valid is True
        assert issues == []

    def test_validate_expression_insufficient_tissues(self):
        client = GTExClient()
        data = {"tissues": {f"tissue_{i}": float(i) for i in range(10)}}
        is_valid, issues = client.validate_expression(data)
        assert is_valid is False
        assert issues

    def test_validate_expression_negative_tpm(self):
        client = GTExClient()
        data = {"tissues": {"tissue_1": 10.0, "tissue_2": -5.0}}
        is_valid, issues = client.validate_expression(data)
        assert is_valid is False
        assert issues


class TestTCGAClient:
    def test_source_name(self):
        client = TCGAClient()
        assert client.source_name == "TCGA/GDC"

    def test_tcga_projects(self):
        assert TCGAClient.TCGA_PROJECTS["BRCA"] == "TCGA-BRCA"
        assert TCGAClient.TCGA_PROJECTS["LUAD"] == "TCGA-LUAD"

    def test_validate_expression_data_valid(self):
        client = TCGAClient()
        data = {
            "samples": [
                {"sample_id": f"sample_{i}", "expression_value": float(i)}
                for i in range(100)
            ]
        }
        is_valid, issues = client.validate_expression_data(data)
        assert is_valid is True
        assert issues == []

    def test_validate_expression_data_insufficient_samples(self):
        client = TCGAClient()
        data = {
            "samples": [
                {"sample_id": f"sample_{i}", "expression_value": float(i)}
                for i in range(10)
            ]
        }
        is_valid, issues = client.validate_expression_data(data)
        assert is_valid is False
        assert issues

    def test_get_clinical_survival_uses_get_first(self, monkeypatch):
        client = TCGAClient()
        calls = []

        def fake_make_request(method, endpoint, params=None, json_data=None, use_cache=True):
            calls.append((method, endpoint, params, json_data, use_cache))
            return APIResponse(
                success=True,
                data={"data": {"hits": []}},
                source="TCGA/GDC",
                endpoint=endpoint,
                params=params or {},
                timestamp="2024-01-01T00:00:00",
            )

        monkeypatch.setattr(client, "_make_request", fake_make_request)
        monkeypatch.setattr(client, "_parse_clinical_response", lambda response, project_id: response)

        response = client._get_clinical_survival("TCGA-LUAD")
        assert response.success is True
        assert calls[0][0] == "GET"
        assert calls[0][1] == "/cases"


class TestHPAClient:
    def test_source_name(self):
        client = HPAClient()
        assert client.source_name == "HPA"

    def test_parse_current_hpa_shape(self):
        client = HPAClient()
        response = APIResponse(
            success=True,
            data={
                "Gene": "EGFR",
                "Gene description": "Epidermal growth factor receptor",
                "Protein tissue specificity": "Low tissue specificity",
                "Protein tissue distribution": "Detected in all",
                "Protein tissue specific Intensity": {"lung": "12.5"},
                "Protein cell type specific Intensity": {"Keratinocytes": "22199260.0"},
                "Reliability (IH)": "Enhanced",
                "Reliability (IF)": "Supported",
                "Subcellular location": ["Golgi apparatus", "Plasma membrane"],
                "Antibody": ["HPA001200"],
            },
            source="HPA",
            endpoint="/ENSG00000146648.json",
            params={"ensg_id": "ENSG00000146648"},
            timestamp="2024-01-01T00:00:00",
        )

        parsed = client._parse_protein_data(response, "ENSG00000146648")
        assert parsed.success is True
        assert parsed.data["gene_name"] == "EGFR"
        assert parsed.data["tissue_expression"][0]["tissue"] == "lung"
        assert parsed.data["subcellular_location"][0]["location"] == "Golgi apparatus"

        is_valid, issues = client.validate_protein_data(parsed.data)
        assert is_valid is True
        assert issues == []


class TestGEOClient:
    def test_series_matrix_requires_real_rows(self, tmp_path):
        matrix_path = tmp_path / "GSE000001_series_matrix.txt.gz"
        with gzip.open(matrix_path, "wt", encoding="utf-8") as handle:
            handle.write("!series_matrix_table_begin\n")
            handle.write('"ID_REF"\t"GSM1"\t"GSM2"\n')
            handle.write("!series_matrix_table_end\n")

        assert GEOClient.series_matrix_has_expression_table(str(matrix_path)) is False

    def test_parse_processed_expression_file_uses_metadata_alignment(self, tmp_path):
        client = GEOClient(cache_dir=str(tmp_path / "cache"))
        metadata_path = tmp_path / "GSE318780_series_matrix.txt.gz"
        with gzip.open(metadata_path, "wt", encoding="utf-8") as handle:
            handle.write('!Series_platform_id\t"GPL24676"\n')
            handle.write('!Sample_title\t"T1_Tumour"\t"T2_Tumour"\t"S1_Adjacent"\t"S2_Adjacent"\n')
            handle.write('!Sample_geo_accession\t"GSM1"\t"GSM2"\t"GSM3"\t"GSM4"\n')
            handle.write('!Sample_source_name_ch1\t"tumour_tissue"\t"tumour_tissue"\t"tumour_tissue"\t"tumour_tissue"\n')
            handle.write('!Sample_characteristics_ch1\t"tissue type: Tumour"\t"tissue type: Tumour"\t"tissue type: Adjacent"\t"tissue type: Adjacent"\n')
            handle.write("!series_matrix_table_begin\n")
            handle.write('"ID_REF"\t"GSM1"\t"GSM2"\t"GSM3"\t"GSM4"\n')
            handle.write("!series_matrix_table_end\n")

        expr_path = tmp_path / "GSE318780_bcc92_log2RPKM_annot2.csv.gz"
        with gzip.open(expr_path, "wt", encoding="utf-8") as handle:
            handle.write(
                "Ensembl.id,Gene.name,Gene.description,Chromosome.scaffold.name,Gene.type,"
                "T1352,T1360,S1352,S1470\n"
            )
            handle.write(
                "ENSG00000135446,CDK4,cyclin dependent kinase 4,12,protein_coding,8.0,7.5,3.0,2.8\n"
            )
            handle.write(
                "ENSG00000146648,EGFR,epidermal growth factor receptor,7,protein_coding,6.2,6.1,2.2,2.1\n"
            )

        parsed = client.parse_series_matrix(
            str(expr_path),
            metadata_file=str(metadata_path),
        )
        assert parsed.success is True
        assert parsed.data["gene_count"] == 2
        assert parsed.data["sample_count"] == 4
        assert set(parsed.data["expression_matrix"].index) == {"CDK4", "EGFR"}

        groups = client.infer_sample_groups(parsed.data["sample_metadata"], "breast cancer")
        assert len(groups["disease"]) == 2
        assert len(groups["control"]) == 2
        assert groups["method"] == "metadata"

    def test_rank_datasets_prefers_clinical_adjacent_normal_cohort(self):
        client = GEOClient()
        ranked = client.rank_datasets(
            [
                {
                    "accession": "GSE_CELL_LINE",
                    "title": "CDK7 inhibition in T47D cell line",
                    "summary": "MCF7 cell line treated with inhibitor and siRNA perturbation",
                    "sample_count": 48,
                    "dataset_type": "Expression profiling by high throughput sequencing",
                    "pubmed_ids": [],
                },
                {
                    "accession": "GSE_CLINICAL",
                    "title": "Transcriptome analysis of breast tumour tissue and adjacent normal",
                    "summary": "Patient cohort with paired tumour tissue and matched normal samples",
                    "sample_count": 40,
                    "dataset_type": "Expression profiling by high throughput sequencing",
                    "pubmed_ids": [],
                },
            ],
            "breast cancer",
        )

        assert ranked[0]["accession"] == "GSE_CLINICAL"


class TestImmuneDataManager:
    def test_marker_fallback_estimates_aligned_samples(self, tmp_path):
        manager = ImmuneDataManager(cache_dir=str(tmp_path / "cache"), data_dir=str(tmp_path / "data"))
        samples = [f"TCGA-AB-{i:04d}-01A" for i in range(40)]

        def fake_expression(gene, project_id):
            payload = {
                "gene": gene,
                "project": project_id,
                "samples": [
                    {
                        "sample_id": sample_id,
                        "expression_value": float(index + len(gene)),
                    }
                    for index, sample_id in enumerate(samples)
                ],
                "sample_count": len(samples),
            }
            return APIResponse(
                success=True,
                data=payload,
                source="FireBrowse",
                endpoint="/Samples/mRNASeq",
                params={"gene": gene, "project": project_id},
                timestamp="2024-01-01T00:00:00",
            )

        manager.tcga_client.get_gene_expression_by_project = fake_expression

        response = manager.get_immune_infiltration("LUAD", source="tcga_marker")
        assert response.success is True
        assert len(response.data) == 40
        first_sample = response.data[samples[0]]
        assert set(first_sample.keys()) == set(ImmuneDataManager.IMMUNE_CELLS)
        assert abs(sum(first_sample.values()) - 1.0) < 1e-6


class TestPubMedClient:
    def test_source_name(self):
        client = PubMedClient()
        assert client.source_name == "PubMed"

    def test_base_url(self):
        client = PubMedClient()
        assert "ncbi.nlm.nih.gov" in client.base_url


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
