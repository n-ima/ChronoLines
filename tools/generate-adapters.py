"""Copilot正レイヤ(.github/)からClaude Code/Antigravity用の薄いアダプタを再生成する。

アダプタは振る舞いを持たず、正のファイルへのポインタのみ(等価性ルールのプラットフォーム拡張)。
冪等: 再実行すると全アダプタを上書き再生成する。

使い方(リポジトリルートで):
    python tools/generate-adapters.py

いつ実行するか:
- .github/prompts/ にプロンプトを追加・改名した / description を変えたとき
- .github/skills/ にスキルを追加した / description を変えたとき
- .github/agents/ のサブエージェント(reviewer/spec-critic/task-worker)の description を変えたとき

実行後は tools/validate-harness.py で乖離が無いことを確認する。
依存: Python 3.x + PyYAML (pip install pyyaml)
"""
import re
import os
import glob

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_frontmatter(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.DOTALL)
    return yaml.safe_load(m.group(1))


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("wrote:", os.path.relpath(path, ROOT))


# ---- 1. Claude Code commands (.claude/commands/) & Antigravity workflows (.agents/workflows/)
prompt_files = sorted(glob.glob(os.path.join(ROOT, ".github", "prompts", "*.prompt.md")))
for pf in prompt_files:
    fm = read_frontmatter(pf)
    base = os.path.basename(pf).replace(".prompt.md", "")
    agent = fm["agent"]
    desc = fm["description"]
    prompt_rel = f".github/prompts/{os.path.basename(pf)}"
    agent_rel = f".github/agents/{agent}.agent.md"

    cmd = f"""---
description: '{desc}'
---

このコマンドは薄いアダプタです。振る舞いの正は参照先にあります。

1. `{agent_rel}` を読み、その役割定義に従ってこの会話のロールを設定してください。
2. その上で `{prompt_rel}` の本文の指示を実行してください。
3. 役割定義の中の `runSubagent` は、Claude Code では **Task ツール**で
   `.claude/agents/` の同名サブエージェント(reviewer / task-worker / spec-critic)を
   呼ぶことに読み替えてください。ハンドオフボタンは存在しないため、フェーズ移行の案内は
   「新しいセッションで /<コマンド名> を実行」の形にしてください。
"""
    write(os.path.join(ROOT, ".claude", "commands", f"{base}.md"), cmd)

    wf = f"""---
description: '{desc}'
---

このワークフローは薄いアダプタです。振る舞いの正は参照先にあります。

1. `{agent_rel}` を読み、その役割定義に従って振る舞ってください。
2. その上で `{prompt_rel}` の本文の指示を実行してください。
3. 役割定義の中の `runSubagent`(独立コンテキストでのレビュー・実装分離)は、
   Antigravity では **Agent Manager で別のエージェント会話として実行**し、
   結果を受け取って続行することに読み替えてください(同一会話で続ける場合は、
   独立性が失われることをユーザーに伝えたうえで行うこと)。
   ハンドオフボタンは存在しないため、フェーズ移行の案内は
   「新しいエージェント会話で /<ワークフロー名> を実行」の形にしてください。
4. フック(機械的ガードレール)はこの環境では発火しません(Antigravity IDEはプロジェクト内の
   スクリプトフックを読まない・実機検証済みの知見)。AGENTS.md の指示レベルのルール
   (テンプレート直接編集の禁止・push/tag等の事前確認・シークレット非記載)を自分の判断で
   厳守してください。機械的な保護が必要な場合、ユーザーに IDE の Deny List
   (Settings → Permissions → Advanced)への危険コマンド登録を案内してください。
"""
    write(os.path.join(ROOT, ".agents", "workflows", f"{base}.md"), wf)

# ---- 2. Claude Code subagents (.claude/agents/)
SUBAGENTS = {
    "reviewer": "Read, Grep, Glob",
    "spec-critic": "Read, Grep, Glob",
    "task-worker": "Read, Edit, Write, Grep, Glob, Bash",
}
for name, tools in SUBAGENTS.items():
    src = os.path.join(ROOT, ".github", "agents", f"{name}.agent.md")
    fm = read_frontmatter(src)
    desc = fm["description"]
    body = f"""---
name: {name}
description: {desc}
tools: {tools}
---

あなたは {name} サブエージェントです。このファイルは薄いアダプタであり、
振る舞いの正は `.github/agents/{name}.agent.md` にあります。

最初に必ず `.github/agents/{name}.agent.md` を読み、その役割定義・観点・出力形式・
制約(読み取り専用かどうか等)に厳密に従って作業してください。
"""
    write(os.path.join(ROOT, ".claude", "agents", f"{name}.md"), body)

# ---- 3. Claude Code skill adapters (.claude/skills/)
skill_files = sorted(glob.glob(os.path.join(ROOT, ".github", "skills", "*", "SKILL.md")))
for sf in skill_files:
    fm = read_frontmatter(sf)
    name = fm["name"]
    desc = fm["description"]
    body = f"""---
name: {name}
description: {desc}
---

このスキルの本文の正は `.github/skills/{name}/SKILL.md` です。
それを読み、その手順・チェックリストに従ってください(このファイルはClaude Codeが
`.claude/skills/` しか探索しないために置いてある薄いポインタです)。
"""
    write(os.path.join(ROOT, ".claude", "skills", name, "SKILL.md"), body)

print("done")
