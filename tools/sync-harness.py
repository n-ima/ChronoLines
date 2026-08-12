#!/usr/bin/env python3
"""ハーネス本体 → 個別プロジェクトの逆同期ツール。

本体リポジトリで適用された改善(DECISIONS.md の D 番号)を、テンプレートコピーで
作られた個別プロジェクトのハーネスコピーへ反映する。generate-adapters.py と同じく
決定的・冪等で、既定は dry-run(差分レポートのみ)。書き込みは --apply を付けた時だけ。

使い方(どちらの側からでも実行できる。方向は常に 本体 → プロジェクト):
  本体リポジトリで:       python tools/sync-harness.py --project <対象リポジトリ> [--apply]
      対象の状態から実行モードを自動判定する(呼び出し側はモードを選ばない):
      - 適用済み(progress.md あり) → 逆同期(更新+欠けているファイルの追加)
      - 未適用                     → 初回注入(brownfield 経路B。新規追加のみ行い、
        既存ファイルは一切上書きしない。衝突はレポートに列挙され /11 の棚卸しで処理。
        適用後は docs/00-overview/intake-report.md を生成して /11 へ接続する)
  プロジェクト側で:       python tools/sync-harness.py --harness <本体のパス> [--apply]
  プロジェクト側(2回目以降): python tools/sync-harness.py [--apply]
      (--harness 省略時は docs/00-overview/harness-origin.md に自動記録された
       前回の本体パスを使う。--apply のたびに自動更新される)

設計方針:
- マニフェスト方式: ハーネス所有ファイル(下の SYNC_GLOBS)だけを対象にする。
  プロジェクト固有物(docs/ の実体・requirements/・プロジェクトが新設したスキル等)には
  一切触れない。削除も行わない(本体で消えたファイルの掃除は手動。レポートに注記)。
- 混在ファイル(deploy-* スキルのように汎用テンプレ + プロジェクト固有値表を持つもの、
  プロジェクトが書き換えてよい README 等)は「要レビュー」とし、自動では上書きしない
  (プロジェクト側に存在しない場合の新規追加だけは安全なので行う)。
- コピーはバイト単位(shutil.copyfile)。.ps1 の BOM・.sh の LF を壊さない。
- レポートはプロジェクト側 docs/00-overview/harness-sync-report.md に書く。
  execute 権限の無いエージェント(orchestrator)でもレポートを読んで続きを進められる。
"""
import argparse
import datetime
import re
import shutil
import sys
from pathlib import Path

# ハーネス所有(自動同期)の対象。ここに無いパスには絶対に触れない。
SYNC_GLOBS = [
    ".github/agents/**/*",
    ".github/harness/**/*",
    ".github/hooks/**/*",
    ".github/prompts/**/*",
    ".github/skills/**/*",
    ".claude/**/*",
    ".agents/**/*",
    ".vscode/settings.json",
    "tools/**/*",
    "docs/**/*_template.md",
    "AGENTS.md",
    "CLAUDE.md",
    "plugin.json",
    "DECISIONS.md",
    ".gitattributes",
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "README.md",
    ".github/CODEOWNERS",
]
# 両側に存在して差分がある場合、自動上書きせず手動マージに回すもの
REVIEW_PREFIXES = (".github/skills/deploy-",)  # 固有値表をプロジェクトが埋める
# README.md はプロジェクトでアプリのREADMEに置き換わる(ハーネス文書は .github/harness/ が正)
REVIEW_FILES = {"README.md", ".github/CODEOWNERS"}  # プロジェクトが書き換えうる
# 常に対象外
EXCLUDE_PREFIXES = (".github/hooks/logs/",)  # 実行時ログ(gitignore対象)
EXCLUDE_FILES = {".claude/settings.local.json",
                 ".claude/settings.json.locked"}  # 保守モード中の退避(ローカル一時ファイル)
EXCLUDE_PARTS = {"__pycache__", "node_modules"}


ORIGIN_REL = "docs/00-overview/harness-origin.md"


def looks_like_harness(root: Path) -> bool:
    return (root / "DECISIONS.md").is_file() and not (root / "docs/00-overview/progress.md").exists()


def looks_like_project(root: Path) -> bool:
    return (root / "docs/00-overview/progress.md").is_file()


def read_origin(project: Path):
    """harness-origin.md に記録された前回の本体パスを返す(無ければ None)。"""
    p = project / ORIGIN_REL
    if not p.is_file():
        return None
    m = re.search(r"^path:\s*(.+)$", p.read_text(encoding="utf-8", errors="replace"), re.M)
    return Path(m.group(1).strip()) if m else None


def write_origin(project: Path, harness: Path, version: str) -> None:
    """本体パスをプロジェクトに自動記録する(次回の /91 で --harness を省略できる)。"""
    p = project / ORIGIN_REL
    p.parent.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().isoformat()
    p.write_text(f"""<!-- HARNESS_ORIGIN
path: {harness.as_posix()}
version: {version}
synced: {today}
-->

# ハーネス本体の場所(自動記録)

このプロジェクトのハーネスは `{harness.as_posix()}` からコピー/同期された
({version} まで・{today})。「ハーネスを更新して」の依頼(/91-sync-from-harness)では
このパスが既定の本体として使われる。`tools/sync-harness.py --apply` のたびに
自動更新されるため、手で編集しない(本体を移動した場合は次回 --harness で明示すれば
記録が更新される)。
""", encoding="utf-8", newline="\n")


def harness_version(harness: Path) -> str:
    text = (harness / "DECISIONS.md").read_text(encoding="utf-8", errors="replace")
    nums = [int(m) for m in re.findall(r"^## D(\d+)", text, re.M)]
    return f"D{max(nums):03d}" if nums else "(D番号なし)"


def is_excluded(rel: str) -> bool:
    if rel in EXCLUDE_FILES:
        return True
    if any(rel.startswith(p) for p in EXCLUDE_PREFIXES):
        return True
    return any(part in EXCLUDE_PARTS for part in rel.split("/"))


def is_review(rel: str) -> bool:
    return rel in REVIEW_FILES or any(rel.startswith(p) for p in REVIEW_PREFIXES)


def normalized(data: bytes) -> bytes:
    """比較用にEOLを正規化する(.gitattributesの * text=auto と同じ意味論)。

    Windowsのworking treeはCRLF・LFが混在しうるため、バイト一致で比較すると
    改行コード差だけの「偽の更新」が大量に出る。バイナリはそのまま比較する。
    """
    if b"\0" in data:
        return data
    return data.replace(b"\r\n", b"\n")


def collect(harness: Path) -> list:
    rels = set()
    for pattern in SYNC_GLOBS:
        for p in harness.glob(pattern):
            if p.is_file():
                rel = p.relative_to(harness).as_posix()
                if not is_excluded(rel):
                    rels.add(rel)
    return sorted(rels)


def main() -> int:
    ap = argparse.ArgumentParser(description="ハーネス本体からプロジェクトへの逆同期・初回注入")
    ap.add_argument("--project", help="プロジェクトリポジトリのパス(本体側から実行する場合)")
    ap.add_argument("--harness", help="本体リポジトリのパス(プロジェクト側から実行する場合。"
                                      "省略時は harness-origin.md の記録を使う)")
    ap.add_argument("--init", action="store_true",
                    help="(通常は不要)初回注入モードの明示ヒント。実行モードは対象の状態から"
                         "自動判定されるため、付けても付けなくても正しいモードで動く")
    ap.add_argument("--apply", action="store_true", help="実際に書き込む(省略時はdry-run)")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    own = Path(__file__).resolve().parents[1]
    if args.init and not args.project:
        ap.error("--init は本体リポジトリ側から --project <対象リポジトリ> と共に使ってください")
        return 2
    if args.project and args.harness:
        ap.error("--project と --harness は同時に指定できません")
        return 2
    if args.project:
        harness, project = own, Path(args.project).resolve()
    elif args.harness:
        harness, project = Path(args.harness).resolve(), own
    else:
        # プロジェクト側で引数なし: harness-origin.md の自動記録から本体パスを補完する
        origin = read_origin(own)
        if origin is None:
            ap.error("--project / --harness のどちらかを指定してください"
                     "(docs/00-overview/harness-origin.md に前回の本体パスの記録がありません)")
            return 2
        harness, project = origin.resolve(), own
        print(f"(--harness 省略: harness-origin.md の記録 `{harness}` を使用)")

    if not looks_like_harness(harness):
        print(f"ERROR: {harness} は本体リポジトリに見えません"
              "(DECISIONS.md があり docs/00-overview/progress.md が無い状態が本体)。")
        return 1

    # 実行モードは対象の状態から自動判定する。「注入か更新か」を呼び出し側(人・エージェント)に
    # 選ばせると指示が間違いうるため、判断をツール側に持つ(D045。--init は明示ヒントに格下げ)。
    init_mode = False
    if args.project:  # 本体側から実行
        if not project.is_dir():
            print(f"ERROR: {project} が存在しません(対象は既存リポジトリ。新規作成は intake-app.py)。")
            return 1
        if looks_like_harness(project):
            print(f"ERROR: {project} は本体リポジトリに見えます。本体への注入・同期はできません。")
            return 1
        if looks_like_project(project):
            init_mode = False  # 適用済み → 通常の同期(欠けているファイルの追加も行う)
            if args.init:
                print("(対象は適用済み(progress.md あり)のため、通常の同期として実行します)")
        else:
            init_mode = True   # 未適用(または/11未完了) → 注入(新規追加のみ・上書きなし)
            if not args.init:
                print("(対象はハーネス未適用のため、初回注入モードで実行します:"
                      " 新規追加のみ・既存ファイルは上書きしない)")
    elif not looks_like_project(project):
        if (project / "AGENTS.md").exists():
            hint = ("ハーネスは注入済みに見えます。先に /11-brownfield-intake を完了してください"
                    "(GATE_STATUS 初期化で progress.md が作られ、以後この同期が使えます)。")
        else:
            hint = "初回の注入は本体側から --project <対象リポジトリ> で実行してください(モードは自動判定)。"
        print(f"ERROR: {project} はプロジェクトに見えません"
              f"(docs/00-overview/progress.md が存在するのがプロジェクト)。{hint}")
        return 1

    version = harness_version(harness)
    added, updated, review, unchanged = [], [], [], 0
    for rel in collect(harness):
        src, dst = harness / rel, project / rel
        src_bytes = src.read_bytes()
        if not dst.exists():
            added.append(rel)  # 新規追加は要レビュー対象でも安全(壊すものが無い)
        elif normalized(dst.read_bytes()) == normalized(src_bytes):
            unchanged += 1  # 改行コード差のみは変更なし扱い(gitのtext=autoと同じ)
        elif is_review(rel) or init_mode:
            # 初回注入では既存ファイルとの衝突を一切上書きしない(既存アプリの
            # CLAUDE.md / .vscode/settings.json 等。処理は /11 の棚卸しに委ねる)
            review.append(rel)
        else:
            updated.append(rel)

    mode = "init+apply" if (init_mode and args.apply) else \
           "init(dry-run)" if init_mode else \
           "apply" if args.apply else "dry-run"
    if args.apply:
        for rel in added + updated:
            dst = project / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(harness / rel, dst)
        # 本体パスをプロジェクトへ自動記録(次回から --harness を省略できる)
        write_origin(project, harness, version)

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    review_title = ("衝突(既存ファイルを保持。上書きしない。/11 の棚卸しで処理する)" if init_mode
                    else "要レビュー(自動上書きしない。差分を確認し手動でマージする)")
    review_note = ("  - 既存の CLAUDE.md / AGENTS.md 等は /11-brownfield-intake の"
                   "AI設定資産の棚卸し(知識回収 → .pre-harness リネームをユーザー承認つきで)で処理する。"
                   if init_mode
                   else "  - 混在ファイル(deploy-* の固有値表など)は、汎用部分の変更だけを手で取り込む。")
    lines = [
        "# ハーネス" + ("初回注入" if init_mode else "逆同期") + "レポート",
        "",
        f"- 実行モード: **{mode}** / 日時: {now}",
        f"- 本体: `{harness}`(**{version}** まで) → プロジェクト: `{project}`",
        f"- 追加: {len(added)} / 更新: {len(updated)} / "
        + ("衝突(保持)" if init_mode else "要レビュー") + f": {len(review)} / 変更なし: {unchanged}",
        "- このツールは削除を行わない。本体側で廃止されたファイルの掃除は手動で行う。",
        "",
    ]
    if init_mode and not (project / ".git").is_dir():
        lines += ["> **警告**: 対象は git リポジトリではありません(.git なし)。注入前の状態に"
                  "戻せるよう、先に `git init` + コミットしておくことを推奨します。", ""]
    for title, items, note in (
        ("追加" + ("(適用済み)" if args.apply else "(予定)"), added, ""),
        ("更新" + ("(適用済み)" if args.apply else "(予定)"), updated, ""),
        (review_title, review, review_note),
    ):
        lines.append(f"## {title}")
        lines.extend([f"- `{r}`" for r in items] or ["- なし"])
        if items and note:
            lines.append(note)
        lines.append("")
    if init_mode:
        lines += [
            "## 次の手順",
            ("1. 内容に問題がなければ `--apply` を付けて再実行する。" if not args.apply else
             f"1. `{project}` を開いた**新しいセッション**で `/11-brownfield-intake` を実行する"
             "(手順1.5 の配線確認 → as-is 逆起こし → ゲート初期化。上の衝突一覧が棚卸しの入力になる)。"),
            "",
        ]
    else:
        lines += [
            "## 次の手順",
            ("1. 差分に問題がなければ `--apply` を付けて再実行する。" if not args.apply
             else "1. 検証: `bash .github/hooks/scripts/selftest.sh` と "
                  "`python tools/validate-harness.py` をプロジェクト側で実行し、全PASS/エラー0を確認する。"),
            f"2. `docs/00-overview/progress.md` の申し送りを「ハーネス同期: {version} まで適用済み」に更新し、"
            "還流待ちマーカー・learnings.md の暫定運用行を消す(/91-sync-from-harness の完了処理)。",
            "",
        ]
    report = "\n".join(lines)
    report_path = project / "docs/00-overview/harness-sync-report.md"
    # init の dry-run だけは対象リポジトリに書き込まない(完全に無害な下見)
    report_written = not init_mode or args.apply
    if report_written:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report, encoding="utf-8", newline="\n")
    if init_mode and args.apply:
        # /11-brownfield-intake の入力マーカー。これが「未初期化のプロジェクト」の目印になり、
        # フック類が本体リポジトリと誤認しない(DECISIONS.md もコピーされるため)
        intake_path = project / "docs/00-overview/intake-report.md"
        if not intake_path.exists():
            intake_path.write_text(report, encoding="utf-8", newline="\n")

    print(report)
    if report_written:
        print(f"(レポートを {report_path} に書き出しました)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
