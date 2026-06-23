"""
API 连通性集成测试
需要真实网络访问，默认跳过（标记 @pytest.mark.integration）

运行: python -m pytest tests/test_api_integration.py -v -m integration
"""
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.api_clients.gtex_client import GTExClient
from src.api_clients.tcga_client import TCGAClient
from src.api_clients.hpa_client import HPAClient
from src.api_clients.pubmed_client import PubMedClient
from src.api_clients.opentargets_client import OpenTargetsClient
from src.api_clients.geo_client import GEOClient
from src.api_clients.clinicaltrials_client import ClinicalTrialsClient


@pytest.mark.integration
class TestGTExConnectivity:
    """GTEx API 连通性"""

    def test_health_check(self):
        client = GTExClient()
        assert client.health_check() is True

    def test_egfr_expression(self):
        client = GTExClient()
        response = client.get_gene_expression("EGFR")
        assert response.success is True
        assert "tissues" in response.data
        assert len(response.data["tissues"]) >= 30

    def test_egfr_tpm_non_negative(self):
        client = GTExClient()
        response = client.get_gene_expression("EGFR")
        for tissue, tpm in response.data["tissues"].items():
            assert tpm >= 0, f"{tissue} TPM 为负: {tpm}"


@pytest.mark.integration
class TestTCGAConnectivity:
    """TCGA/GDC API 连通性"""

    def test_health_check(self):
        client = TCGAClient()
        assert client.health_check() is True

    def test_egfr_luad_expression(self):
        client = TCGAClient()
        response = client.get_gene_expression_by_project("EGFR", "TCGA-LUAD")
        assert response.success is True
        assert response.data["sample_count"] >= 50

    def test_egfr_luad_survival(self):
        client = TCGAClient()
        response = client.get_survival_data("EGFR", "TCGA-LUAD")
        assert response.success is True
        assert response.data["matched_count"] >= 50


@pytest.mark.integration
class TestHPAConnectivity:
    """HPA API 连通性"""

    def test_egfr_protein(self):
        client = HPAClient()
        response = client.get_protein_expression("ENSG00000146648")
        assert response.success is True


@pytest.mark.integration
class TestPubMedConnectivity:
    """PubMed API 连通性"""

    def test_health_check(self):
        client = PubMedClient()
        assert client.health_check() is True

    def test_egfr_literature(self):
        client = PubMedClient()
        response = client.search_gene_literature("EGFR", "lung cancer")
        assert response.success is True
        assert response.data["total_count"] > 0
        assert len(response.data["pmids"]) > 0


@pytest.mark.integration
class TestOpenTargetsConnectivity:
    """OpenTargets API 连通性"""

    def test_health_check(self):
        client = OpenTargetsClient()
        assert client.health_check() is True

    def test_egfr_druggability(self):
        client = OpenTargetsClient()
        response = client.get_target_druggability("ENSG00000146648")
        assert response.success is True
        assert response.data["gene_symbol"] == "EGFR"
        assert response.data["druggability"]["unique_drugs"] > 0


@pytest.mark.integration
class TestGEOConnectivity:
    """GEO API 连通性"""

    def test_health_check(self):
        client = GEOClient()
        assert client.health_check() is True

    def test_lung_cancer_datasets(self):
        client = GEOClient()
        response = client.find_differential_expression_datasets("lung cancer")
        assert response.success is True
        assert response.data["total_count"] > 0


@pytest.mark.integration
class TestClinicalTrialsConnectivity:
    """ClinicalTrials.gov API 连通性"""

    def test_egfr_trials(self):
        client = ClinicalTrialsClient()
        response = client.search_by_target("EGFR")
        assert response.success is True
        assert response.data["total_count"] > 10
