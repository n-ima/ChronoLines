#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Golden Eval 最小版(D046): 「完了宣言」と「成果物の実態」の突き合わせチェッカー。

ハーネスの中核KPI「エージェントが完了と宣言した成果物のうち、機械的検証を通る割合」を
プロジェクトの docs/ 構造から決定論的に測る。エージェントの自己申告(GATE_STATUS の done・
tasks.md の [x])を信用せず、対応する成果物・証拠の実在で裏を取る。

使い方:
    python tools/golden-eval.py <プロジェクトルート>   # 検査して結果と割合を表示
    python tools/golden-eval.py --selftest             # 合成フィクスチャで自己テスト

終了コード: 0 = 完了宣言に対する検証がすべて通った(または完了宣言がまだ無い)
            1 = 完了宣言と実態の食い違いを検出
            2 = 実行エラー(progress.md が壊れている等)

位置づけ: テストフェーズ・リリース前の自己点検、/99-status の補助、ハーネス本体CIの
自己テスト。アプリのテストスイート実行までは行わない(それは test フェーズの責務。
本ツールは「テストを実行した証拠が文書として残っているか」までを機械検査する)。
"""
from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

PHASES = ("requirements", "design", "implementation", "test", "release")
ARTIFACTS = {
    "requirements": "docs/01-requirements/requirements.md",
    "design": "docs/02-design/architecture.md",
    "implementation": "docs/03-implementation/tasks.md",
    "test": "docs/04-test/test-report.md",
    "release": "docs/05-release/release-checklist.md",
}


def read_gate_status(root: Path) -> dict[str, str] | None:
    progress = root / "docs" / "00-overview" / "progress.md"
    if not progress.exists():
        return None
    text = progress.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"<!--\s*GATE_STATUS(.*?)-->", text, re.S)
    if not m:
        return None
    status = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"^(\w+):\s*(\S+)", line.strip())
        if mm and mm.group(1) in PHASES:
            status[mm.group(1)] = mm.group(2)
    return status


def check_project(root: Path) -> tuple[list[tuple[str, str, str]], int, int]:
    """検査結果 [(判定, フェーズ, 理由)], 完了宣言数, 検証通過数 を返す。"""
    results: list[tuple[str, str, str]] = []
    status = read_gate_status(root)
    if status is None:
        results.append(("NG", "progress", "progress.md が無いか GATE_STATUS ブロックを読めない"))
        return results, 0, 0

    declared = passed = 0
    for phase in PHASES:
        st = status.get(phase, "not_started")
        if st != "done":
            results.append(("SKIP", phase, f"状態 {st}(完了宣言なし)"))
            continue
        declared += 1
        art = root / ARTIFACTS[phase]
        if not art.exists() or art.stat().st_size == 0:
            results.append(("NG", phase, f"done 宣言だが成果物 {ARTIFACTS[phase]} が無い/空"))
            continue
        ok = True
        if phase == "implementation":
            text = art.read_text(encoding="utf-8", errors="replace")
            unchecked = re.findall(r"^\s*-\s*\[\s\]", text, re.M)
            if unchecked:
                results.append(("NG", phase, f"done 宣言だが未完了タスクが {len(unchecked)} 件残っている"))
                ok = False
            # done契約(完了条件)の証拠: [x] タスクの周辺に検証の痕跡があるか(緩い検査)
            checked = len(re.findall(r"^\s*-\s*\[x\]", text, re.M | re.I))
            if ok and checked and "完了条件" not in text:
                results.append(("WARN", phase, "tasks.md に完了条件(done契約)の記載が無い(旧テンプレの可能性)"))
        if phase == "test":
            text = art.read_text(encoding="utf-8", errors="replace")
            if not re.search(r"(成功|失敗|pass|fail|PASS|FAIL|✅|❌|\d+\s*件)", text):
                results.append(("WARN", phase, "test-report.md にテスト結果らしい記載を検出できない"))
        if ok:
            passed += 1
            results.append(("OK", phase, f"{ARTIFACTS[phase]} と整合"))
    # 横断の軽い検査(NGにはしない): learnings とトレーサビリティ
    if (root / ARTIFACTS["design"]).exists():
        dtext = (root / ARTIFACTS["design"]).read_text(encoding="utf-8", errors="replace")
        if not re.search(r"(トレーサビリティ|要件対応表)", dtext):
            results.append(("WARN", "design", "architecture.md にトレーサビリティ表の見出しが見当たらない"))
    if declared >= 3 and not (root / "docs" / "00-overview" / "learnings.md").exists():
        results.append(("WARN", "growth", "learnings.md が無い(成長ループが回っていない可能性)"))
    return results, declared, passed


def run(root: Path) -> int:
    if not root.is_dir():
        print(f"エラー: {root} はディレクトリではありません")
        return 2
    results, declared, passed = check_project(root)
    ng = sum(1 for r in results if r[0] == "NG")
    for verdict, phase, reason in results:
        print(f"{verdict}\t{phase}\t{reason}")
    print()
    if declared:
        rate = 100 * passed // declared
        print(f"完了宣言 {declared} 件中、機械的検証を通過 {passed} 件({rate}%)。目標は90%以上。")
    else:
        print("完了宣言(done)がまだ無いため、割合の算出対象はありません。")
    return 1 if ng else 0


def selftest() -> int:
    failures = []

    def expect(cond, label):
        (failures.append(label) if not cond else None)
        print(("PASS: " if cond else "FAIL: ") + label)

    with tempfile.TemporaryDirectory() as td:
        # fixture A: 整合したプロジェクト(要3フェーズdone)
        a = Path(td) / "ok"
        (a / "docs" / "00-overview").mkdir(parents=True)
        (a / "docs" / "00-overview" / "progress.md").write_text(
            "<!-- GATE_STATUS\nrequirements: done\ndesign: done\nimplementation: done\n"
            "test: in_progress\nrelease: not_started\n-->\n", encoding="utf-8")
        (a / "docs" / "00-overview" / "learnings.md").write_text("- [2026-08-12] x\n", encoding="utf-8")
        (a / "docs" / "01-requirements").mkdir(parents=True)
        (a / "docs" / "01-requirements" / "requirements.md").write_text("# 要件\nUS-001\n", encoding="utf-8")
        (a / "docs" / "02-design").mkdir(parents=True)
        (a / "docs" / "02-design" / "architecture.md").write_text("# 設計\n## トレーサビリティ\n", encoding="utf-8")
        (a / "docs" / "03-implementation").mkdir(parents=True)
        (a / "docs" / "03-implementation" / "tasks.md").write_text(
            "- [x] TASK-001: x(完了条件: npm test 12件成功)\n", encoding="utf-8")
        results, declared, passed = check_project(a)
        expect(declared == 3 and passed == 3, "整合プロジェクト: 完了宣言3件すべて検証通過")
        expect(not any(v == "NG" for v, _, _ in results), "整合プロジェクト: NGなし")

        # fixture B: 完了宣言と実態が食い違うプロジェクト
        b = Path(td) / "broken"
        (b / "docs" / "00-overview").mkdir(parents=True)
        (b / "docs" / "00-overview" / "progress.md").write_text(
            "<!-- GATE_STATUS\nrequirements: done\ndesign: not_started\nimplementation: done\n"
            "test: not_started\nrelease: not_started\n-->\n", encoding="utf-8")
        (b / "docs" / "03-implementation").mkdir(parents=True)
        (b / "docs" / "03-implementation" / "tasks.md").write_text(
            "- [x] TASK-001: x\n- [ ] TASK-002: y\n", encoding="utf-8")
        results, declared, passed = check_project(b)
        ngs = {(p) for v, p, _ in results if v == "NG"}
        expect("requirements" in ngs, "食い違い: done宣言なのに requirements.md が無い -> NG")
        expect("implementation" in ngs, "食い違い: done宣言なのに未完了タスク残り -> NG")
        expect(declared == 2 and passed == 0, "食い違い: 検証通過0/2")

        # fixture C: progress.md なし
        c = Path(td) / "empty"
        c.mkdir()
        results, _, _ = check_project(c)
        expect(any(v == "NG" and p == "progress" for v, p, _ in results), "progress.md なし -> NG")

    print()
    print(f"golden-eval selftest: {'FAIL ' + str(len(failures)) if failures else 'all passed'}")
    return 1 if failures else 0


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = sys.argv[1:]
    if args and args[0] == "--selftest":
        return selftest()
    if not args:
        print(__doc__)
        return 2
    return run(Path(args[0]))


if __name__ == "__main__":
    sys.exit(main())
