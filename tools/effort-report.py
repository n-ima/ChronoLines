#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""effort-log.csv(log-effort.pyフックが自動記録)を集計し、トークン利用レポートを生成する。

usage:
  python tools/effort-report.py                # 既定パスで生成
  python tools/effort-report.py --log PATH --out PATH

- 入力: docs/00-overview/effort-log.csv (1行 = セッション x エージェント x モデル)
- 出力: docs/06-retrospective/effort-report.md (再生成可能。effort-log.csv が正)
- 用途: /10-retrospective の「トークン効率」検証(モデル選択の適否・無駄の所在・
  独立レビューの費用対効果)。DECISIONS.md D040 参照。
"""
import argparse
import csv
import os
import sys
from collections import defaultdict
from datetime import datetime

# 単価表: USD / 1M tokens (input, output)。取得日 2026-08-02
# (https://platform.claude.com/docs/en/pricing)。改定されたらここを更新する。
# モデルIDの前方一致で解決する(日付サフィックス付きIDにも一致させるため)。
PRICES = [
    ("claude-fable-5", (10.0, 50.0)),
    ("claude-mythos", (10.0, 50.0)),
    ("claude-opus", (5.0, 25.0)),
    ("claude-sonnet", (3.0, 15.0)),
    ("claude-haiku", (1.0, 5.0)),
]
# キャッシュ単価は入力単価に対する倍率(公式: 読取~0.1x、書込5分TTL 1.25x、1時間TTL 2x)
CACHE_READ_MULT = 0.1
CACHE_W5M_MULT = 1.25
CACHE_W1H_MULT = 2.0

COLS = ["input", "output", "cache_read", "cache_w5m", "cache_w1h"]


def price_of(model):
    for prefix, p in PRICES:
        if model.startswith(prefix):
            return p
    return None


def row_cost(r):
    """(推定コストUSD, 単価既知か) を返す。"""
    p = price_of(r["model"])
    if p is None:
        return 0.0, False
    in_rate, out_rate = p
    cost = (r["input"] * in_rate
            + r["output"] * out_rate
            + r["cache_read"] * in_rate * CACHE_READ_MULT
            + r["cache_w5m"] * in_rate * CACHE_W5M_MULT
            + r["cache_w1h"] * in_rate * CACHE_W1H_MULT) / 1_000_000
    return cost, True


def load_rows(path):
    rows = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            try:
                for c in COLS:
                    r[c] = int(r.get(c) or 0)
            except (TypeError, ValueError):
                continue
            rows.append(r)
    return rows


def group(rows, key):
    g = defaultdict(lambda: {"sessions": set(), "cost": 0.0,
                             **{c: 0 for c in COLS}})
    for r in rows:
        k = key(r)
        acc = g[k]
        acc["sessions"].add(r["session_id"])
        for c in COLS:
            acc[c] += r[c]
        cost, _ = row_cost(r)
        acc["cost"] += cost
    return g


def fmt(n):
    return f"{n:,}"


def table(title, g, sort_key=None, label="区分"):
    lines = [f"## {title}", "",
             f"| {label} | セッション数 | input | output | cache_read | cache_write (5m / 1h) | 推定コスト (USD) |",
             "|---|---:|---:|---:|---:|---:|---:|"]
    keys = sorted(g.keys(), key=sort_key) if sort_key else \
        sorted(g.keys(), key=lambda k: -g[k]["cost"])
    for k in keys:
        a = g[k]
        lines.append(
            f"| {k} | {len(a['sessions'])} | {fmt(a['input'])} | {fmt(a['output'])} "
            f"| {fmt(a['cache_read'])} | {fmt(a['cache_w5m'])} / {fmt(a['cache_w1h'])} "
            f"| {a['cost']:,.2f} |")
    lines.append("")
    return lines


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--log", default=os.path.join(root, "docs", "00-overview", "effort-log.csv"))
    ap.add_argument("--out", default=os.path.join(root, "docs", "06-retrospective", "effort-report.md"))
    args = ap.parse_args()

    if not os.path.exists(args.log):
        print(f"effort-log.csv がありません: {args.log}")
        print("(Claude Code の Stop/SessionEnd フックが自動記録します。"
              "docs/00-overview/progress.md があるプロジェクトのみ対象)")
        return 1
    rows = load_rows(args.log)
    if not rows:
        print("effort-log.csv に集計対象の行がありません。")
        return 1

    dates = sorted(d for d in (r.get("date") or "" for r in rows) if d)
    total = group(rows, lambda r: "合計")
    unknown = sorted({r["model"] for r in rows if price_of(r["model"]) is None})

    lines = ["# トークン利用レポート (effort-report)", ""]
    lines.append(f"- 生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"- 対象ログ: `docs/00-overview/effort-log.csv`"
                 f"（{len({r['session_id'] for r in rows})} セッション、"
                 f"期間 {dates[0] if dates else '-'} 〜 {dates[-1] if dates else '-'}）")
    lines.append("- 自動記録の対象は Claude Code セッションのみ"
                 "（Copilot はトークン数非開示・Antigravity はフック不可のため対象外）")
    lines.append("- 推定コストはAPI従量課金換算。定額プランでも効率比較の指標として使う。"
                 "単価表は tools/effort-report.py 内（取得日 2026-08-02）。"
                 "キャッシュは 読取0.1x / 書込5分1.25x / 1時間2x を入力単価に乗算")
    if unknown:
        lines.append(f"- **単価不明のモデル**（コスト0として計上。単価表への追加が必要）: "
                     + ", ".join(f"`{m}`" for m in unknown))
    lines.append("")

    lines += table("合計", total, sort_key=lambda k: k)
    lines += table("工程（フェーズ）別", group(rows, lambda r: r.get("phase") or "other"),
                   sort_key=lambda k: (k == "other", k), label="工程")
    lines += table("エージェント別", group(rows, lambda r: r.get("agent") or "?"),
                   label="エージェント")
    lines += table("モデル別", group(rows, lambda r: r.get("model") or "?"),
                   label="モデル")

    lines.append("## 振り返りでの見方")
    lines.append("")
    lines.append("- **モデルは適切だったか**: エージェント別 x モデル別を突き合わせ、"
                 "機械的な作業(task-worker等)に高価なモデルを使っていないか、"
                 "逆に設計・レビューを安いモデルで行って手戻りしていないかを見る。")
    lines.append("- **無駄はないか**: 同一工程のセッション数が多い場合は差し戻し往復や"
                 "セッション分割の失敗を疑う。cache_read が極端に大きいセッションは"
                 "長すぎる会話(context rot帯域)の兆候。")
    lines.append("- **上流品質との相関**: 差し戻しで消えたトークンと spec-critic 1回の"
                 "トークンを比較する(独立レビューの費用対効果の実測)。")
    lines.append("")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    t = total["合計"]
    print(f"生成: {args.out}")
    print(f"  セッション数: {len(t['sessions'])} / 推定コスト合計: ${t['cost']:,.2f}")
    print(f"  input {fmt(t['input'])} / output {fmt(t['output'])} / "
          f"cache_read {fmt(t['cache_read'])} / "
          f"cache_write {fmt(t['cache_w5m'] + t['cache_w1h'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
