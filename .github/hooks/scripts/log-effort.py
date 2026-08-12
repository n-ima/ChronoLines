#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Claude Code の Stop / SessionEnd フックから呼ばれ、セッションのトークン使用量を
docs/00-overview/effort-log.csv に upsert するロガー(DECISIONS.md D040)。

設計方針:
- トランスクリプトJSONLは公式に「内部形式・バージョン間で変わりうる」とされるため、
  解析は防御的に行い、いかなる失敗でもセッションを妨げない(フック経路は常に exit 0。
  Stop フックは exit 2 がターン継続のブロックを意味するため特に厳守)。
- Stop(毎ターン終端)と SessionEnd の両方に配線し、(session_id, agent, model) をキーに
  上書き(upsert)する。何度発火しても二重計上しない。VS Code でウィンドウを突然閉じて
  SessionEnd が発火しなくても、直前ターン終端までの記録が残る。
- docs/00-overview/progress.md が存在するリポジトリ(=ハーネスで進行中のプロジェクト)
  のみ記録する。ハーネス本体リポジトリの保守セッションは記録しない。
- ストリーミング中の同一メッセージが複数行に分かれて記録されるため、message.id ごとに
  「最後に見た usage」だけを数える(後勝ち。途中経過の合算で過大計上しない)。
- 円/ドル換算はここでは行わない(単価は改定されるため、tools/effort-report.py が
  レポート生成時に単価表を掛ける)。

自己テスト: python .github/hooks/scripts/log-effort.py --selftest
"""
import csv
import glob
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone

HEADER = ["session_id", "date", "platform", "phase", "agent", "model",
          "input", "output", "cache_read", "cache_w5m", "cache_w1h", "updated_at"]
CSV_REL = os.path.join("docs", "00-overview", "effort-log.csv")
GATE_REL = os.path.join("docs", "00-overview", "progress.md")
# ハーネスのフェーズコマンド(例: /06-implement-task)。/model 等の組み込みコマンドは対象外
PHASE_RE = re.compile(r"<command-name>/?(\d{2}-[a-z0-9][a-z0-9\-]*)</command-name>")


def iter_json_lines(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except Exception:
                    continue  # 解析できない行はスキップ(内部形式の変化に耐える)
    except OSError:
        return


def usage_of(entry):
    """エントリから (message_id, model, [input,output,cache_read,w5m,w1h]) を返す。対象外は None。"""
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return None
    u = msg.get("usage")
    if not isinstance(u, dict):
        return None
    model = msg.get("model") or ""
    if not model or model == "<synthetic>":
        return None

    def n(x):
        try:
            return int(x or 0)
        except (TypeError, ValueError):
            return 0

    cc = u.get("cache_creation")
    if isinstance(cc, dict):
        w5 = n(cc.get("ephemeral_5m_input_tokens"))
        w1 = n(cc.get("ephemeral_1h_input_tokens"))
    else:
        # 旧形式フォールバック: TTL内訳が無ければ5分扱い
        w5 = n(u.get("cache_creation_input_tokens"))
        w1 = 0
    mid = msg.get("id") or entry.get("uuid") or ""
    return (mid, model,
            [n(u.get("input_tokens")), n(u.get("output_tokens")),
             n(u.get("cache_read_input_tokens")), w5, w1])


def collect_file(path):
    """1つのJSONLを走査し、message.id ごとの最終 usage を {mid: (model, [5])} で返す。"""
    last = {}
    for entry in iter_json_lines(path):
        got = usage_of(entry)
        if got:
            mid, model, vals = got
            last[mid] = (model, vals)
    return last


def detect_phase_and_date(path):
    """フェーズ(最初に起動されたフェーズコマンド)とセッション開始日を検出する。

    コマンド起動は「type=user のエントリで content が <command-name> で始まる」形で
    記録される。生テキスト走査だと、会話やツール入力の中で <command-name> に言及した
    だけの箇所を誤検出するため、必ずこの形に絞って判定する。"""
    phase, date = "other", ""
    for entry in iter_json_lines(path):
        if not date:
            ts = entry.get("timestamp") or ""
            if isinstance(ts, str) and len(ts) >= 10:
                date = ts[:10]
        if phase == "other" and entry.get("type") == "user":
            msg = entry.get("message")
            content = msg.get("content") if isinstance(msg, dict) else None
            if isinstance(content, list):
                text = " ".join(b.get("text", "") for b in content if isinstance(b, dict))
            elif isinstance(content, str):
                text = content
            else:
                text = ""
            text = text.lstrip()
            # 実記録は <command-message>...</command-message>\n<command-name>/xx</command-name>
            # または <command-name> 先頭の2形がある
            if text.startswith("<command-"):
                m = PHASE_RE.search(text)
                if m:
                    phase = m.group(1)
        if date and phase != "other":
            break
    return phase, date


def subagent_type_map(path):
    """メインJSONLから agentId -> サブエージェント種別 の対応を組み立てる(best effort)。
    Task/Agent ツールの tool_use(input.subagent_type) と、対応する tool_result の
    文面中の agentId を突き合わせる。取れなくても致命ではない(フォールバックあり)。"""
    use_type = {}    # tool_use_id -> subagent_type
    agent_type = {}  # agent_id -> subagent_type
    aid_re = re.compile(r"agentId:\s*([0-9a-fA-F]+)")
    for entry in iter_json_lines(path):
        msg = entry.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" and block.get("name") in ("Task", "Agent"):
                st = (block.get("input") or {}).get("subagent_type")
                if st and block.get("id"):
                    use_type[block["id"]] = st
            elif block.get("type") == "tool_result":
                tid = block.get("tool_use_id")
                if tid not in use_type:
                    continue
                texts = block.get("content")
                if isinstance(texts, str):
                    joined = texts
                elif isinstance(texts, list):
                    joined = " ".join(t.get("text", "") for t in texts if isinstance(t, dict))
                else:
                    joined = ""
                m = aid_re.search(joined)
                if m:
                    agent_type[m.group(1)] = use_type[tid]
    return agent_type


def subagent_label(path, agent_type):
    """subagents/agent-<id>.jsonl のエージェント種別を決める。
    優先順: メイン側の対応表 -> エントリの attributionAgent -> "subagent"。"""
    base = os.path.basename(path)
    m = re.match(r"agent-([0-9a-fA-F]+)\.jsonl$", base)
    if m and m.group(1) in agent_type:
        return agent_type[m.group(1)]
    for entry in iter_json_lines(path):
        a = entry.get("attributionAgent")
        if a:
            return str(a)
    return "subagent"


def aggregate(session_id, transcript_path):
    """セッション(メイン+サブエージェント)を集計してCSV行のリストを返す。"""
    totals = {}  # (agent, model) -> [input,output,cache_read,w5m,w1h]

    def add(agent, per_msg):
        for model, vals in per_msg.values():
            acc = totals.setdefault((agent, model), [0, 0, 0, 0, 0])
            for i, v in enumerate(vals):
                acc[i] += v

    add("main", collect_file(transcript_path))
    base = os.path.splitext(transcript_path)[0]
    sub_files = sorted(glob.glob(os.path.join(base, "subagents", "*.jsonl")))
    amap = subagent_type_map(transcript_path) if sub_files else {}
    for p in sub_files:
        add(subagent_label(p, amap), collect_file(p))

    if not totals:
        return []
    phase, date = detect_phase_and_date(transcript_path)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    for (agent, model), v in sorted(totals.items()):
        rows.append({
            "session_id": session_id, "date": date, "platform": "claude-code",
            "phase": phase, "agent": agent, "model": model,
            "input": v[0], "output": v[1], "cache_read": v[2],
            "cache_w5m": v[3], "cache_w1h": v[4], "updated_at": now,
        })
    return rows


def upsert(csv_path, session_id, rows):
    """同一 session_id の既存行を差し替えて書き戻す(一時ファイル経由で原子的に)。"""
    existing = []
    if os.path.exists(csv_path):
        try:
            with open(csv_path, "r", encoding="utf-8", newline="") as f:
                for r in csv.DictReader(f):
                    if r.get("session_id") != session_id:
                        existing.append(r)
        except Exception:
            return  # 既存CSVが読めないときは上書きしない(過去データ保護を優先)
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(csv_path), suffix=".effortlog.tmp")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=HEADER)
            w.writeheader()
            for r in existing:
                w.writerow({k: r.get(k, "") for k in HEADER})
            for r in rows:
                w.writerow(r)
        os.replace(tmp_path, csv_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def main():
    try:
        # PowerShell 5.1 のパイプ経由だと先頭に UTF-8 BOM が付くことがあるため除去する
        payload = json.loads(sys.stdin.read().lstrip(chr(0xFEFF)))
    except Exception:
        return
    session_id = payload.get("session_id") or ""
    transcript = payload.get("transcript_path") or ""
    cwd = payload.get("cwd") or os.getcwd()
    if not session_id or not transcript or not os.path.exists(transcript):
        return
    if not os.path.exists(os.path.join(cwd, GATE_REL)):
        return  # 進行中プロジェクトのみ記録(ハーネス本体リポジトリ等では何もしない)
    rows = aggregate(session_id, transcript)
    if rows:
        upsert(os.path.join(cwd, CSV_REL), session_id, rows)


# ---------------------------------------------------------------- selftest

def selftest():
    """一時ディレクトリにフィクスチャを作り、集計・フェーズ検出・重複排除・upsert冪等性を検証する。"""
    import shutil
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + name + (f" ({detail})" if detail and not cond else ""))
        ok = ok and cond

    tmp = tempfile.mkdtemp(prefix="effortlog-selftest-")
    try:
        proj = os.path.join(tmp, "proj")
        os.makedirs(os.path.join(proj, "docs", "00-overview"))
        with open(os.path.join(proj, GATE_REL), "w", encoding="utf-8") as f:
            f.write("# progress\n")

        tdir = os.path.join(tmp, "transcripts")
        os.makedirs(os.path.join(tdir, "sess1", "subagents"))
        main_path = os.path.join(tdir, "sess1.jsonl")

        def entry(**kw):
            return json.dumps(kw, ensure_ascii=False)

        lines = [
            # ツール入力の中の <command-name> 言及はフェーズ判定に使ってはならない
            # (実セッションで誤検出した実例があるための回帰テスト)
            entry(type="assistant", timestamp="2026-08-02T00:00:00.000Z", message={
                "id": "m0", "model": "claude-fable-5", "role": "assistant",
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "content": [{"type": "tool_use", "id": "w1", "name": "Write",
                             "input": {"content":
                                       "<command-name>/09-release-checklist</command-name>"}}]}),
            # フェーズコマンド(user エントリ・実記録と同じ command-message 先頭の形)
            entry(type="user",
                  message={"role": "user",
                           "content": "<command-message>06-implement-task</command-message>\n"
                                      "<command-name>/06-implement-task</command-name>\n"
                                      "<command-args></command-args>"}),
            # ストリーミング途中経過(後勝ちで out=50 のみ数えるべき)
            entry(type="assistant", message={
                "id": "m1", "model": "claude-fable-5", "role": "assistant",
                "usage": {"input_tokens": 100, "output_tokens": 5,
                          "cache_read_input_tokens": 50,
                          "cache_creation": {"ephemeral_5m_input_tokens": 10,
                                             "ephemeral_1h_input_tokens": 20}}}),
            entry(type="assistant", message={
                "id": "m1", "model": "claude-fable-5", "role": "assistant",
                "usage": {"input_tokens": 100, "output_tokens": 50,
                          "cache_read_input_tokens": 50,
                          "cache_creation": {"ephemeral_5m_input_tokens": 10,
                                             "ephemeral_1h_input_tokens": 20}}}),
            # synthetic は無視
            entry(type="assistant", message={
                "id": "m2", "model": "<synthetic>", "role": "assistant",
                "usage": {"input_tokens": 999, "output_tokens": 999}}),
            # Task呼び出し -> tool_result に agentId (種別マッピング用)
            entry(type="assistant", message={
                "id": "m3", "model": "claude-fable-5", "role": "assistant",
                "usage": {"input_tokens": 1, "output_tokens": 1,
                          "cache_read_input_tokens": 0},
                "content": [{"type": "tool_use", "id": "t1", "name": "Task",
                             "input": {"subagent_type": "task-worker"}}]}),
            entry(type="user", message={
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "t1",
                             "content": [{"type": "text",
                                          "text": "launched. agentId: abc12345 (internal)"}]}]}),
            "{broken json line",  # 壊れた行はスキップされる
        ]
        with open(main_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        with open(os.path.join(tdir, "sess1", "subagents", "agent-abc12345.jsonl"),
                  "w", encoding="utf-8") as f:
            f.write(entry(type="assistant", isSidechain=True,
                          attributionAgent="should-not-be-used",
                          message={"id": "s1", "model": "claude-sonnet-5",
                                   "role": "assistant",
                                   "usage": {"input_tokens": 10, "output_tokens": 20,
                                             "cache_read_input_tokens": 0}}) + "\n")

        rows = aggregate("sess1", main_path)
        by = {(r["agent"], r["model"]): r for r in rows}
        check("rows: main + task-worker の2行", len(rows) == 2, str(by.keys()))
        m = by.get(("main", "claude-fable-5"))
        check("main: 後勝ちで重複排除 (in=102,out=52)",
              bool(m) and m["input"] == 102 and m["output"] == 52, str(m))
        check("main: cache内訳 (read=50,w5m=10,w1h=20)",
              bool(m) and m["cache_read"] == 50 and m["cache_w5m"] == 10 and m["cache_w1h"] == 20, str(m))
        t = by.get(("task-worker", "claude-sonnet-5"))
        check("subagent: agentId->種別マッピング優先", bool(t) and t["input"] == 10, str(t))
        check("フェーズ検出", bool(rows) and rows[0]["phase"] == "06-implement-task", str(rows[0] if rows else None))
        check("フェーズ: ツール入力中の <command-name> 言及に汚染されない(回帰)",
              all(r["phase"] != "09-release-checklist" for r in rows))
        check("開始日検出", bool(rows) and rows[0]["date"] == "2026-08-02")

        # upsert 冪等性 + 他セッション行の保持
        csv_path = os.path.join(proj, CSV_REL)
        other = {k: "" for k in HEADER}
        other.update(session_id="sessX", agent="main", model="claude-haiku-4-5",
                     input=1, output=1, cache_read=0, cache_w5m=0, cache_w1h=0)
        upsert(csv_path, "sessX", [other])
        upsert(csv_path, "sess1", rows)
        upsert(csv_path, "sess1", rows)  # 2回目(再発火想定)
        with open(csv_path, "r", encoding="utf-8", newline="") as f:
            got = list(csv.DictReader(f))
        check("upsert: 冪等(3行: sessX 1 + sess1 2)", len(got) == 3,
              str([(r["session_id"], r["agent"]) for r in got]))
        check("upsert: 他セッション行を保持",
              any(r["session_id"] == "sessX" for r in got))

        # progress.md が無いリポジトリでは記録しない
        proj2 = os.path.join(tmp, "proj2")
        os.makedirs(os.path.join(proj2, "docs", "00-overview"))
        payload = {"session_id": "sess1", "transcript_path": main_path, "cwd": proj2}
        sys.stdin = __import__("io").StringIO(json.dumps(payload))
        main()
        check("progress.md ゲート: 未作成なら記録しない",
              not os.path.exists(os.path.join(proj2, CSV_REL)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("SELFTEST " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
