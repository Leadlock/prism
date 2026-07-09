"""Assessment Store — persists all PRISM DPDP assessment data to JSON files."""

from __future__ import annotations

import json
from pathlib import Path

from prism_dpdp.models.organisation import Department, Organisation
from prism_dpdp.models.recommendation import Recommendation
from prism_dpdp.models.tool_catalogue import ToolEntry


class AssessmentStore:
    """JSON file-based persistence for the DPDP assessment workflow."""

    def __init__(self, data_dir: str | Path = "prism_dpdp/data") -> None:
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        return self._dir / f"{name}.json"

    def _load(self, name: str) -> list[dict]:
        p = self._path(name)
        if p.exists():
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        return []

    def _save(self, name: str, data: list[dict]) -> None:
        with open(self._path(name), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)

    # ─── Departments ──────────────────────────────────────────────────────

    def save_departments(self, departments: list[Department]) -> None:
        self._save("departments", [d.model_dump() for d in departments])

    def load_departments(self) -> list[Department]:
        return [Department(**d) for d in self._load("departments")]

    # ─── Tools ────────────────────────────────────────────────────────────

    def save_tools(self, tools: list[ToolEntry]) -> None:
        self._save("tools", [t.model_dump() for t in tools])

    def load_tools(self) -> list[ToolEntry]:
        return [ToolEntry(**t) for t in self._load("tools")]

    def get_tools_by_department(self, department_id: str) -> list[ToolEntry]:
        return [t for t in self.load_tools() if t.department_id == department_id]

    # ─── Recommendations ──────────────────────────────────────────────────

    def save_recommendations(self, recs: list[Recommendation]) -> None:
        self._save("recommendations", [r.model_dump() for r in recs])

    def load_recommendations(self) -> list[Recommendation]:
        return [Recommendation(**r) for r in self._load("recommendations")]

    # ─── Summary / Review ─────────────────────────────────────────────────

    def save_review_summary(self, summary: dict) -> None:
        with open(self._path("review_summary"), "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, default=str)

    def load_review_summary(self) -> dict:
        p = self._path("review_summary")
        if p.exists():
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        return {}
