"""
配置加载器
从 config.yaml 和 .env 文件加载配置，支持环境变量覆盖
"""
import os
from pathlib import Path
from typing import Any


def load_config(config_path: str = None) -> dict:
    """
    加载配置文件

    优先级：
    1. 环境变量覆盖
    2. .env 文件
    3. config.yaml
    4. 默认值

    Args:
        config_path: 配置文件路径，默认为项目根目录的 config.yaml

    Returns:
        配置字典
    """
    if config_path is None:
        # 从当前文件向上找到项目根目录
        project_root = Path(__file__).parent.parent.parent
        config_path = project_root / "config.yaml"

    config = _load_yaml(config_path)
    if config is None:
        config = _default_config()

    # 环境变量覆盖
    _apply_env_overrides(config)

    return config


def _load_yaml(path) -> dict | None:
    """加载 YAML 配置文件"""
    try:
        import yaml
        with open(path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    except (ImportError, FileNotFoundError):
        return None


def _apply_env_overrides(config: dict):
    """应用环境变量覆盖"""
    # NCBI API Key
    ncbi_key = os.environ.get("NCBI_API_KEY", "")
    if ncbi_key:
        api = config.setdefault("api", {})
        ncbi = api.setdefault("ncbi", {})
        ncbi["api_key"] = ncbi_key

    # 日志级别
    log_level = os.environ.get("LOG_LEVEL", "")
    if log_level:
        app = config.setdefault("app", {})
        app["log_level"] = log_level


def _default_config() -> dict:
    """返回默认配置（当 config.yaml 不可用时）"""
    return {
        "app": {
            "name": "靶点研究平台",
            "version": "0.5.0",
            "debug": False,
            "log_level": "INFO",
            "log_file": None
        },
        "api": {
            "timeout": 30,
            "cache_dir": "./cache",
            "cache_ttl": 86400,
            "rate_limit_interval": 0.34,
            "ncbi": {"base_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils", "api_key": ""},
            "opentargets": {
                "graphql_url": "https://api.platform.opentargets.org/api/v4/graphql",
                "rest_url": "https://api.opentargets.org/api/v4"
            },
            "clinicaltrials": {"base_url": "https://clinicaltrials.gov/api/v2/studies"},
            "gtex": {"base_url": "https://gtexportal.org/rest/v1"},
            "tcga": {"base_url": "https://api.gdc.cancer.gov"}
        },
        "stage2": {
            "output_dir": "./output/stage2",
            "geo": {"max_datasets_to_try": 5, "min_samples_per_group": 3},
            "de": {
                "strict_adj_p": 0.05, "strict_log2fc": 1.0,
                "relaxed_adj_p": 0.2, "relaxed_log2fc": 0.5,
                "nominal_p": 0.05, "nominal_log2fc": 0.3
            },
            "normal_filter": {"tpm_threshold": 50},
            "adaptive_weights": {
                "de_weight_min": 0.2, "de_weight_max": 0.6,
                "sigmoid_midpoint": 0.3, "sigmoid_steepness": 10.0
            },
            "druggability": {"fallback_genes": ["CDK4", "CDK6", "EGFR", "BRAF", "KRAS"], "top_n": 20}
        },
        "dashboard": {"host": "127.0.0.1", "port": 3012, "output_dir": "./output"}
    }


def get_config_value(config: dict, key_path: str, default: Any = None) -> Any:
    """
    按点分路径获取配置值

    用法:
        get_config_value(config, "api.ncbi.api_key", "")
        get_config_value(config, "stage2.de.strict_adj_p", 0.05)
    """
    keys = key_path.split('.')
    value = config
    for key in keys:
        if isinstance(value, dict) and key in value:
            value = value[key]
        else:
            return default
    return value
