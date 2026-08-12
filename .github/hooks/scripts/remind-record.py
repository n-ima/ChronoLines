#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Claude Code の Stop フックから呼ばれ、「アプリのコードを変更したのに docs/ に何も
記録していない」状態でターンを終えようとしたら1回だけブロックして記録を促す(D043決定6)。

設計方針:
- 教訓・台帳(change-requests.md)・tasks.md への記録は「気づいたら書く」任せでは
  実測で書かれなかった(改善の記録が一切残らない失敗の直接原因)。終了時に機械的な
  トリガを与える。モデルを介さないためコストはほぼゼロ。
- git status ではなくトランスクリプト解析で「このセッションでの編集」だけを見る
  (作業ツリーに元からある未コミット変更で毎ターン誤発火させないため)。
- stop_hook_active が真なら即継続(ブロック→応答→再Stopの無限ループ防止)。
- docs/00-overview/progress.md があるプロジェクトのみ対象(ハーネス本体は対象外)。
- 判定は保守的に: サブエージェント(task-worker)内の編集はメインのトランスクリプトに
  現れないため検知できない(誤発火しない側に倒れる)。docs/ 配下のどこかを1回でも
  編集していれば「記録あり」とみなす(実装フェーズの tasks.md 更新も記録に数える)。
- 解析はいかなる失敗でも継続(exit 0 + 出力なし)。Stop フックのブロックは
  {"decision": "block", "reason": "..."} のJSON出力で行う。
"""
import json
import os
import sys

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# ハーネス管理領域(ここへの編集は「記録」または「ハーネス自身の作業」とみなす)。
# guard-phase-scope.sh の許可パターンと同じ考え方。
HARNESS_PARTS = ("/docs/", "/requirements/", "/.github/", "/.claude/", "/.agents/",
                 "/tools/", "/.vscode/", "/temp/", "/tmp/")
HARNESS_SUFFIX = ("readme.md", ".gitignore", ".gitattributes", "decisions.md", "memory.md")


def norm(path):
    return path.replace("\\", "/").lower()


def classify(paths, cwd):
    """(app_edits, docs_edits) を数える。リポジトリ外(スクラッチパッド等)は対象外。"""
    root = norm(os.path.abspath(cwd)).rstrip("/") + "/"
    app = docs = 0
    for p in paths:
        n = norm(os.path.abspath(os.path.join(cwd, p)) if not os.path.isabs(p) else p)
        if not n.startswith(root):
            continue
        rel = "/" + n[len(root):]
        if "/docs/" in rel:
            docs += 1
        elif rel.endswith(HARNESS_SUFFIX) or any(part in rel for part in HARNESS_PARTS):
            continue
        else:
            app += 1
    return app, docs


def main():
    # WindowsのstdoutはcodepageがCP932になりうる。フック出力のJSONはUTF-8で返す
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        payload = json.loads(sys.stdin.read().lstrip(chr(0xFEFF)))
    except Exception:
        return
    if payload.get("stop_hook_active"):
        return
    cwd = payload.get("cwd") or os.getcwd()
    if not os.path.exists(os.path.join(cwd, "docs", "00-overview", "progress.md")):
        return
    transcript = payload.get("transcript_path") or ""
    if not transcript or not os.path.exists(transcript):
        return

    paths = []
    try:
        with open(transcript, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or '"tool_use"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                content = (entry.get("message") or {}).get("content")
                if not isinstance(content, list):
                    continue
                for item in content:
                    if (isinstance(item, dict) and item.get("type") == "tool_use"
                            and item.get("name") in EDIT_TOOLS):
                        inp = item.get("input") or {}
                        fp = inp.get("file_path") or inp.get("notebook_path") or ""
                        if fp:
                            paths.append(fp)
    except Exception:
        return

    app, docs = classify(paths, cwd)
    if app > 0 and docs == 0:
        print(json.dumps({
            "decision": "block",
            "reason": ("このセッションでアプリのコードを変更しましたが、docs/ に記録がありません。"
                       "終了する前に該当する記録を残してください: 変更請求なら "
                       "docs/00-overview/change-requests.md の台帳更新、実装タスクなら "
                       "docs/03-implementation/tasks.md、確立した実行方法や受けた訂正は "
                       "docs/00-overview/learnings.md に1行。記録が本当に不要な場合は、"
                       "その理由を1行ユーザーに説明してから終了してください。")
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
