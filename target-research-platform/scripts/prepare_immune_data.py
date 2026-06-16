#!/usr/bin/env python3
"""
免疫浸润数据准备脚本

用途：
1. 生成示例免疫浸润数据（基于 TCGA 发表的典型分布）
2. 用于开发/测试阶段，验证 pipeline 功能完整性

生产环境请使用真实数据：
- TIMER2.0: http://timer.comp-genomics.org/
- TCIA: https://tcia.at/
- CIBERSORT: https://cibersortx.stanford.edu/
- Pan-Cancer Atlas: https://gdc.cancer.gov/about-data/publications/panimmuneatlas

用法:
  python scripts/prepare_immune_data.py          # 生成示例数据
  python scripts/prepare_immune_data.py --check   # 检查数据状态

生成的 CSV 格式:
  sample_id,B_cell,CD4_T_cell,CD8_T_cell,Neutrophil,Macrophage,
  Dendritic_cell,NK_cell,Monocyte,Mast_cell,Eosinophil
"""
import argparse
import csv
import os
import sys
from pathlib import Path

import numpy as np

# 添加 src 到路径
sys.path.insert(0, str(Path(__file__).parent.parent))


# TCGA 各癌型典型免疫浸润比例 (基于 published pan-cancer immune atlas)
# 格式: {cancer: {cell_type: (mean, std)}}
# 数值参考: Thorsson et al., Immunity 2018; Saltz et al., Cancer Cell 2018
IMMUNE_PROFILES = {
    "LUAD": {
        "B_cell": (0.08, 0.04), "CD4_T_cell": (0.15, 0.06),
        "CD8_T_cell": (0.12, 0.05), "Neutrophil": (0.06, 0.03),
        "Macrophage": (0.18, 0.07), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "BRCA": {
        "B_cell": (0.10, 0.05), "CD4_T_cell": (0.18, 0.07),
        "CD8_T_cell": (0.10, 0.04), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.15, 0.06), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.03, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.03, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "COAD": {
        "B_cell": (0.06, 0.03), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.14, 0.06), "Neutrophil": (0.08, 0.04),
        "Macrophage": (0.20, 0.08), "Dendritic_cell": (0.06, 0.03),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.07, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.02, 0.01)
    },
    "LUSC": {
        "B_cell": (0.07, 0.03), "CD4_T_cell": (0.14, 0.05),
        "CD8_T_cell": (0.11, 0.05), "Neutrophil": (0.07, 0.03),
        "Macrophage": (0.19, 0.07), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "PRAD": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.10, 0.04),
        "CD8_T_cell": (0.08, 0.03), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.12, 0.05), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.03, 0.01), "Monocyte": (0.04, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "STAD": {
        "B_cell": (0.06, 0.03), "CD4_T_cell": (0.13, 0.05),
        "CD8_T_cell": (0.15, 0.06), "Neutrophil": (0.07, 0.03),
        "Macrophage": (0.17, 0.06), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "HNSC": {
        "B_cell": (0.07, 0.03), "CD4_T_cell": (0.14, 0.06),
        "CD8_T_cell": (0.13, 0.05), "Neutrophil": (0.06, 0.03),
        "Macrophage": (0.16, 0.06), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "KIRC": {
        "B_cell": (0.09, 0.04), "CD4_T_cell": (0.16, 0.06),
        "CD8_T_cell": (0.14, 0.06), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.14, 0.05), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.06, 0.03), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "LIHC": {
        "B_cell": (0.06, 0.03), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.12, 0.05), "Neutrophil": (0.06, 0.03),
        "Macrophage": (0.18, 0.07), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.06, 0.03), "Monocyte": (0.07, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "THCA": {
        "B_cell": (0.08, 0.04), "CD4_T_cell": (0.14, 0.05),
        "CD8_T_cell": (0.08, 0.03), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.12, 0.05), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.03, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "OV": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.10, 0.04), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.20, 0.08), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "GBM": {
        "B_cell": (0.03, 0.01), "CD4_T_cell": (0.08, 0.03),
        "CD8_T_cell": (0.06, 0.02), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.25, 0.10), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.02, 0.01), "Monocyte": (0.08, 0.03),
        "Mast_cell": (0.01, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "SKCM": {
        "B_cell": (0.08, 0.04), "CD4_T_cell": (0.16, 0.06),
        "CD8_T_cell": (0.18, 0.07), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.14, 0.05), "Dendritic_cell": (0.06, 0.03),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "BLCA": {
        "B_cell": (0.07, 0.03), "CD4_T_cell": (0.14, 0.05),
        "CD8_T_cell": (0.13, 0.05), "Neutrophil": (0.06, 0.03),
        "Macrophage": (0.16, 0.06), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "PAAD": {
        "B_cell": (0.04, 0.02), "CD4_T_cell": (0.10, 0.04),
        "CD8_T_cell": (0.08, 0.03), "Neutrophil": (0.08, 0.04),
        "Macrophage": (0.22, 0.08), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.03, 0.01), "Monocyte": (0.07, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "CESC": {
        "B_cell": (0.07, 0.03), "CD4_T_cell": (0.15, 0.06),
        "CD8_T_cell": (0.12, 0.05), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.15, 0.06), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "READ": {
        "B_cell": (0.06, 0.03), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.14, 0.06), "Neutrophil": (0.07, 0.03),
        "Macrophage": (0.18, 0.07), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "ESCA": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.14, 0.06), "Neutrophil": (0.06, 0.03),
        "Macrophage": (0.17, 0.06), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "UCEC": {
        "B_cell": (0.07, 0.03), "CD4_T_cell": (0.14, 0.05),
        "CD8_T_cell": (0.10, 0.04), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.16, 0.06), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "KIRP": {
        "B_cell": (0.08, 0.04), "CD4_T_cell": (0.14, 0.05),
        "CD8_T_cell": (0.12, 0.05), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.14, 0.05), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "KICH": {
        "B_cell": (0.07, 0.03), "CD4_T_cell": (0.13, 0.05),
        "CD8_T_cell": (0.10, 0.04), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.12, 0.05), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "SARC": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.10, 0.04),
        "CD8_T_cell": (0.08, 0.03), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.18, 0.07), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.03, 0.01), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "LGG": {
        "B_cell": (0.03, 0.01), "CD4_T_cell": (0.08, 0.03),
        "CD8_T_cell": (0.05, 0.02), "Neutrophil": (0.03, 0.01),
        "Macrophage": (0.22, 0.08), "Dendritic_cell": (0.03, 0.01),
        "NK_cell": (0.02, 0.01), "Monocyte": (0.07, 0.03),
        "Mast_cell": (0.01, 0.01), "Eosinophil": (0.01, 0.01)
    },
    # 以下为罕见癌种，基于相近组织类型推断
    "ACC": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.10, 0.04),
        "CD8_T_cell": (0.08, 0.03), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.14, 0.05), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "CHOL": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.11, 0.04),
        "CD8_T_cell": (0.10, 0.04), "Neutrophil": (0.06, 0.03),
        "Macrophage": (0.18, 0.07), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "DLBC": {
        "B_cell": (0.30, 0.10), "CD4_T_cell": (0.15, 0.06),
        "CD8_T_cell": (0.08, 0.03), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.10, 0.04), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.04, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "LAML": {
        "B_cell": (0.03, 0.01), "CD4_T_cell": (0.10, 0.04),
        "CD8_T_cell": (0.06, 0.02), "Neutrophil": (0.15, 0.06),
        "Macrophage": (0.08, 0.03), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.10, 0.04),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.02, 0.01)
    },
    "MESO": {
        "B_cell": (0.04, 0.02), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.10, 0.04), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.20, 0.08), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.03, 0.01), "Monocyte": (0.06, 0.03),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "PCPG": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.10, 0.04),
        "CD8_T_cell": (0.07, 0.03), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.12, 0.05), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.03, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "TGCT": {
        "B_cell": (0.06, 0.03), "CD4_T_cell": (0.14, 0.05),
        "CD8_T_cell": (0.12, 0.05), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.12, 0.05), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "THYM": {
        "B_cell": (0.04, 0.02), "CD4_T_cell": (0.25, 0.08),
        "CD8_T_cell": (0.18, 0.06), "Neutrophil": (0.03, 0.01),
        "Macrophage": (0.08, 0.03), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.04, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "UCS": {
        "B_cell": (0.06, 0.03), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.09, 0.04), "Neutrophil": (0.05, 0.02),
        "Macrophage": (0.16, 0.06), "Dendritic_cell": (0.04, 0.02),
        "NK_cell": (0.04, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
    "UVM": {
        "B_cell": (0.05, 0.02), "CD4_T_cell": (0.12, 0.05),
        "CD8_T_cell": (0.14, 0.06), "Neutrophil": (0.04, 0.02),
        "Macrophage": (0.14, 0.05), "Dendritic_cell": (0.05, 0.02),
        "NK_cell": (0.05, 0.02), "Monocyte": (0.05, 0.02),
        "Mast_cell": (0.02, 0.01), "Eosinophil": (0.01, 0.01)
    },
}


def generate_sample_data(cancer_type: str, n_samples: int = 200) -> list[dict]:
    """生成指定癌型的示例免疫浸润数据"""
    profile = IMMUNE_PROFILES.get(cancer_type)
    if not profile:
        # 使用 LUAD 作为默认模板
        profile = IMMUNE_PROFILES["LUAD"]

    samples = []
    for i in range(n_samples):
        sample_id = f"TCGA-{cancer_type[:2].upper()}-{i + 1:04d}-01A"
        row = {"sample_id": sample_id}

        for cell_type, (mean, std) in profile.items():
            # 使用对数正态分布，确保值为正
            value = np.random.lognormal(np.log(mean + 0.001), 0.5)
            # 裁剪到合理范围 [0, 1]
            value = max(0.0, min(1.0, value))
            row[cell_type] = round(value, 4)

        samples.append(row)

    return samples


def write_csv(file_path: Path, samples: list[dict]):
    """写入 CSV 文件"""
    cell_types = [
        "B_cell", "CD4_T_cell", "CD8_T_cell", "Neutrophil",
        "Macrophage", "Dendritic_cell", "NK_cell", "Monocyte",
        "Mast_cell", "Eosinophil"
    ]
    fieldnames = ["sample_id"] + cell_types

    with open(file_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(samples)


def check_data_status(data_dir: Path):
    """检查数据状态"""
    print(f"数据目录: {data_dir}")
    print(f"目录存在: {data_dir.exists()}")

    if not data_dir.exists():
        print("目录不存在，无数据文件")
        return

    files = list(data_dir.glob("*.csv")) + list(data_dir.glob("*.tsv")) + list(data_dir.glob("*.csv.gz"))
    print(f"数据文件数: {len(files)}")

    if files:
        print("\n已有的癌型数据:")
        for f in sorted(files):
            size = f.stat().st_size
            print(f"  {f.name} ({size:,} bytes)")
    else:
        print("无数据文件")

    # 检查哪些癌型缺少数据
    from src.api_clients.immune_data_manager import ImmuneDataManager
    manager = ImmuneDataManager(data_dir=str(data_dir))
    status = manager.get_data_status()

    available = [c for c, s in status.items() if s["local_data"]]
    missing = [c for c, s in status.items() if not s["local_data"]]

    print(f"\n可用癌型 ({len(available)}): {', '.join(available) if available else '无'}")
    print(f"缺少癌型 ({len(missing)}): {', '.join(missing) if missing else '无'}")


def main():
    parser = argparse.ArgumentParser(description="免疫浸润数据准备工具")
    parser.add_argument("--check", action="store_true", help="检查数据状态")
    parser.add_argument("--cancers", nargs="+", help="指定要生成的癌型（默认全部）")
    parser.add_argument("--n-samples", type=int, default=200, help="每个癌型的样本数")
    parser.add_argument("--output", default="./data/immune_infiltration", help="输出目录")
    args = parser.parse_args()

    data_dir = Path(args.output)

    if args.check:
        check_data_status(data_dir)
        return

    # 确保目录存在
    data_dir.mkdir(parents=True, exist_ok=True)

    cancers = args.cancers or list(IMMUNE_PROFILES.keys())

    print(f"生成免疫浸润示例数据")
    print(f"癌型数: {len(cancers)}")
    print(f"每癌型样本数: {args.n_samples}")
    print(f"输出目录: {data_dir}")
    print()

    for cancer in cancers:
        if cancer not in IMMUNE_PROFILES:
            print(f"  [跳过] {cancer} — 无免疫浸润配置")
            continue

        samples = generate_sample_data(cancer, args.n_samples)
        file_path = data_dir / f"{cancer}.csv"
        write_csv(file_path, samples)
        print(f"  [完成] {cancer} → {file_path.name} ({len(samples)} 样本)")

    print(f"\n数据生成完成！文件保存至: {data_dir}")
    print("\n注意：这是基于 published 分布的示例数据，用于开发/测试。")
    print("生产环境请替换为真实 TIMER2.0/CIBERSORT 数据。")


if __name__ == "__main__":
    main()
