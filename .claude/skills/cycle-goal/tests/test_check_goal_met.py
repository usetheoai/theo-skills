"""Behaviour tests for the Stop-hook goal gate.

The gate decides whether a session may end, so the tests focus on the two ways
it could be wrong in opposite directions: releasing on unfinished work, and
trapping a session it can never release.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from check_goal_met import evaluate

SCRIPT = Path(__file__).parent.parent / "scripts" / "check_goal_met.py"
INSTALLER = Path(__file__).parent.parent / "scripts" / "install_goal_hook.py"


def roadmap(state: str = " ", milestone: str = "M2") -> str:
    return f"### {milestone} — [{state}] Streaming\n\n**Objective:** sse.\n"


def write_record(directory: Path, milestone: str, verdict: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{milestone}-2026-08-03.md"
    path.write_text(
        f"---\nmilestone_id: {milestone}\nverdict: {verdict}\n---\n\n# Acceptance\n",
        encoding="utf-8",
    )
    return path


class TestEvaluate:
    def test_aceito_e_flipado_satisfaz_a_meta(self, tmp_path: Path) -> None:
        write_record(tmp_path / "acc", "M2", "ACCEPTED")

        assert evaluate(["M2"], roadmap("x"), tmp_path / "acc") == []

    def test_aceito_com_ressalvas_tambem_satisfaz(self, tmp_path: Path) -> None:
        write_record(tmp_path / "acc", "M2", "ACCEPTED_WITH_CAVEATS")

        assert evaluate(["M2"], roadmap("x"), tmp_path / "acc") == []

    def test_aceitacao_nunca_rodou_bloqueia(self, tmp_path: Path) -> None:
        vazio = tmp_path / "acc"
        vazio.mkdir()  # existe mas sem registro: ausência real, não erro de config

        reasons = evaluate(["M2"], roadmap("x"), vazio)

        assert len(reasons) == 1
        assert "never ran" in reasons[0]
        assert "Silence is not a pass" in reasons[0]

    @pytest.mark.parametrize("verdict", ["REJECTED", "NOT_VALIDATED"])
    def test_veredito_negativo_bloqueia(self, tmp_path: Path, verdict: str) -> None:
        write_record(tmp_path / "acc", "M2", verdict)

        reasons = evaluate(["M2"], roadmap("x"), tmp_path / "acc")

        assert verdict in reasons[0]
        assert "never satisfies the goal" in reasons[0]

    def test_aceito_mas_checkbox_ainda_aberto_bloqueia(self, tmp_path: Path) -> None:
        """RELEASED + ACCEPTED sem o flip ainda não é milestone concluído."""
        write_record(tmp_path / "acc", "M2", "ACCEPTED")

        reasons = evaluate(["M2"], roadmap(" "), tmp_path / "acc")

        assert "still [ ]" in reasons[0]

    def test_milestone_ausente_do_roadmap_bloqueia(self, tmp_path: Path) -> None:
        write_record(tmp_path / "acc", "M2", "ACCEPTED")

        reasons = evaluate(["M2"], "### M9 — [x] Outro\n", tmp_path / "acc")

        assert "missing from ROADMAP.md" in reasons[0]

    def test_reporta_um_motivo_por_milestone_nao_cumprido(self, tmp_path: Path) -> None:
        write_record(tmp_path / "acc", "M2", "ACCEPTED")
        text = roadmap("x", "M2") + "\n" + roadmap(" ", "M3")

        reasons = evaluate(["M2", "M3"], text, tmp_path / "acc")

        assert len(reasons) == 1 and reasons[0].startswith("M3")


class TestHookContract:
    def _run(self, state: dict, tmp_path: Path) -> dict:
        state_path = tmp_path / "cycle-goal.json"
        state_path.write_text(json.dumps(state), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--state", str(state_path), "--project-root", str(tmp_path)],
            capture_output=True, text=True, check=False,
        )
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def _project(self, tmp_path: Path, checkbox: str, verdict: str | None) -> None:
        (tmp_path / "ROADMAP.md").write_text(roadmap(checkbox), encoding="utf-8")
        if verdict:
            write_record(tmp_path / "knowledge-base" / "acceptance", "M2", verdict)

    def test_bloqueia_com_motivo_quando_a_meta_nao_foi_cumprida(self, tmp_path: Path) -> None:
        self._project(tmp_path, " ", None)

        out = self._run({"milestones": ["M2"]}, tmp_path)

        assert out["decision"] == "block"
        assert "stop criterion is the acceptance run" in out["reason"]

    def test_libera_e_limpa_o_estado_quando_cumprida(self, tmp_path: Path) -> None:
        self._project(tmp_path, "x", "ACCEPTED")

        out = self._run({"milestones": ["M2"]}, tmp_path)

        assert "decision" not in out
        assert not (tmp_path / "cycle-goal.json").exists()

    def test_conta_os_bloqueios_para_nao_travar_para_sempre(self, tmp_path: Path) -> None:
        self._project(tmp_path, " ", None)
        state_path = tmp_path / "cycle-goal.json"

        self._run({"milestones": ["M2"], "blocks": 0, "max_blocks": 2}, tmp_path)

        assert json.loads(state_path.read_text())["blocks"] == 1

    def test_libera_ao_atingir_o_teto_dizendo_que_nao_foi_cumprida(self, tmp_path: Path) -> None:
        self._project(tmp_path, " ", None)

        out = self._run({"milestones": ["M2"], "blocks": 2, "max_blocks": 2}, tmp_path)

        assert "decision" not in out
        assert "is NOT done" in out["systemMessage"]

    def test_sem_estado_nao_bloqueia(self, tmp_path: Path) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--state", str(tmp_path / "ausente.json")],
            capture_output=True, text=True, check=False,
        )

        assert result.returncode == 0 and result.stdout.strip() == ""

    def test_falha_para_o_lado_aberto(self, tmp_path: Path) -> None:
        """Estado corrompido não pode prender a sessão."""
        state_path = tmp_path / "cycle-goal.json"
        state_path.write_text("{ isto não é json", encoding="utf-8")

        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--state", str(state_path), "--project-root", str(tmp_path)],
            capture_output=True, text=True, check=False,
        )

        assert result.returncode == 0
        assert "decision" not in json.loads(result.stdout)


class TestInstaller:
    def _settings(self, tmp_path: Path) -> dict:
        return json.loads((tmp_path / ".claude" / "settings.local.json").read_text())

    def _arm(self, tmp_path: Path, *milestones: str) -> subprocess.CompletedProcess:
        # O instalador recusa armar com caminhos que não resolvem, então o projeto
        # de teste precisa existir de verdade.
        (tmp_path / "ROADMAP.md").write_text(roadmap("x"), encoding="utf-8")
        (tmp_path / "knowledge-base" / "acceptance").mkdir(parents=True, exist_ok=True)
        return subprocess.run(
            [sys.executable, str(INSTALLER), "--project-root", str(tmp_path),
             "--milestones", *milestones],
            capture_output=True, text=True, check=False,
        )

    def test_arma_o_hook_e_grava_o_estado(self, tmp_path: Path) -> None:
        assert self._arm(tmp_path, "M2").returncode == 0

        hooks = self._settings(tmp_path)["hooks"]["Stop"]
        assert "check_goal_met.py" in hooks[0]["hooks"][0]["command"]
        assert json.loads((tmp_path / ".claude" / "cycle-goal.json").read_text())["milestones"] == ["M2"]

    def test_rearmar_nao_empilha_hooks_duplicados(self, tmp_path: Path) -> None:
        self._arm(tmp_path, "M2")
        self._arm(tmp_path, "M3")

        stop = self._settings(tmp_path)["hooks"]["Stop"]
        assert sum(len(e["hooks"]) for e in stop) == 1

    def test_preserva_settings_existentes(self, tmp_path: Path) -> None:
        claude = tmp_path / ".claude"
        claude.mkdir()
        (claude / "settings.local.json").write_text(json.dumps({
            "permissions": {"allow": ["Bash(git *)"]},
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "outro-script.sh"}]}]},
        }), encoding="utf-8")

        self._arm(tmp_path, "M2")

        settings = self._settings(tmp_path)
        assert settings["permissions"]["allow"] == ["Bash(git *)"]
        commands = [h["command"] for e in settings["hooks"]["Stop"] for h in e["hooks"]]
        assert "outro-script.sh" in commands

    def test_clear_remove_so_o_nosso_hook(self, tmp_path: Path) -> None:
        claude = tmp_path / ".claude"
        claude.mkdir()
        (claude / "settings.local.json").write_text(json.dumps({
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "outro-script.sh"}]}]},
        }), encoding="utf-8")
        self._arm(tmp_path, "M2")

        subprocess.run(
            [sys.executable, str(INSTALLER), "--project-root", str(tmp_path), "--clear"],
            capture_output=True, text=True, check=False,
        )

        settings = self._settings(tmp_path)
        commands = [h["command"] for e in settings.get("hooks", {}).get("Stop", []) for h in e["hooks"]]
        assert commands == ["outro-script.sh"]
        assert not (claude / "cycle-goal.json").exists()

    def test_recusa_settings_com_json_invalido_em_vez_de_sobrescrever(self, tmp_path: Path) -> None:
        claude = tmp_path / ".claude"
        claude.mkdir()
        corrupto = "{ não é json"
        (claude / "settings.local.json").write_text(corrupto, encoding="utf-8")

        result = self._arm(tmp_path, "M2")

        assert result.returncode == 2
        assert (claude / "settings.local.json").read_text() == corrupto


class TestMisconfiguration:
    """O primeiro uso real armou o gate apontando para um diretório inexistente.

    A ausência de arquivo é idêntica nos dois casos — "nunca aceito" e "diretório
    errado" — e a mensagem "never ran" soa como veredito legítimo. Separar os dois
    é o que impede o gate de bloquear para sempre por engano de configuração.
    """

    def test_diretorio_de_aceitacao_inexistente_e_reportado_como_misconfig(
        self, tmp_path: Path
    ) -> None:
        reasons = evaluate(["M27"], roadmap("x", "M27"), tmp_path / "nao-existe")

        assert len(reasons) == 1
        assert reasons[0].startswith("MISCONFIGURED")
        assert "--acceptance-dir" in reasons[0]

    def test_nao_confunde_misconfig_com_aceitacao_ausente(self, tmp_path: Path) -> None:
        existente = tmp_path / "acc"
        existente.mkdir()

        reasons = evaluate(["M27"], roadmap("x", "M27"), existente)

        assert "MISCONFIGURED" not in reasons[0]
        assert "never ran" in reasons[0]


class TestInstallerPathValidation:
    def _arm(self, tmp_path: Path, *extra: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(INSTALLER), "--project-root", str(tmp_path),
             "--milestones", "M27", *extra],
            capture_output=True, text=True, check=False,
        )

    def _project(self, tmp_path: Path, *, roadmap_file: bool, acc_dir: bool) -> None:
        if roadmap_file:
            (tmp_path / "ROADMAP.md").write_text(roadmap("x", "M27"), encoding="utf-8")
        if acc_dir:
            (tmp_path / "knowledge-base" / "acceptance").mkdir(parents=True)

    def test_recusa_armar_quando_o_diretorio_de_aceitacao_nao_resolve(
        self, tmp_path: Path
    ) -> None:
        self._project(tmp_path, roadmap_file=True, acc_dir=False)

        result = self._arm(tmp_path)

        assert result.returncode == 2
        assert "diretório de aceitação não existe" in result.stderr
        assert not (tmp_path / ".claude" / "cycle-goal.json").exists()

    def test_recusa_armar_quando_o_roadmap_nao_resolve(self, tmp_path: Path) -> None:
        self._project(tmp_path, roadmap_file=False, acc_dir=True)

        result = self._arm(tmp_path)

        assert result.returncode == 2
        assert "roadmap não existe" in result.stderr

    def test_force_arma_mesmo_assim_e_sinaliza(self, tmp_path: Path) -> None:
        self._project(tmp_path, roadmap_file=True, acc_dir=False)

        result = self._arm(tmp_path, "--force")

        assert result.returncode == 0
        assert "NÃO EXISTE" in result.stdout

    def test_acceptance_dir_customizado_vai_para_o_estado(self, tmp_path: Path) -> None:
        """O caso multi-repo: roadmap e artefatos num irmão, hook aqui."""
        self._project(tmp_path, roadmap_file=True, acc_dir=False)
        irmao = tmp_path / "irmao" / "knowledge-base" / "acceptance"
        irmao.mkdir(parents=True)

        result = self._arm(tmp_path, "--acceptance-dir", "irmao/knowledge-base/acceptance")

        assert result.returncode == 0
        state = json.loads((tmp_path / ".claude" / "cycle-goal.json").read_text())
        assert state["acceptance_dir"] == "irmao/knowledge-base/acceptance"
