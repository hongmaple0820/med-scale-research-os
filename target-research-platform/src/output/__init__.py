"""Output helpers with lazy imports.

Importing lightweight submodules such as delivery_packager or manuscript_quality
should not eagerly load chart, report, and manuscript-generation dependencies.
The public package attributes remain available through __getattr__.
"""

from __future__ import annotations

from importlib import import_module
from typing import Any


_EXPORTS = {
    "ChartGenerator": (".chart_generator", "ChartGenerator"),
    "DataExporter": (".data_exporter", "DataExporter"),
    "ReportGenerator": (".report_generator", "ReportGenerator"),
    "EvidencePackage": (".evidence_package", "EvidencePackage"),
    "LiteratureReviewer": (".literature_reviewer", "LiteratureReviewer"),
    "review_literature_for_manuscript": (
        ".literature_reviewer",
        "review_literature_for_manuscript",
    ),
    "render_zhonghua_oncology": (".journal_templates", "render_zhonghua_oncology"),
    "ManuscriptGenerator": (".manuscript_generator", "ManuscriptGenerator"),
    "generate_manuscript_from_stages": (
        ".manuscript_generator",
        "generate_manuscript_from_stages",
    ),
}


__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attribute = _EXPORTS[name]
    value = getattr(import_module(module_name, __name__), attribute)
    globals()[name] = value
    return value
