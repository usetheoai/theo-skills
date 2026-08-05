"""Tests for check_acceptance_criteria — AC/DoD inventory + enforcement (GAP 1+2)."""
from __future__ import annotations

import subprocess
from pathlib import Path

from check_acceptance_criteria import categorize, check_acceptance_criteria, parse_criteria

PLAN = """# Plan: X

## Phase 1: Foo

### T1.1 — Bar

#### Acceptance Criteria
- [ ] Pass: coverage — `npm run coverage` >= 90% on changed files
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — every changed file <= 500 lines
- [ ] Backward compatibility preserved across public API

#### DoD
- [ ] All tests passing
- [ ] Zero type errors

## Global Definition of Done
- [ ] CHANGELOG.md updated under [Unreleased]
- [ ] Runtime-metric proof — counter observed non-zero
"""


def _git(repo: Path, *a: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *a],
                          capture_output=True, text=True, check=True).stdout


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "r"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")
    return repo


def _commit(repo: Path, rel: str, content: str) -> str:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    _git(repo, "add", rel)
    _git(repo, "commit", "-q", "-m", "c")
    return _git(repo, "rev-parse", "HEAD").strip()


def test_parse_extracts_all_checkboxes(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN, encoding="utf-8")
    criteria = parse_criteria(plan)
    texts = [c.text for c in criteria]
    assert any("coverage" in t for t in texts)
    assert any("Backward compatibility" in t for t in texts)
    assert any("CHANGELOG" in t for t in texts)
    assert len(criteria) == 8


def test_categorize_maps_known_patterns() -> None:
    assert categorize("Pass: coverage >= 90%") == "coverage"
    assert categorize("every changed file <= 500 lines") == "file_size"
    assert categorize("Backward compatibility preserved") == "backward_compat"
    assert categorize("CHANGELOG.md updated") == "changelog"
    assert categorize("Runtime-metric proof — counter non-zero") == "runtime_metric"
    assert categorize("Zero type errors") == "typecheck"


def test_file_size_violation_is_high_finding(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    # 501-line file violates the "<= 500 lines" criterion.
    sha = _commit(repo, "src/big.py", "x = 1\n" * 501)
    plan = repo / "p.md"
    plan.write_text(PLAN, encoding="utf-8")
    report = check_acceptance_criteria(plan, repo_root=repo, shas=[sha])
    codes = [f.code for f in report.findings]
    assert "file_size_exceeded" in codes
    assert report.has_high_or_blocker is True


def test_file_size_pass_when_within_budget(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    sha = _commit(repo, "src/ok.py", "x = 1\n" * 10)
    plan = repo / "p.md"
    plan.write_text(PLAN, encoding="utf-8")
    report = check_acceptance_criteria(plan, repo_root=repo, shas=[sha])
    assert "file_size_exceeded" not in [f.code for f in report.findings]


def test_changelog_criterion_unmet_is_flagged(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    sha = _commit(repo, "src/ok.py", "x = 1\n")  # CHANGELOG NOT touched
    plan = repo / "p.md"
    plan.write_text(PLAN, encoding="utf-8")
    report = check_acceptance_criteria(plan, repo_root=repo, shas=[sha])
    assert "changelog_not_updated" in [f.code for f in report.findings]


def test_non_auto_verifiable_criteria_surfaced(tmp_path: Path) -> None:
    """Backward-compat is not machine-checkable — it must be surfaced, not silently
    accepted as a ticked box."""
    repo = _repo(tmp_path)
    sha = _commit(repo, "CHANGELOG.md", "# Changelog\n")
    plan = repo / "p.md"
    plan.write_text(PLAN, encoding="utf-8")
    report = check_acceptance_criteria(plan, repo_root=repo, shas=[sha])
    codes = [f.code for f in report.findings]
    assert "criterion_requires_human_evidence" in codes


def test_no_criteria_returns_skip(tmp_path: Path) -> None:
    plan = tmp_path / "empty.md"
    plan.write_text("# Plan\n\n## Goal\nDo a thing.\n", encoding="utf-8")
    report = check_acceptance_criteria(plan, repo_root=None, shas=None)
    assert report.total_criteria == 0
    assert report.status == "SKIP"


# ---------- F-8: the line budget measures CODE, not data --------------


def test_changelog_is_exempt_from_the_line_budget(tmp_path: Path) -> None:
    """CHANGELOG.md is append-only by contract (Unbreakable Rule 6) — it grows forever.

    A 500-line ceiling on it means the next entry anybody writes fails the gate. Measured
    on english-only-sweep: CHANGELOG.md at 503 lines produced a HIGH finding on a commit
    whose only sin was documenting the change, which Rule 6 requires.
    """
    repo = _repo(tmp_path)
    sha = _commit(repo, "CHANGELOG.md", "- entry\n" * 600)
    plan = repo / "p.md"
    plan.write_text(PLAN, encoding="utf-8")

    report = check_acceptance_criteria(plan, repo_root=repo, shas=[sha])

    assert "file_size_exceeded" not in [f.code for f in report.findings]


def test_generated_snapshots_are_exempt_from_the_line_budget(tmp_path: Path) -> None:
    """A snapshot's size is the size of what it records, not complexity someone wrote.

    `tests/repo/core-api-surface.dts.snap` is 3395 lines because the package's type
    surface is that large. Capping it would force either a smaller API or a disabled gate.
    """
    repo = _repo(tmp_path)
    sha = _commit(repo, "tests/repo/core-api-surface.dts.snap", "declare const x: number;\n" * 900)
    plan = repo / "p.md"
    plan.write_text(PLAN, encoding="utf-8")

    report = check_acceptance_criteria(plan, repo_root=repo, shas=[sha])

    assert "file_size_exceeded" not in [f.code for f in report.findings]


def test_oversized_source_file_is_still_caught(tmp_path: Path) -> None:
    """The exemption must not blunt the budget where it means something."""
    repo = _repo(tmp_path)
    sha = _commit(repo, "src/big.ts", "const x = 1;\n" * 600)
    plan = repo / "p.md"
    plan.write_text(PLAN, encoding="utf-8")

    report = check_acceptance_criteria(plan, repo_root=repo, shas=[sha])

    assert "file_size_exceeded" in [f.code for f in report.findings]
