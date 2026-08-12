#!/usr/bin/env python3
"""既存アプリをハーネステンプレートベースの新プロジェクトへ取り込むセットアップツール。

多数の既存アプリにハーネスを展開するときの機械的なセットアップ(テンプレート複製 →
app/ へのアプリコピー → git 初期化 → 初回コミット)を決定的に自動化する
(brownfield-intake スキルの経路A)。as-is の解析・docs への逆起こしは本ツールの
範囲外で、作成後のプロジェクトを開いた新しいセッションの /11-brownfield-intake が担う。

使い方(ハーネス本体で実行。clone でも ZIP 展開コピーでも可):
  python tools/intake-app.py --app <既存アプリのパス> --project <新プロジェクトの作成先> [--dir app] [--apply]

設計方針:
- sync-harness.py と同じく決定的・既定は dry-run(検査とレポートのみ)。書き込みは --apply の時だけ。
- テンプレートは本体 HEAD の追跡ファイルのみ(git archive)。.git・ローカル設定・
  フックログは構造的に混入しない(USAGE.md「0. 準備」経路2と同じ安全なZIPの作り方)。
  本体が git リポジトリでない場合(ZIP でダウンロードした本体コピー)は、
  ローカル専用ファイルを除外したフォルダコピーに自動でフォールバックする。
- アプリは内部構成そのまま --dir(既定 app/)配下へコピーする。仕分け・再編成はしない
  (再編成は as-is 確定後の改修タスク。brownfield-intake スキルのアンチパターン参照)。
- アプリ側ファイルは一切改変しない。AI設定資産(CLAUDE.md / .github / .claude 等)は
  検出して報告するだけで、棚卸し(知識回収・無効化の提案)は /11-brownfield-intake が
  ユーザー承認つきで行う(検知は機械・判断はエージェント・承認は人)。
- レポートはプロジェクト側 docs/00-overview/intake-report.md に書く(/11 の入力になる)。
"""
import argparse
import datetime
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# ハーネスが占有するルート名。--dir がこれらと衝突すると探索・フックが壊れる
RESERVED_NAMES = {"docs", "requirements", "tools", ".github", ".claude", ".agents",
                  ".vscode", ".git"}
# アプリコピー時に除外するもの(.git はネストするとgitlink化して外側のリポジトリが壊れる)
EXCLUDE_DIRS = {".git", "__pycache__", "node_modules"}
EXCLUDE_FILES = {".DS_Store", "Thumbs.db"}
# 非git本体(ZIP展開コピー)からのテンプレート作成時に追加で除外するローカル専用物
TEMPLATE_EXCLUDE_REL = {".claude/settings.local.json"}
TEMPLATE_EXCLUDE_REL_DIRS = {".github/hooks/logs", ".claude/skills/.system"}
# Claude Code はサブディレクトリの CLAUDE.md / AGENTS.md を配下の作業時に自動で
# 文脈に読み込むため、app/ 配下でも「実効性あり」(唯一の要棚卸し対象)
EFFECTIVE_NAMES = {"claude.md", "agents.md"}
# ルート起点でしか探索されないため app/ 配下では不活性なAI設定ディレクトリ
AI_CONFIG_DIRS = {".github", ".claude", ".agents", ".cursor", ".vscode", ".windsurf"}


def looks_like_harness(root: Path) -> bool:
    """本体= DECISIONS.md があり progress.md 実体が無い(プロジェクトをテンプレに誤用しない)。

    intake 直後のプロジェクトは progress.md がまだ無い(/11 実行前)ため、
    本ツールが書く intake-report.md の存在もプロジェクトの証拠として使う。
    """
    return ((root / "DECISIONS.md").is_file()
            and not (root / "docs/00-overview/progress.md").exists()
            and not (root / "docs/00-overview/intake-report.md").exists())


def harness_version(harness: Path) -> str:
    text = (harness / "DECISIONS.md").read_text(encoding="utf-8", errors="replace")
    nums = [int(m) for m in re.findall(r"^## D(\d+)", text, re.M)]
    return f"D{max(nums):03d}" if nums else "(D番号なし)"


def write_origin(project: Path, harness: Path, version: str) -> None:
    """本体パスをプロジェクトへ自動記録する(tools/sync-harness.py と同じ形式。
    以後の「ハーネスを更新して」(/91)で --harness を省略できるようにする)。"""
    p = project / "docs/00-overview/harness-origin.md"
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


def run_git(git: str, *args, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run([git, *args], cwd=str(cwd), capture_output=True,
                          encoding="utf-8", errors="replace")


def scan_app(app: Path):
    """コピー対象(相対POSIXパス)と除外一覧を列挙する。os.walk相当をpathlibで実装"""
    files, excluded = [], []

    def walk(d: Path):
        for p in sorted(d.iterdir()):
            rel = p.relative_to(app).as_posix()
            if p.is_dir():
                if p.name in EXCLUDE_DIRS:
                    excluded.append(rel + "/")
                else:
                    walk(p)
            elif p.name in EXCLUDE_FILES:
                excluded.append(rel)
            else:
                files.append(rel)

    walk(app)
    return files, excluded


def scan_ai_assets(files, dirname: str):
    """アプリ内のAI設定資産を検出し分類する(報告のみ。改変しない)。

    戻り値: (実効性ありファイル, 旧CIディレクトリ, 不活性ディレクトリ) いずれも
    プロジェクトルートからの相対パス(dirname/ 前置)で返す。
    """
    effective, ci_dirs, inert_dirs = [], {}, {}
    for rel in files:
        parts = rel.split("/")
        name = parts[-1].lower()
        if name in EFFECTIVE_NAMES:
            effective.append(f"{dirname}/{rel}")
        for i, part in enumerate(parts[:-1]):
            if part in AI_CONFIG_DIRS:
                root = f"{dirname}/" + "/".join(parts[: i + 1])
                if part == ".github" and "workflows" in parts[i + 1:-1]:
                    ci_dirs[root + "/workflows"] = ci_dirs.get(root + "/workflows", 0) + 1
                else:
                    inert_dirs[root] = inert_dirs.get(root, 0) + 1
                break
    return sorted(effective), dict(sorted(ci_dirs.items())), dict(sorted(inert_dirs.items()))


def scan_harness(harness: Path):
    """非gitの本体コピー(ZIP展開)向けに、テンプレートへ含めるファイルを列挙する。

    git archive(HEAD) の代替。GitHub の ZIP は追跡ファイルのみだが、使用中のコピーには
    ローカル専用ファイル(フックログ・settings.local.json 等)が生じうるため除外する。
    """
    files = []

    def walk(d: Path):
        for p in sorted(d.iterdir()):
            rel = p.relative_to(harness).as_posix()
            if p.is_dir():
                if p.name in EXCLUDE_DIRS or rel in TEMPLATE_EXCLUDE_REL_DIRS:
                    continue
                walk(p)
            elif (p.name in EXCLUDE_FILES or rel in TEMPLATE_EXCLUDE_REL
                  or (rel.startswith(".vscode/") and rel.endswith(".local.json"))):
                continue
            else:
                files.append(rel)

    walk(harness)
    return files


def copy_app(app: Path, dest: Path) -> None:
    def ignore(_src, names):
        return [n for n in names if n in EXCLUDE_DIRS or n in EXCLUDE_FILES]

    shutil.copytree(app, dest, ignore=ignore)


def readme_stub(app_name: str, dirname: str) -> str:
    return "\n".join([
        f"# {app_name}(仮)",
        "",
        "このリポジトリは、開発ハーネス(テンプレート)に既存アプリを取り込んだプロジェクトです。",
        "",
        f"- アプリ本体: [{dirname}/]({dirname}/) 配下(取り込み時の構成のまま)",
        "- 取り込みレポート: [docs/00-overview/intake-report.md](docs/00-overview/intake-report.md)",
        "- ハーネスの使い方: [.github/harness/USAGE.md](.github/harness/USAGE.md)",
        "",
        "この README は as-is 逆起こし(`/11-brownfield-intake`)とリリース工程で、",
        "アプリの正式な README に置き換えてください。",
        "",
    ])


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(
        description="既存アプリをテンプレートベースの新プロジェクトへ取り込む(brownfield 経路A)")
    ap.add_argument("--app", required=True, help="既存アプリのパス(無改変で読み取るだけ)")
    ap.add_argument("--project", required=True, help="新プロジェクトの作成先(未存在か空であること)")
    ap.add_argument("--dir", default="app", help="アプリを置くディレクトリ名(既定: app)")
    ap.add_argument("--apply", action="store_true", help="実際に作成する(省略時はdry-run)")
    args = ap.parse_args()

    harness = Path(__file__).resolve().parents[1]
    app = Path(args.app).resolve()
    project = Path(args.project).resolve()
    dirname = args.dir

    # ---- 事前検査(導入前評価)。1つでもNGなら何も書かずに中止する
    errors, warnings = [], []
    git = shutil.which("git")
    if git is None:
        errors.append("git が見つかりません(PATHを確認)。")
    if not looks_like_harness(harness):
        errors.append(f"{harness} は本体リポジトリに見えません"
                      "(DECISIONS.md があり docs/00-overview/progress.md が無い状態が本体。"
                      "プロジェクトのコピーをテンプレートとして使わないでください)。")
    if not app.is_dir():
        errors.append(f"--app が存在しないかディレクトリではありません: {app}")
    if project.exists() and (not project.is_dir() or any(project.iterdir())):
        errors.append(f"--project が既に存在し空ではありません: {project}")
    if project == harness or harness in project.parents:
        errors.append("--project を本体リポジトリ配下に作成することはできません(本体を汚さない)。")
    if app.is_dir() and (project == app or app in project.parents or project in app.parents):
        errors.append("--app と --project が入れ子関係です(自分自身へのコピーになる)。")
    if not re.fullmatch(r"[^/\\]+", dirname) or dirname in {".", ".."}:
        errors.append(f"--dir はパス区切りを含まない単一のディレクトリ名にしてください: {dirname}")

    top_level, template_files, harness_git = [], [], False
    if git and looks_like_harness(harness):
        harness_git = run_git(git, "rev-parse", "--is-inside-work-tree",
                              cwd=harness).returncode == 0
        if harness_git:
            r = run_git(git, "ls-tree", "--name-only", "HEAD", cwd=harness)
            if r.returncode != 0:
                errors.append(f"本体で git ls-tree に失敗しました: {r.stderr.strip()}")
            else:
                top_level = r.stdout.splitlines()
            if run_git(git, "status", "--porcelain", cwd=harness).stdout.strip():
                warnings.append("本体に未コミットの変更があります。テンプレートは HEAD 時点の内容です。")
        else:
            # ZIP でダウンロードした本体コピー(非git)。フォルダコピーにフォールバック
            template_files = scan_harness(harness)
            top_level = sorted({rel.split("/")[0] for rel in template_files})
            warnings.append("本体が git リポジトリではない(ZIP展開コピー)ため、テンプレートは"
                            "フォルダ内容のコピーで作成します(ローカル専用ファイルは除外)。")
    reserved = {n.casefold() for n in RESERVED_NAMES} | {n.casefold() for n in top_level}
    if dirname.casefold() in reserved:
        errors.append(f"--dir '{dirname}' はハーネスの予約名/テンプレートのルート名と衝突します。")

    if errors:
        print("中止しました(事前検査NG)。人間が以下を解消してから再実行してください:")
        for e in errors:
            print(f"  NG: {e}")
        return 1

    # ---- 列挙(dry-run/apply共通。ここまで書き込みなし)
    if harness_git:
        template_count = len(run_git(git, "ls-tree", "-r", "--name-only", "HEAD",
                                     cwd=harness).stdout.splitlines())
    else:
        template_count = len(template_files)
    files, excluded = scan_app(app)
    effective, ci_dirs, inert_dirs = scan_ai_assets(files, dirname)
    version = harness_version(harness)
    mode = "apply" if args.apply else "dry-run"

    # ---- 適用
    commit_ok, ignored = None, []
    if args.apply:
        project.mkdir(parents=True, exist_ok=True)
        if harness_git:
            with tempfile.TemporaryDirectory() as td:
                zpath = Path(td) / "harness.zip"
                r = run_git(git, "archive", "--format=zip", "-o", str(zpath), "HEAD", cwd=harness)
                if r.returncode != 0:
                    print(f"ERROR: git archive に失敗しました: {r.stderr.strip()}")
                    return 1
                with zipfile.ZipFile(zpath) as zf:
                    zf.extractall(project)
        else:
            for rel in template_files:
                dst = project / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(harness / rel, dst)
        copy_app(app, project / dirname)
        (project / "README.md").write_text(readme_stub(app.name, dirname),
                                           encoding="utf-8", newline="\n")
        for step in (("init", "-b", "main"), ("add", "-A")):
            r = run_git(git, *step, cwd=project)
            if r.returncode != 0:
                print(f"ERROR: git {step[0]} に失敗しました: {r.stderr.strip()}")
                return 1
        # テンプレートの .gitignore(node_modules/ dist/ build/ 等)に食われたアプリ内
        # ファイルは黙って消える(コミットされない)ため、明示的に報告する
        st = run_git(git, "status", "--porcelain=v1", "-z", "--ignored", cwd=project)
        ignored = [e[3:] for e in st.stdout.split("\0")
                   if e.startswith("!! ") and e[3:].startswith(dirname + "/")]
        r = run_git(git, "commit", "-m",
                    f"ハーネステンプレートに既存アプリ({dirname}/)を取り込んだ初期状態 (tools/intake-app.py)",
                    cwd=project)
        commit_ok = r.returncode == 0
        if not commit_ok:
            warnings.append("git commit に失敗しました。user.name/user.email 設定などを確認し、"
                            f"手動でコミットしてください: {r.stderr.strip()}")

    # ---- レポート
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        "# 既存アプリ取り込みレポート(tools/intake-app.py)",
        "",
        f"- 実行モード: **{mode}** / 日時: {now}",
        f"- テンプレート: `{harness}`(**{version}** まで / {template_count} ファイル / "
        + ("git archive(HEAD)" if harness_git else "フォルダコピー(非git本体)") + ")",
        f"- アプリ元: `{app}` → 配置先: `{project}` の `{dirname}/`(内部構成そのまま・無仕分け)",
        f"- アプリ: {len(files)} ファイル(除外 {len(excluded)} 件: "
        + (", ".join(f"`{e}`" for e in excluded[:10])
           + (f" 他{len(excluded) - 10}件" if len(excluded) > 10 else "") if excluded else "なし")
        + ")",
        "- アプリ側ファイルは無改変(検出したAI設定資産の棚卸しは /11-brownfield-intake が行う)。",
        "",
    ]
    if warnings:
        lines += ["## 警告"] + [f"- {w}" for w in warnings] + [""]
    lines.append("## AI設定資産の検出")
    lines.append("### 実効性あり(要棚卸し: Claude Code が配下の作業時に自動で読み込む)")
    lines += [f"- `{p}` — 知識を回収したうえで `.pre-harness` へのリネームをユーザー承認つきで提案する"
              for p in effective] or ["- なし"]
    lines.append("### 旧CI(ルートの .github/workflows/ でないため実行されない)")
    lines += [f"- `{d}`({n} ファイル)— 活かすならルート移設を改修候補リストへ(取り込み時には判断しない)"
              for d, n in ci_dirs.items()] or ["- なし"]
    lines.append("### 不活性(ルート起点の探索対象外。現状維持)")
    lines += [f"- `{d}`({n} ファイル)" for d, n in inert_dirs.items()] or ["- なし"]
    lines.append("")
    if args.apply:
        lines.append("## テンプレートの .gitignore により無視されたアプリ内ファイル")
        lines += ([f"- `{p}`" for p in ignored[:20]]
                  + ([f"- 他{len(ignored) - 20}件"] if len(ignored) > 20 else [])
                  or ["- なし"])
        lines += ["", "必要なファイルが無視されている場合はルートの `.gitignore` を調整して再コミットする。", ""]
    lines.append("## 次の手順")
    if not args.apply:
        lines.append("1. 内容に問題がなければ `--apply` を付けて再実行する。")
    else:
        lines += [
            f"1. `{project}` を VS Code / Claude Code で開き、**新しいセッション**で "
            "`/11-brownfield-intake` を実行する(本レポートが入力になる)。",
            "2. その中で「AI設定資産の検出」の実効性あり一覧を棚卸しする(知識回収 → 無効化提案は人が承認)。",
            "3. as-is 文書のレビュー後、GATE_STATUS の初期化を承認する。",
            "4. リモートに置く場合: `gh repo create <名前> --private --source . --push` 等"
            "(push は確認つきの操作)。",
        ]
    lines.append("")
    report = "\n".join(lines)
    print(report)
    if args.apply:
        report_path = project / "docs/00-overview/intake-report.md"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report, encoding="utf-8", newline="\n")
        print(f"(レポートを {report_path} に書き出しました)")
        write_origin(project, harness, version)  # 以後の /91 で本体パスを省略できる
        if commit_ok:
            # レポート自体もプロジェクトの記録としてコミットに含める
            run_git(git, "add", "-A", cwd=project)
            run_git(git, "commit", "--amend", "--no-edit", cwd=project)
        else:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
