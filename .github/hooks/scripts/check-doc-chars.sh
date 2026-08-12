#!/usr/bin/env bash
# PostToolUse hook: docs/ 配下の .md への書き込み後に、編集ツールが混入させがちな
# 不可視文字・文字化け(NUL / 本文中BOM / ハングル / 置換文字 / 生タブ / 全角空白 /
# BMP外漢字)を数え、0件でなければ非ブロッキングの警告を出す。
# docs/ は lint・テストの対象外のため、機械的な検出手段はこのフックだけ
# (半角スペースがNULになる・「データ」の「デ」がハングルになる実例あり)。
# 注意: 検査対象の文字はこのスクリプト自身に混入させないため、正規表現は
# 必ず \uXXXX エスケープ表記で書く(リテラルで書かない)。
input=$(cat)

file=""
if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.filePath // .tool_input.path // empty' 2>/dev/null)
fi
if [[ -z "$file" ]] && command -v node >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const t=j.tool_input||{};process.stdout.write(String(t.file_path||t.filePath||t.path||""))}catch(e){}' 2>/dev/null)
fi
if [[ -z "$file" ]]; then
  file=$(printf '%s' "$input" | grep -oE '"(file_path|filePath|path)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
fi
file=${file//\\//}
file=$(printf '%s' "$file" | sed -E 's|/{2,}|/|g')

# docs 配下の .md 以外は対象外(テンプレートも含めて検査する)
if [[ -z "$file" || "$file" != *docs/*.md || ! -f "$file" ]]; then
  printf '%s\n' '{"continue": true}'
  exit 0
fi

# 判定ログ(ローカルのみ・gitignore対象)。ログ失敗はフック判定に影響させない。
hook_log() {
  { d="$(dirname "$0")/../logs" && mkdir -p "$d" &&
    printf '%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$(basename "$0")" "$1" "$2" >>"$d/hook-decisions.log"; } 2>/dev/null || true
}

detail=""
if command -v node >/dev/null 2>&1; then
  # 注意: node -e は1行で書く(複数行 node -e は出力が丸ごと消えることがある。
  # windows-shell-conventions §5 の既知の落とし穴)
  detail=$(node -e 'try{const t=require("fs").readFileSync(process.argv[1],"utf8");const cs=[["NUL","\\u0000","g"],["hombunBOM","(?!^)\\uFEFF","g"],["hanguru","[\\u1100-\\u11FF\\uAC00-\\uD7AF]","g"],["chikanmoji-U+FFFD","\\uFFFD","g"],["nama-tab","\\t","g"],["zenkaku-kuhaku","\\u3000","g"],["BMP-gai-kanji","[\\u{20000}-\\u{2FFFF}]","gu"]];const hits=[];for(const[n,p,f]of cs){const m=t.match(new RegExp(p,f));if(m)hits.push(n+":"+m.length)}process.stdout.write(hits.join(" "))}catch(e){}' "$file" 2>/dev/null)
else
  # node が無い環境では NUL だけ grep -P で検査(それも無ければ検査なし = 安全側で許可)
  if grep -qP '\x00' "$file" 2>/dev/null; then detail="NUL:1+"; fi
fi

if [[ -n "$detail" ]]; then
  hook_log warn "$file $detail"
  esc_file=$(printf '%s' "$file" | sed 's/"/\\"/g')
  esc_detail=$(printf '%s' "$detail" | sed 's/"/\\"/g')
  printf '{"continue": true, "systemMessage": "docs への書き込みに不可視文字/文字化けの疑いがあります(%s): %s。意図した文字か確認し、混入なら除去してください(NUL=ヌル文字, hombunBOM=本文中BOM, hanguru=ハングル, nama-tab=タブ, zenkaku-kuhaku=全角空白)。"}\n' "$esc_file" "$esc_detail"
else
  printf '%s\n' '{"continue": true}'
fi
