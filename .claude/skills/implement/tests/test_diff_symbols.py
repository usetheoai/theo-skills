"""Tests for diff_symbols — authoritative symbol derivation from git diffs."""
from __future__ import annotations

import subprocess
from pathlib import Path

from diff_symbols import added_symbols_from_shas, shas_from_progress


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=True,
    ).stdout


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")
    return repo


def _commit_file(repo: Path, rel: str, content: str, msg: str) -> str:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    _git(repo, "add", rel)
    _git(repo, "commit", "-q", "-m", msg)
    return _git(repo, "rev-parse", "HEAD").strip()


def test_extracts_python_and_ts_definitions_from_added_lines(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    sha = _commit_file(
        repo, "src/foo.py",
        "def process_batch(items):\n    return items\n\n"
        "class OrderService:\n    pass\n",
        "feat: add",
    )
    sha2 = _commit_file(
        repo, "src/bar.ts",
        "export function computeTotal(x) { return x; }\n"
        "export interface PaymentPort {}\n",
        "feat: add ts",
    )
    symbols = added_symbols_from_shas(repo, [sha, sha2])
    assert "process_batch" in symbols
    assert "OrderService" in symbols
    assert "computeTotal" in symbols
    assert "PaymentPort" in symbols


def test_ignores_private_underscore_symbols(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    sha = _commit_file(repo, "src/x.py", "def _helper():\n    return 1\n", "feat")
    assert "_helper" not in added_symbols_from_shas(repo, [sha])


def test_empty_shas_returns_empty_set(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    assert added_symbols_from_shas(repo, []) == set()


def test_git_unavailable_returns_empty_set(tmp_path: Path) -> None:
    # Non-repo dir + bogus sha → git fails → empty set, never raises.
    assert added_symbols_from_shas(tmp_path, ["deadbeef"]) == set()


def test_shas_from_progress_filters_phase_and_missing(tmp_path: Path) -> None:
    progress = {
        "tasks": [
            {"id": "T1.1", "phase": "1", "commit_sha": "aaa"},
            {"id": "T1.2", "phase": "1"},  # no sha
            {"id": "T2.1", "phase": "2", "commit_sha": "bbb"},
        ]
    }
    assert shas_from_progress(progress) == ["aaa", "bbb"]
    assert shas_from_progress(progress, phase="1") == ["aaa"]
    assert shas_from_progress(progress, phase="2") == ["bbb"]


# ---------- F-6: symbols come from CODE, not from data ----------------


def test_symbols_are_not_harvested_from_generated_snapshots(tmp_path: Path) -> None:
    """A snapshot that RECORDS declarations is not a file that INTRODUCES them.

    `tests/repo/core-api-surface.dts.snap` is a concatenation of the package's emitted
    `.d.ts`, so every line reads `export declare function ...`. Measured on
    english-only-sweep: committing it made the phase-1 mini review emit 9 HIGH
    `wiring_pillar_a_fail` findings for symbols (`assertPublishable`, `ApiKeyRow`, …)
    that predate the plan — present in 88d4fa4, the commit before it started.
    """
    repo = _init_repo(tmp_path)
    sha = _commit_file(
        repo,
        "tests/repo/core-api-surface.dts.snap",
        "export declare function assertPublishable(v: string): void;\n"
        "export interface ApiKeyRow { id: string }\n",
        "feat: snapshot the surface",
    )

    assert added_symbols_from_shas(repo, [sha]) == set()


def test_symbols_are_not_harvested_from_json_fixtures(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    sha = _commit_file(repo, "tests/repo/core-api-surface.json",
                  '[{"name": "diagnosticarDescobribilidade", "kind": "value"}]\n',
                  "feat: name snapshot")

    assert added_symbols_from_shas(repo, [sha]) == set()


def test_symbols_from_real_source_are_still_harvested(tmp_path: Path) -> None:
    """The exemption must not blind the derivation where it matters."""
    repo = _init_repo(tmp_path)
    sha = _commit_file(repo, "src/thing.ts", "export function doThing(): void {}\n", "feat: thing")

    assert "doThing" in added_symbols_from_shas(repo, [sha])


def test_symbols_are_not_harvested_from_test_files(tmp_path: Path) -> None:
    """Pillar (a) asks for a PRODUCTION caller; a symbol defined in a test needs none.

    `check_wiring.py` already excludes test files when LOOKING for callers, so harvesting
    symbols from them asks a question that cannot be answered. Measured: a regression test
    carrying `export interface ApiKeyRow` as a fixture string re-introduced the very
    finding it was written to prevent.
    """
    repo = _init_repo(tmp_path)
    sha = _commit_file(repo, "tests/test_thing.py",
                       'FIXTURE = "export interface ApiKeyRow { id: string }"\n'
                       "def test_x() -> None:\n    pass\n",
                       "test: fixture")

    assert "ApiKeyRow" not in added_symbols_from_shas(repo, [sha])
