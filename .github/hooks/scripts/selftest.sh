#!/usr/bin/env bash
# フック自己テスト: 代表ペイロード(クォート入りコマンド / \ 区切りパス / / 区切りパス /
# 無害な入力)を各ガードスクリプトに流し、期待する判定が返るかを突き合わせる。
# フックは壊れていても静かに通る(fail-open)設計のため、「判定ログが空」なのが
# 「発火する場面が無かった」のか「壊れている」のかを切り分ける唯一の手段。
# 使い方: bash .github/hooks/scripts/selftest.sh  (全PASSなら exit 0)
# 注意: 実行すると判定ログ(logs/hook-decisions.log)にテスト分の行が入る(ローカルのみ・無害)。
set -u
cd "$(dirname "$0")" || exit 1
scripts_dir=$(pwd)
pass=0; fail=0

check() { # $1=説明 $2=スクリプト $3=ペイロード $4=期待判定(ask|deny|warn|allow) $5=実行cwd(省略時=scripts)
  local dir="${5:-$scripts_dir}" out ok=1
  out=$(cd "$dir" && printf '%s' "$3" | bash "$scripts_dir/$2" 2>/dev/null)
  case "$4" in
    ask|deny)
      printf '%s' "$out" | grep -q "\"permissionDecision\": \"$4\"" && ok=0 ;;
    warn)
      printf '%s' "$out" | grep -q '"systemMessage"' && ok=0 ;;
    allow)
      printf '%s' "$out" | grep -qE '"(permissionDecision|systemMessage)"' || ok=0 ;;
  esac
  if [[ $ok -eq 0 ]]; then
    pass=$((pass+1)); echo "PASS: $1"
  else
    fail=$((fail+1)); echo "FAIL: $1"; echo "  expected: $4"; echo "  got: $out"
  fi
}

# --- guard-dangerous-git: クォート入りコマンドでも危険判定に届くこと(fail-openの再現ペイロード) ---
check "dangerous-git: quoted cd + git push -> ask" guard-dangerous-git.sh \
  '{"tool_input":{"command":"cd \"D:/proj\" && git push origin main"}}' ask
check "dangerous-git: plain git push -> ask" guard-dangerous-git.sh \
  '{"tool_input":{"command":"git push origin main"}}' ask
check "dangerous-git: git tag -> ask" guard-dangerous-git.sh \
  '{"tool_input":{"command":"git tag -a v1.0.0 -m x"}}' ask
check "dangerous-git: harmless git status -> allow" guard-dangerous-git.sh \
  '{"tool_input":{"command":"git status"}}' allow
# D046: グローバルオプション経由・フラグ順不同の迂回パターンの回帰テスト
check "dangerous-git: git -C path push -> ask" guard-dangerous-git.sh \
  '{"tool_input":{"command":"git -C /some/repo push origin main"}}' ask
check "dangerous-git: git --git-dir=x tag -> ask" guard-dangerous-git.sh \
  '{"tool_input":{"command":"git --git-dir=/r/.git tag v1"}}' ask
check "dangerous-git: rm -fr -> ask" guard-dangerous-git.sh \
  '{"tool_input":{"command":"rm -fr build"}}' ask
check "dangerous-git: rm -r -f -> ask" guard-dangerous-git.sh \
  '{"tool_input":{"command":"rm -r -f build"}}' ask
check "dangerous-git: rm -r only -> allow" guard-dangerous-git.sh \
  '{"tool_input":{"command":"rm -r build"}}' allow
check "dangerous-git: commit message containing tag -> allow" guard-dangerous-git.sh \
  '{"tool_input":{"command":"git commit -m \"add tag support\""}}' allow

# --- guard-harness-config-edit: \ 区切り(Windows)と / 区切りの両方でdenyされること ---
check "harness-config-edit: backslash path -> deny" guard-harness-config-edit.sh \
  '{"tool_input":{"file_path":"d:\\proj\\.github\\agents\\reviewer.agent.md"}}' deny
check "harness-config-edit: forward-slash path -> deny" guard-harness-config-edit.sh \
  '{"tool_input":{"file_path":"d:/proj/.github/agents/reviewer.agent.md"}}' deny
check "harness-config-edit: AGENTS.md (backslash) -> deny" guard-harness-config-edit.sh \
  '{"tool_input":{"file_path":"d:\\proj\\AGENTS.md"}}' deny
check "harness-config-edit: normal file -> allow" guard-harness-config-edit.sh \
  '{"tool_input":{"file_path":"d:\\proj\\src\\app.ts"}}' allow
# D046: prompts も正レイヤとして保護
check "harness-config-edit: prompts path -> deny" guard-harness-config-edit.sh \
  '{"tool_input":{"file_path":"d:\\proj\\.github\\prompts\\03-design-architecture.prompt.md"}}' deny

# --- guard-template-edit: \ 区切りのテンプレートパスでもdenyされること ---
check "template-edit: backslash template path -> deny" guard-template-edit.sh \
  '{"tool_input":{"file_path":"d:\\proj\\docs\\01-requirements\\requirements_template.md"}}' deny
check "template-edit: non-template -> allow" guard-template-edit.sh \
  '{"tool_input":{"file_path":"d:\\proj\\docs\\01-requirements\\requirements.md"}}' allow

# --- warn-stale-gate: done文書の \ 区切りパス編集で警告が出ること(要progress.mdのfixture) ---
tmp=$(mktemp -d)
mkdir -p "$tmp/docs/00-overview"
printf 'requirements: done\ndesign: in_progress\ntest: done\n' > "$tmp/docs/00-overview/progress.md"
check "warn-stale-gate: done doc (backslash path) -> warn" warn-stale-gate.sh \
  '{"tool_input":{"file_path":"d:\\proj\\docs\\01-requirements\\requirements.md"}}' warn "$tmp"
check "warn-stale-gate: in_progress doc -> allow" warn-stale-gate.sh \
  '{"tool_input":{"file_path":"d:\\proj\\docs\\02-design\\architecture.md"}}' allow "$tmp"
check "warn-stale-gate: unrelated file -> allow" warn-stale-gate.sh \
  '{"tool_input":{"file_path":"d:\\proj\\src\\app.ts"}}' allow "$tmp"
# D046: 代表5ファイル以外のフェーズ配下文書もdoneなら警告(nfr等)。テンプレートは対象外
check "warn-stale-gate: done phase non-listed doc (nfr) -> warn" warn-stale-gate.sh \
  '{"tool_input":{"file_path":"d:\\proj\\docs\\01-requirements\\nfr.md"}}' warn "$tmp"
check "warn-stale-gate: done phase sub-dir doc (test evidence) -> warn" warn-stale-gate.sh \
  '{"tool_input":{"file_path":"d:\\proj\\docs\\04-test\\test-plan.md"}}' warn "$tmp"
check "warn-stale-gate: template file -> allow" warn-stale-gate.sh \
  '{"tool_input":{"file_path":"d:\\proj\\docs\\01-requirements\\requirements_template.md"}}' allow "$tmp"
rm -rf "$tmp"

# --- check-doc-chars: docs配下のmdに不可視文字があれば警告が出ること ---
# (Git Bash の /tmp 仮想パスは Windows ネイティブ node が読めないため、
#  cygpath -m で実パスに変換してからペイロードに載せる)
tmp2=$(mktemp -d)
mkdir -p "$tmp2/docs"
printf 'normal\x00text\n' > "$tmp2/docs/bad.md"
printf '# normal text\n' > "$tmp2/docs/good.md"
badp=$(cygpath -m "$tmp2/docs/bad.md" 2>/dev/null || printf '%s' "$tmp2/docs/bad.md")
goodp=$(cygpath -m "$tmp2/docs/good.md" 2>/dev/null || printf '%s' "$tmp2/docs/good.md")
srcp=$(cygpath -m "$tmp2/src.md" 2>/dev/null || printf '%s' "$tmp2/src.md")
check "doc-chars: NUL in docs md -> warn" check-doc-chars.sh \
  "{\"tool_input\":{\"file_path\":\"$badp\"}}" warn
check "doc-chars: clean docs md -> allow" check-doc-chars.sh \
  "{\"tool_input\":{\"file_path\":\"$goodp\"}}" allow
check "doc-chars: non-docs file -> allow" check-doc-chars.sh \
  "{\"tool_input\":{\"file_path\":\"$srcp\"}}" allow
rm -rf "$tmp2"

# --- inject-progress: 教訓50件超で「新しい50件」が注入され打ち切りが明示されること ---
tmp3=$(mktemp -d)
mkdir -p "$tmp3/docs/00-overview"
{ echo "## 教訓"; for i in $(seq 1 60); do echo "- [L$i] lesson $i"; done; } > "$tmp3/docs/00-overview/learnings.md"
out=$(cd "$tmp3" && bash "$scripts_dir/inject-progress.sh")
if printf '%s' "$out" | grep -q 'L60' && printf '%s' "$out" | grep -q '60件中' \
   && ! printf '%s' "$out" | grep -q 'L1\]' && printf '%s' "$out" | grep -q 'L11\]'; then
  pass=$((pass+1)); echo "PASS: inject-progress: newest-50 + truncation notice"
else
  fail=$((fail+1)); echo "FAIL: inject-progress: newest-50 + truncation notice"
  echo "  got(head): $(printf '%s' "$out" | head -c 300)"
fi
{ echo "## 教訓"; for i in 1 2 3; do echo "- [S$i] lesson $i"; done; } > "$tmp3/docs/00-overview/learnings.md"
out=$(cd "$tmp3" && bash "$scripts_dir/inject-progress.sh")
if printf '%s' "$out" | grep -q 'S3' && ! printf '%s' "$out" | grep -q '件中'; then
  pass=$((pass+1)); echo "PASS: inject-progress: under limit -> all lessons, no notice"
else
  fail=$((fail+1)); echo "FAIL: inject-progress: under limit -> all lessons, no notice"
  echo "  got(head): $(printf '%s' "$out" | head -c 300)"
fi
rm -rf "$tmp3"

# --- guard-phase-scope: 進行中フェーズの有無でアプリコード編集の ask/allow が切り替わること ---
# D046でルート相対の前方一致照合になったため、ペイロードのパスは fixture 配下で作る
# (ルート外のパスは「リポジトリ外=対象外」として allow になる。それ自体も1ケース検証)。
tmp4=$(mktemp -d)
mkdir -p "$tmp4/docs/00-overview"
p4=$(cygpath -m "$tmp4" 2>/dev/null || printf '%s' "$tmp4")
printf '<!-- GATE_STATUS\nrequirements: done\ndesign: done\nimplementation: done\ntest: done\nrelease: done\n-->\n' > "$tmp4/docs/00-overview/progress.md"
check "phase-scope: app file, all done -> ask" guard-phase-scope.sh \
  "{\"tool_input\":{\"file_path\":\"$p4/src/app.ts\"}}" ask "$tmp4"
check "phase-scope: docs file, all done -> allow" guard-phase-scope.sh \
  "{\"tool_input\":{\"file_path\":\"$p4/docs/01-requirements/requirements.md\"}}" allow "$tmp4"
# D046: app配下の tools/ はハーネス領域ではなくアプリコード(部分文字列一致バグの回帰テスト)
check "phase-scope: app/src/tools file, all done -> ask" guard-phase-scope.sh \
  "{\"tool_input\":{\"file_path\":\"$p4/app/src/tools/helper.ts\"}}" ask "$tmp4"
# D046: NotebookEdit(notebook_path)も対象
check "phase-scope: notebook_path, all done -> ask" guard-phase-scope.sh \
  "{\"tool_input\":{\"notebook_path\":\"$p4/analysis.ipynb\"}}" ask "$tmp4"
# D046: リポジトリ外(スクラッチパッド等)は対象外
check "phase-scope: out-of-repo file -> allow" guard-phase-scope.sh \
  '{"tool_input":{"file_path":"d:/elsewhere/scratch/app.ts"}}' allow "$tmp4"
# \ 区切りパスの正規化も引き続き機能すること
p4j=$(printf '%s' "$p4" | sed 's|/|\\\\|g')
check "phase-scope: app file (backslash path), all done -> ask" guard-phase-scope.sh \
  "{\"tool_input\":{\"file_path\":\"$p4j\\\\src\\\\app.ts\"}}" ask "$tmp4"
printf '<!-- GATE_STATUS\nrequirements: done\ndesign: done\nimplementation: in_progress\ntest: done\nrelease: done\n-->\n' > "$tmp4/docs/00-overview/progress.md"
check "phase-scope: app file, in_progress -> allow" guard-phase-scope.sh \
  "{\"tool_input\":{\"file_path\":\"$p4/src/app.ts\"}}" allow "$tmp4"
rm -rf "$tmp4"
tmp5=$(mktemp -d)
p5=$(cygpath -m "$tmp5" 2>/dev/null || printf '%s' "$tmp5")
touch "$tmp5/DECISIONS.md"
check "phase-scope: harness body repo -> allow" guard-phase-scope.sh \
  "{\"tool_input\":{\"file_path\":\"$p5/src/app.ts\"}}" allow "$tmp5"
# intake済み・/11未完了(DECISIONS.md + intake-report.md、progress.md なし)は
# 本体ではなく未初期化プロジェクトとして ask(D044の誤認バグの回帰テスト)
mkdir -p "$tmp5/docs/00-overview"
touch "$tmp5/docs/00-overview/intake-report.md"
check "phase-scope: intake done, /11 pending -> ask (not body)" guard-phase-scope.sh \
  "{\"tool_input\":{\"file_path\":\"$p5/src/app.ts\"}}" ask "$tmp5"
rm -rf "$tmp5"

# --- route-request: 運用中は /12 の契約が注入され、本体リポジトリでは注入されないこと ---
tmp6=$(mktemp -d)
mkdir -p "$tmp6/docs/00-overview"
printf '<!-- GATE_STATUS\nrequirements: done\ndesign: done\nimplementation: done\ntest: done\nrelease: done\n-->\n' > "$tmp6/docs/00-overview/progress.md"
out=$(cd "$tmp6" && bash "$scripts_dir/route-request.sh" < /dev/null)
if printf '%s' "$out" | grep -q '12-change-request' && printf '%s' "$out" | grep -q 'UserPromptSubmit'; then
  pass=$((pass+1)); echo "PASS: route-request: all done -> /12 contract injected"
else
  fail=$((fail+1)); echo "FAIL: route-request: all done -> /12 contract injected"
  echo "  got(head): $(printf '%s' "$out" | head -c 300)"
fi
rm -rf "$tmp6"
tmp7=$(mktemp -d)
touch "$tmp7/DECISIONS.md"
out=$(cd "$tmp7" && bash "$scripts_dir/route-request.sh" < /dev/null)
if [[ -z "$out" ]]; then
  pass=$((pass+1)); echo "PASS: route-request: harness body repo -> no injection"
else
  fail=$((fail+1)); echo "FAIL: route-request: harness body repo -> no injection"
  echo "  got(head): $(printf '%s' "$out" | head -c 300)"
fi
# intake済み・/11未完了は本体扱い(無注入)ではなく /11 誘導を注入する(D044回帰テスト)
mkdir -p "$tmp7/docs/00-overview"
touch "$tmp7/docs/00-overview/intake-report.md"
out=$(cd "$tmp7" && bash "$scripts_dir/route-request.sh" < /dev/null)
if printf '%s' "$out" | grep -q '11-brownfield-intake'; then
  pass=$((pass+1)); echo "PASS: route-request: intake done, /11 pending -> /11 guidance"
else
  fail=$((fail+1)); echo "FAIL: route-request: intake done, /11 pending -> /11 guidance"
  echo "  got(head): $(printf '%s' "$out" | head -c 300)"
fi
# inject-progress も同状態で本体メッセージではなく /11 誘導を出す(D044回帰テスト)
out=$(cd "$tmp7" && bash "$scripts_dir/inject-progress.sh" < /dev/null)
if printf '%s' "$out" | grep -q '11-brownfield-intake' && ! printf '%s' "$out" | grep -q '本体リポジトリ'; then
  pass=$((pass+1)); echo "PASS: inject-progress: intake done, /11 pending -> /11 guidance (not body)"
else
  fail=$((fail+1)); echo "FAIL: inject-progress: intake done, /11 pending -> /11 guidance (not body)"
  echo "  got(head): $(printf '%s' "$out" | head -c 300)"
fi
rm -rf "$tmp7"

# --- remind-record: アプリ編集のみ -> block、docs記録あり -> 通過(python必須) ---
pybin=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)
if [[ -n "$pybin" ]]; then
  tmp8=$(mktemp -d)
  mkdir -p "$tmp8/docs/00-overview"
  printf '<!-- GATE_STATUS\nrequirements: done\n-->\n' > "$tmp8/docs/00-overview/progress.md"
  p8=$(cygpath -m "$tmp8" 2>/dev/null || printf '%s' "$tmp8")
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"%s/src/main.py"}}]}}\n' "$p8" > "$tmp8/t.jsonl"
  out=$(printf '{"transcript_path":"%s/t.jsonl","cwd":"%s"}' "$p8" "$p8" | "$pybin" "$scripts_dir/remind-record.py")
  if printf '%s' "$out" | grep -q '"block"'; then
    pass=$((pass+1)); echo "PASS: remind-record: app edit without docs -> block"
  else
    fail=$((fail+1)); echo "FAIL: remind-record: app edit without docs -> block"
    echo "  got(head): $(printf '%s' "$out" | head -c 300)"
  fi
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"%s/docs/00-overview/change-requests.md"}}]}}\n' "$p8" >> "$tmp8/t.jsonl"
  out=$(printf '{"transcript_path":"%s/t.jsonl","cwd":"%s"}' "$p8" "$p8" | "$pybin" "$scripts_dir/remind-record.py")
  if [[ -z "$out" ]]; then
    pass=$((pass+1)); echo "PASS: remind-record: app edit with docs record -> pass"
  else
    fail=$((fail+1)); echo "FAIL: remind-record: app edit with docs record -> pass"
    echo "  got(head): $(printf '%s' "$out" | head -c 300)"
  fi
  out=$(printf '{"transcript_path":"%s/t.jsonl","cwd":"%s","stop_hook_active":true}' "$p8" "$p8" | "$pybin" "$scripts_dir/remind-record.py")
  if [[ -z "$out" ]]; then
    pass=$((pass+1)); echo "PASS: remind-record: stop_hook_active -> pass (no loop)"
  else
    fail=$((fail+1)); echo "FAIL: remind-record: stop_hook_active -> pass (no loop)"
  fi
  rm -rf "$tmp8"
else
  echo "SKIP: remind-record (python not found)"
fi

echo ""
echo "selftest: ${pass} passed, ${fail} failed"
[[ $fail -eq 0 ]]
