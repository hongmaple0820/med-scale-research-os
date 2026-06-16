from __future__ import annotations

import argparse
from pathlib import Path

import main as pipeline_main


def main() -> None:
    tracker = pipeline_main.LiveStatusTracker(Path("./output/dashboard_runtime/live_status.json"))
    args = argparse.Namespace(
        target="CDK4",
        disease="breast cancer",
        cancers=["BRCA", "LUAD"],
        ensg=None,
        modality="small_molecule",
        risk_level="medium",
        output="./output",
        cache="./cache",
        json=False,
        _tracker=tracker,
        _run_id="real-cdk4-brca",
    )
    pipeline_main.run_full_pipeline(args)


if __name__ == "__main__":
    main()
