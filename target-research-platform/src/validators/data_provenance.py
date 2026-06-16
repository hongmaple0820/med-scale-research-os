"""
数据溯源追踪器
确保每个数据点都有明确的API来源，禁止AI自行编造数据
"""
import json
import hashlib
from datetime import datetime
from typing import Any, Optional
from pathlib import Path


class DataProvenance:
    """数据溯源记录"""

    def __init__(
        self,
        field: str,
        value: Any,
        source: str,
        endpoint: str,
        params: dict,
        timestamp: str,
        raw_evidence: Optional[str] = None
    ):
        self.field = field
        self.value = value
        self.source = source
        self.endpoint = endpoint
        self.params = params
        self.timestamp = timestamp
        self.raw_evidence = raw_evidence
        self.hash = self._compute_hash()

    def _compute_hash(self) -> str:
        """计算溯源记录的哈希值"""
        key = f"{self.source}:{self.endpoint}:{json.dumps(self.params, sort_keys=True)}:{self.field}"
        return hashlib.md5(key.encode()).hexdigest()

    def to_dict(self) -> dict:
        return {
            "field": self.field,
            "value": self.value,
            "source": self.source,
            "endpoint": self.endpoint,
            "params": self.params,
            "timestamp": self.timestamp,
            "hash": self.hash,
            "has_raw_evidence": self.raw_evidence is not None
        }

    def __repr__(self):
        return f"DataProvenance(field={self.field}, source={self.source}, hash={self.hash[:8]})"


class ProvenanceTracker:
    """溯源追踪管理器"""

    def __init__(self, log_dir: Optional[str] = None):
        self.provenances: list[DataProvenance] = []
        self.log_dir = Path(log_dir) if log_dir else Path("./provenance_logs")
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def track(
        self,
        field: str,
        value: Any,
        source: str,
        endpoint: str,
        params: dict,
        timestamp: Optional[str] = None,
        raw_evidence: Optional[str] = None
    ) -> DataProvenance:
        """
        记录数据溯源

        Args:
            field: 数据字段名
            value: 数据值
            source: 数据来源（API名称）
            endpoint: API端点
            params: 请求参数
            timestamp: 时间戳（可选，默认当前时间）
            raw_evidence: 原始API返回证据（可选）

        Returns:
            DataProvenance对象
        """
        provenance = DataProvenance(
            field=field,
            value=value,
            source=source,
            endpoint=endpoint,
            params=params,
            timestamp=timestamp or datetime.now().isoformat(),
            raw_evidence=raw_evidence
        )

        self.provenances.append(provenance)
        return provenance

    def track_from_api_response(self, field: str, value: Any, api_response) -> DataProvenance:
        """
        从API响应对象记录溯源

        Args:
            field: 数据字段名
            value: 数据值
            api_response: APIResponse对象

        Returns:
            DataProvenance对象
        """
        return self.track(
            field=field,
            value=value,
            source=api_response.source,
            endpoint=api_response.endpoint,
            params=api_response.params,
            timestamp=api_response.timestamp,
            raw_evidence=api_response.raw_response
        )

    def get_provenance(self, field: str) -> Optional[DataProvenance]:
        """获取特定字段的溯源记录"""
        for p in self.provenances:
            if p.field == field:
                return p
        return None

    def get_all_provenances(self) -> list[dict]:
        """获取所有溯源记录"""
        return [p.to_dict() for p in self.provenances]

    def validate_provenance(self, field: str) -> tuple[bool, str]:
        """
        验证字段的溯源完整性

        Returns:
            (是否有效, 错误信息)
        """
        provenance = self.get_provenance(field)

        if not provenance:
            return False, f"字段 '{field}' 缺少溯源记录"

        if not provenance.source:
            return False, f"字段 '{field}' 缺少数据来源"

        if not provenance.timestamp:
            return False, f"字段 '{field}' 缺少时间戳"

        return True, ""

    def validate_all(self) -> tuple[bool, list[str]]:
        """
        验证所有溯源记录

        Returns:
            (全部有效, 错误列表)
        """
        issues = []

        for p in self.provenances:
            is_valid, error = self.validate_provenance(p.field)
            if not is_valid:
                issues.append(error)

        return len(issues) == 0, issues

    def save_to_file(self, filename: str):
        """保存溯源记录到文件"""
        filepath = self.log_dir / filename
        data = {
            "timestamp": datetime.now().isoformat(),
            "provenance_count": len(self.provenances),
            "provenances": self.get_all_provenances()
        }

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)

    def load_from_file(self, filename: str):
        """从文件加载溯源记录"""
        filepath = self.log_dir / filename

        if not filepath.exists():
            return

        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        for p_data in data.get('provenances', []):
            self.provenances.append(DataProvenance(
                field=p_data['field'],
                value=p_data['value'],
                source=p_data['source'],
                endpoint=p_data['endpoint'],
                params=p_data['params'],
                timestamp=p_data['timestamp']
            ))

    def get_summary(self) -> dict:
        """获取溯源摘要"""
        sources = {}
        for p in self.provenances:
            if p.source not in sources:
                sources[p.source] = 0
            sources[p.source] += 1

        return {
            "total_provenances": len(self.provenances),
            "sources": sources,
            "timestamp": datetime.now().isoformat()
        }


class UnverifiedDataError(Exception):
    """未验证数据错误"""
    pass


class DataProvenanceValidator:
    """数据溯源验证器"""

    def __init__(self, tracker: ProvenanceTracker):
        self.tracker = tracker

    def require_provenance(self, field: str) -> DataProvenance:
        """
        要求字段必须有溯源记录

        Args:
            field: 字段名

        Returns:
            DataProvenance对象

        Raises:
            UnverifiedDataError: 如果缺少溯源记录
        """
        provenance = self.tracker.get_provenance(field)
        if not provenance:
            raise UnverifiedDataError(
                f"字段 '{field}' 缺少溯源记录。"
                f"所有数据必须通过API获取并记录溯源。"
                f"禁止使用AI自行编造的数据。"
            )
        return provenance

    def validate_report_data(self, report: dict) -> tuple[bool, list[str]]:
        """
        验证报告数据的溯源完整性

        Args:
            report: 报告数据字典

        Returns:
            (是否有效, 错误列表)
        """
        issues = []

        def check_nested(data: dict, prefix: str = ""):
            for key, value in data.items():
                field_name = f"{prefix}.{key}" if prefix else key

                if isinstance(value, dict):
                    check_nested(value, field_name)
                elif isinstance(value, list):
                    for i, item in enumerate(value):
                        if isinstance(item, dict):
                            check_nested(item, f"{field_name}[{i}]")
                else:
                    # 检查是否有溯源
                    is_valid, error = self.tracker.validate_provenance(field_name)
                    if not is_valid:
                        # 对于非关键字段，只记录警告
                        if not self._is_critical_field(field_name):
                            issues.append(f"警告: {error}")
                        else:
                            issues.append(f"错误: {error}")

        check_nested(report)

        # 只有错误（非警告）才导致验证失败
        critical_issues = [i for i in issues if i.startswith("错误")]
        return len(critical_issues) == 0, issues

    def _is_critical_field(self, field_name: str) -> bool:
        """判断是否为关键字段"""
        critical_patterns = [
            "expression",
            "survival",
            "correlation",
            "p_value",
            "hr_",
            "score"
        ]
        return any(pattern in field_name.lower() for pattern in critical_patterns)
