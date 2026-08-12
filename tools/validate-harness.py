"""ハーネスの構成整合性を機械検査する。

チェック内容:
- agents/prompts/skills の frontmatter (description必須、tools alias、agents許可リスト、
  handoffs の参照先、prompt の agent: バインディング、skill name/description 規則)
- hooks JSON のパースと参照スクリプトの実在
- マルチプラットフォームアダプタ (.claude/commands|agents|skills、.agents/workflows) の
  欠落・description乖離 (乖離があれば tools/generate-adapters.py で再生成する)

使い方(リポジトリルートで):
    python tools/validate-harness.py

終了コード: エラーがあれば1、なければ0。
依存: Python 3.x + PyYAML (pip install pyyaml)
"""
import re
import sys
import json
import glob
import os

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []
warnings = []


def read_frontmatter(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.DOTALL)
    if not m:
        errors.append(f"{path}: frontmatter not found or malformed")
        return None, text
    try:
        fm = yaml.safe_load(m.group(1))
    except Exception as e:
        errors.append(f"{path}: YAML parse error: {e}")
        return None, text
    return fm, text[m.end():]


VALID_TOOL_ALIASES = {"execute", "read", "edit", "search", "agent", "web", "todo", "playwright"}

agent_files = glob.glob(os.path.join(ROOT, ".github", "agents", "*.agent.md"))
agent_names = {os.path.basename(f).replace(".agent.md", "") for f in agent_files}

for f in agent_files:
    fm, _ = read_frontmatter(f)
    if fm is None:
        continue
    if "description" not in fm:
        errors.append(f"{f}: missing 'description'")
    tools = fm.get("tools", [])
    for t in tools:
        if t not in VALID_TOOL_ALIASES:
            errors.append(f"{f}: unknown tool alias '{t}'")
    if "agents" in fm:
        allowed = fm["agents"]
        if allowed not in ("*", []) and isinstance(allowed, list):
            for a in allowed:
                if a not in agent_names:
                    errors.append(f"{f}: agents whitelist references unknown agent '{a}'")
            if allowed and "agent" not in tools:
                errors.append(f"{f}: has agents whitelist {allowed} but tools missing 'agent' alias")
    else:
        warnings.append(f"{f}: no 'agents' field (consider explicit least-privilege)")
    for h in fm.get("handoffs", []) or []:
        if h.get("agent") not in agent_names:
            errors.append(f"{f}: handoff target '{h.get('agent')}' does not exist")
        for req in ("label", "prompt"):
            if req not in h:
                errors.append(f"{f}: handoff missing '{req}'")
        if "send" not in h:
            warnings.append(f"{f}: handoff to '{h.get('agent')}' missing explicit 'send'")

prompt_files = glob.glob(os.path.join(ROOT, ".github", "prompts", "*.prompt.md"))
for f in prompt_files:
    fm, _ = read_frontmatter(f)
    if fm is None:
        continue
    if "description" not in fm:
        errors.append(f"{f}: missing 'description'")
    agent = fm.get("agent")
    if not agent:
        errors.append(f"{f}: missing 'agent' binding")
    elif agent not in agent_names:
        errors.append(f"{f}: agent binding '{agent}' does not exist")
    if "mode" in fm:
        warnings.append(f"{f}: legacy 'mode' field present")
    if "tools" in fm:
        warnings.append(f"{f}: redundant 'tools' field (inherited from bound agent)")

skill_files = glob.glob(os.path.join(ROOT, ".github", "skills", "*", "SKILL.md"))
for f in skill_files:
    fm, _ = read_frontmatter(f)
    if fm is None:
        continue
    folder = os.path.basename(os.path.dirname(f))
    name = fm.get("name")
    if name != folder:
        errors.append(f"{f}: name '{name}' != folder '{folder}'")
    if not name or not re.match(r"^[a-z0-9-]{1,64}$", name):
        errors.append(f"{f}: invalid name '{name}'")
    desc = fm.get("description", "")
    if not desc:
        errors.append(f"{f}: missing description")
    elif len(desc) > 1024:
        errors.append(f"{f}: description exceeds 1024 chars")

json_files = [
    os.path.join(ROOT, "plugin.json"),
    os.path.join(ROOT, ".github", "hooks", "gate-hooks.json"),
    os.path.join(ROOT, ".github", "hooks", "security-hooks.json"),
    os.path.join(ROOT, ".vscode", "settings.json"),
    os.path.join(ROOT, ".claude", "settings.json"),
]
for f in json_files:
    try:
        text = open(f, encoding="utf-8").read()
        stripped = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
        json.loads(stripped)
    except Exception as e:
        errors.append(f"{f}: JSON parse error: {e}")

for hooks_file in [os.path.join(ROOT, ".github", "hooks", "gate-hooks.json"),
                   os.path.join(ROOT, ".github", "hooks", "security-hooks.json"),
                   os.path.join(ROOT, ".claude", "settings.json")]:
    try:
        text = open(hooks_file, encoding="utf-8").read()
        stripped = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
        data = json.loads(stripped)
    except Exception:
        continue
    blob = json.dumps(data)
    for m in re.finditer(r"\.github/hooks/scripts/[\w.-]+", blob):
        p = os.path.join(ROOT, m.group(0).replace("/", os.sep))
        if not os.path.exists(p):
            errors.append(f"{hooks_file}: referenced script missing: {m.group(0)}")

# ---- multi-platform adapters
for sf in skill_files:
    fm, _ = read_frontmatter(sf)
    if fm is None:
        continue
    name = fm.get("name")
    adapter = os.path.join(ROOT, ".claude", "skills", name, "SKILL.md")
    if not os.path.exists(adapter):
        errors.append(f".claude/skills/{name}/SKILL.md: adapter missing (run tools/generate-adapters.py)")
    else:
        afm, _ = read_frontmatter(adapter)
        if afm and afm.get("description") != fm.get("description"):
            warnings.append(f".claude/skills/{name}: description differs (run tools/generate-adapters.py)")

for pf in prompt_files:
    base = os.path.basename(pf).replace(".prompt.md", "")
    for adapter in [os.path.join(ROOT, ".claude", "commands", f"{base}.md"),
                    os.path.join(ROOT, ".agents", "workflows", f"{base}.md")]:
        if not os.path.exists(adapter):
            errors.append(f"{os.path.relpath(adapter, ROOT)}: adapter missing (run tools/generate-adapters.py)")

for sub in ["reviewer", "spec-critic", "task-worker"]:
    if not os.path.exists(os.path.join(ROOT, ".claude", "agents", f"{sub}.md")):
        errors.append(f".claude/agents/{sub}.md: subagent adapter missing")

print("=== ERRORS ===")
for e in errors:
    print("ERROR:", e)
print(f"total errors: {len(errors)}")
print("=== WARNINGS ===")
for w in warnings:
    print("WARN:", w)
print(f"total warnings: {len(warnings)}")
sys.exit(1 if errors else 0)
