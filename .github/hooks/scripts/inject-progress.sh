#!/usr/bin/env bash
# SessionStart/PreCompact hook: フェーズゲート状況(GATE_STATUS)と教訓ログ(learnings)を
# 会話開始時およびコンテキスト圧縮前に自動注入する(圧縮で注入済み情報が失われる穴を塞ぐ)。
event="${1:-SessionStart}"
progress="docs/00-overview/progress.md"
learnings="docs/00-overview/learnings.md"

ctx=""
if [[ -f "$progress" ]]; then
  block=$(awk '/<!-- GATE_STATUS/,/-->/' "$progress")
  ctx="現在のフェーズゲート状況(docs/00-overview/progress.md):\n${block}"
  # 全フェーズ done = 運用中。次の依頼の入口を明示する(入口が示されないと場当たり作業に落ちる)
  done_count=$(printf '%s\n' "$block" | grep -Ec '^(requirements|design|implementation|test|release):[[:space:]]*done' || true)
  if [[ "$done_count" -eq 5 ]]; then
    ctx="${ctx}\n全フェーズ done = 運用中です。変更依頼の入口は /12-change-request(受付の振り分けは request-routing スキル参照)。"
  fi
elif [[ -f "docs/00-overview/intake-report.md" ]]; then
  # 取り込み済み・/11未完了のプロジェクト。intake由来の DECISIONS.md を持つため、
  # この判定は DECISIONS.md(本体検知)より先に行う(順序を入れ替えると本体と誤認する。D044)
  ctx="既存アプリの取り込みが完了していません(intake-report.md あり・progress.md なし)。新しいセッションで /11-brownfield-intake を実行してください(as-is逆起こし → 整合検証 → ゲート初期化。intake-report.md が入力になります)。"
elif [[ -f "DECISIONS.md" ]]; then
  # ハーネス本体リポジトリ(progress.md なし・DECISIONS.md あり)。アプリ開発の入口を案内しない
  ctx="ここはハーネス本体リポジトリです(progress.md なし・DECISIONS.md あり)。アプリ開発の入口(/00, /11, /12)は使いません。振り返りの還流適用は /90-apply-retrospective、ハーネス設定の変更は人間が tools/harness-maintenance.py で保守モードにしてから行います。"
else
  # brownfield(既存アプリ持ち込み)に /00 を案内すると、グリーンフィールドの一本道が
  # 始まってしまう(実装済みコードを無視した要件ヒアリング)。必ず両論併記する。
  ctx="docs/00-overview/progress.md が未作成です。新規開発なら /00-start-project、既存アプリの取り込みなら /11-brownfield-intake を実行してください(既存コードがあるのに /00 を実行しない)。"
fi

if [[ -f "$learnings" ]]; then
  # 「## 教訓」以降の箇条書きを注入する。肥大化対策の上限は「新しい50件」(tail)。
  # 以前は先頭(=最古)50件で打ち切っており、新しい教訓ほど注入されない欠陥があった
  # (総数207件のうち157件が一度も注入されないまま全工程が終わった実例あり)。
  # 上限を超えたら、打ち切ったことを注入文に必ず明示する(silentに取りこぼさない)。
  all=$(awk '/^## 教訓/{flag=1;next}flag' "$learnings" | grep -E '^- ')
  total=0
  [[ -n "$all" ]] && total=$(printf '%s\n' "$all" | wc -l | tr -d '[:space:]')
  lessons=$(printf '%s\n' "$all" | tail -50)
  if [[ -n "$lessons" ]]; then
    ctx="${ctx}\n\nこのプロジェクトの教訓(docs/00-overview/learnings.md、必ず前提として扱うこと):\n${lessons}"
    if [[ "$total" -gt 50 ]]; then
      ctx="${ctx}\n（教訓 ${total}件中 新しい50件のみ表示。全文は docs/00-overview/learnings.md。上限到達につき振り返りでの棚卸しを推奨）"
    fi
  fi
fi

esc=$(printf '%b' "$ctx" | sed ':a;N;$!ba;s/\n/\\n/g' | sed 's/"/\\"/g')
printf '{"hookSpecificOutput": {"hookEventName": "%s", "additionalContext": "%s"}}\n' "$event" "$esc"
