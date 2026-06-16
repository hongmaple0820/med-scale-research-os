"""
SQLite 结果缓存 — 相同基因+疾病 7 天内不重复查询外部 API。
"""
import sqlite3
import json
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Any


class ResultCache:
    """SQLite-backed result cache with TTL."""

    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = str(Path(__file__).parent.parent / "cache" / "target_intelligence.db")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self._init_schema()

    def _init_schema(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                cache_key TEXT PRIMARY KEY,
                gene TEXT NOT NULL,
                disease TEXT NOT NULL,
                phase TEXT NOT NULL,
                source TEXT NOT NULL,
                data TEXT NOT NULL,
                response_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        """)
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_gene_disease
            ON cache(gene, disease)
        """)
        self.conn.commit()

    @staticmethod
    def make_key(gene: str, disease: str, phase: str, source: str) -> str:
        raw = f"{gene}|{disease}|{phase}|{source}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, gene: str, disease: str, phase: str, source: str) -> Optional[dict]:
        key = self.make_key(gene, disease, phase, source)
        now_utc = datetime.now(timezone.utc).isoformat()
        row = self.conn.execute(
            "SELECT data, response_hash, created_at FROM cache "
            "WHERE cache_key=? AND expires_at > ?",
            (key, now_utc)
        ).fetchone()
        if row:
            return {
                "data": json.loads(row[0]),
                "hash": row[1],
                "cached_at": row[2],
                "cached": True,
            }
        return None

    def set(
        self,
        gene: str,
        disease: str,
        phase: str,
        source: str,
        data: Any,
        ttl_days: int = 7,
    ) -> str:
        key = self.make_key(gene, disease, phase, source)
        data_str = json.dumps(data, sort_keys=True, ensure_ascii=False)
        response_hash = hashlib.sha256(data_str.encode()).hexdigest()
        now = datetime.now(timezone.utc)
        expires = now + timedelta(days=ttl_days)
        self.conn.execute(
            "INSERT OR REPLACE INTO cache VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                key, gene, disease, phase, source,
                data_str, response_hash,
                now.isoformat(), expires.isoformat(),
            ),
        )
        self.conn.commit()
        return response_hash

    def invalidate(self, gene: str, disease: str, phase: str = None, source: str = None):
        """Delete cache entries matching the given filters."""
        conditions = ["gene=?", "disease=?"]
        params = [gene, disease]
        if phase:
            conditions.append("phase=?")
            params.append(phase)
        if source:
            conditions.append("source=?")
            params.append(source)
        where = " AND ".join(conditions)
        self.conn.execute(f"DELETE FROM cache WHERE {where}", params)
        self.conn.commit()

    def stats(self) -> dict:
        """Return cache statistics."""
        now_utc = datetime.now(timezone.utc).isoformat()
        total = self.conn.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
        expired = self.conn.execute(
            "SELECT COUNT(*) FROM cache WHERE expires_at <= ?",
            (now_utc,)
        ).fetchone()[0]
        return {"total": total, "active": total - expired, "expired": expired}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    def close(self):
        self.conn.close()
