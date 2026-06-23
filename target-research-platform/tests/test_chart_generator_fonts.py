from __future__ import annotations

import warnings
from pathlib import Path

import pytest

from src.output.chart_generator import CHART_FONT_FAMILY, ChartGenerator


def test_chart_generator_uses_cjk_font_without_glyph_warnings(tmp_path: Path):
    if not CHART_FONT_FAMILY:
        pytest.skip("No CJK-capable font is available in this environment")

    generator = ChartGenerator(str(tmp_path))

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        paths = generator.tumor_expression_distribution(
            [10, 20, 30, 40],
            gene_symbol="CDK4",
            cancer_type="BRCA",
        )

    assert Path(paths["png"]).exists()
    glyph_warnings = [
        warning
        for warning in caught
        if "Glyph" in str(warning.message) and "missing from font" in str(warning.message)
    ]
    assert glyph_warnings == []
