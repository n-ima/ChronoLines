#!/usr/bin/env bash
# UserPromptSubmit hook: ユーザーの依頼のたびに、ゲート状況の要約と受付ルーチンの契約を注入する。
# SessionStart の1回だけの注入は会話が伸びるほど薄まり、ハーネス外の場当たり作業に落ちる
# 失敗が実測されたため(D043)、依頼のたびに短く注入する。モデルを介さないため追加コストは
# 注入テキスト分のみ。長文にしない(毎ターン送られる)。
# Claude Code 専用(Copilot のフックに UserPromptSubmit 相当のイベントは無い。D043追加7)。
progress="docs/00-overview/progress.md"

ctx=""
if [[ -f "$progress" ]]; then
  # GATE_STATUS を1行に要約する
  vals=$(awk '/<!-- GATE_STATUS/,/-->/' "$progress" | grep -E '^(requirements|design|implementation|test|release):' | sed -E 's/^([a-z]+):[[:space:]]*/\1=/' | tr '\n' ' ')
  ctx="[受付ルーチン] ゲート状況: ${vals}"
  if printf '%s' "$vals" | grep -q 'in_progress\|pending_approval'; then
    ctx="${ctx}\n進行中フェーズの作業はそのフェーズのコマンドで続行する。新しい種類の依頼を受けたら request-routing スキルに従い、応答の冒頭で「分類/入口/影響」を宣言してから入口コマンドをSkillツールで自分で起動すること。"
  elif printf '%s' "$vals" | grep -qE 'requirements=done design=done implementation=done test=done release=done'; then
    ctx="${ctx}（全done=運用中）\n変更依頼の入口は /12-change-request。依頼を受けたら request-routing スキルに従い、応答の冒頭で「分類/入口/影響」を宣言してから入口コマンドをSkillツールで自分で起動すること（ユーザーにコマンドを打たせない）。"
  else
    ctx="${ctx}\n依頼を受けたら request-routing スキルに従い、応答の冒頭で「分類/入口/影響」を宣言してから入口コマンドをSkillツールで自分で起動すること。"
  fi
elif [[ -f "docs/00-overview/intake-report.md" ]]; then
  # 取り込み済み・/11未完了。intake由来の DECISIONS.md を持つため本体検知より先に判定(D044)
  ctx="[受付ルーチン] 取り込み済み・未初期化(intake-report.md あり)。依頼の前に /11-brownfield-intake をSkillツールで起動して as-is 逆起こしとゲート初期化を完了すること。"
elif [[ -f "DECISIONS.md" ]]; then
  # ハーネス本体リポジトリ。アプリ開発の受付契約は注入しない(SessionStartの案内で足りる)
  exit 0
else
  ctx="[受付ルーチン] progress.md 未作成。新規開発なら /00-start-project、既存アプリの取り込みなら /11-brownfield-intake をSkillツールで起動する（既存コードがあるのに /00 を実行しない）。"
fi

esc=$(printf '%b' "$ctx" | sed ':a;N;$!ba;s/\n/\\n/g' | sed 's/"/\\"/g')
printf '{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "%s"}}\n' "$esc"
