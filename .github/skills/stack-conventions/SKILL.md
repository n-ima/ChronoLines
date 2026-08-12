---
name: stack-conventions
description: ChronoLines の技術スタック（React 19 + TypeScript + Vite / Node.js + Express のローカルサーバー型 / Zod / Zustand / @tanstack/react-virtual / Vitest + Playwright）で実装するときの規約。プロジェクト構成、依存バージョン、npm scripts、ドメイン層の純粋性、年変換の閉じ込め、セキュリティ規約。実装・テストフェーズの task-worker が実装前に必ず読む。
---

# ChronoLines スタック規約

対象スタックは [ADR 0001](../../../docs/02-design/adr/0001-tech-stack.md) で確定したもの。
設計の正は `docs/02-design/`（architecture.md・detailed-design/・ui/）。本スキルは
「そのとおり実装するときの書き方」を定める。

## プロジェクト構成（単一パッケージ）

```
ChronoLines/
├── package.json            # 単一パッケージ（workspace分割しない）
├── tsconfig.json           # strict: true
├── vite.config.ts          # client のビルド設定 + dev時 /api プロキシ
├── playwright.config.ts
├── index.html              # Vite エントリ
├── src/
│   ├── domain/             # 純粋ロジック（クライアント・サーバー共用）
│   │   ├── year.ts         # 年表現・満年齢・書式化（ADR 0004）
│   │   ├── schema.ts       # Zodスキーマ・型（data-model.md）
│   │   ├── migrate.ts      # スキーマ移行チェーン
│   │   └── query.ts        # 並び替え・絞り込み・検索・範囲決定
│   ├── client/             # React SPA
│   │   ├── main.tsx / App.tsx
│   │   ├── store/appStore.ts        # Zustand（ミューテーション一覧は data-model.md 4章）
│   │   ├── components/              # Toolbar / TimelineGrid / SidePanel / dialogs/
│   │   └── styles/tokens.css        # design-tokens.md をCSSカスタムプロパティ化
│   └── server/
│       ├── index.ts        # 起動・静的配信・listen(127.0.0.1)
│       ├── api.ts          # /api/store, /api/health（server-api.md）
│       └── storage.ts      # 原子的書き込み・バックアップ
├── tests/                  # Vitest（unit）・Playwright（e2e）
└── docs/                   # ハーネスのドキュメント（正）
```

## 依存関係（メジャーバージョン固定。exact は package-lock.json が担う）

| 依存 | バージョン | 用途 |
|---|---|---|
| node | >= 22（`engines` に記載） | 実行環境 |
| react / react-dom | ^19 | UI |
| typescript | ^5 | 言語（`strict: true` 必須） |
| vite / @vitejs/plugin-react | Vite の現行安定版 | ビルド・dev server |
| zustand | ^5 | 状態管理 |
| @tanstack/react-virtual | ^3 | 行・列の仮想化 |
| zod | 現行安定版（^4 系を優先） | スキーマ検証 |
| express | ^4 | ローカルサーバー（v5 は使わない。情報量と安定性で v4 に固定） |
| tsx | 最新 | サーバーのTS実行（サーバーはトランスパイルせず tsx で起動する） |
| html-to-image | 最新 | 画像出力（US-012）のみで使用 |
| concurrently | 最新（devDep） | dev 時の並行起動 |
| vitest | 最新（devDep） | 単体テスト |
| @playwright/test | 最新（devDep） | E2E（Chromium/Edge） |

新しい依存を追加するときは、追加理由をタスク記録（tasks.md の該当行）に1行残す。
上記以外の UI コンポーネントライブラリ・CSSフレームワークは導入しない（CSS Modules + トークンで書く）。

## npm scripts（この名前・この意味で作る）

| script | 内容 |
|---|---|
| dev | `concurrently -k "vite" "tsx watch src/server/index.ts"`（client: 5173 が /api を 5177 へプロキシ） |
| build | `npm run typecheck && vite build`（出力 `dist/client/`） |
| typecheck | `tsc --noEmit` |
| start | `node scripts/start.mjs` 相当: `dist/client` が無ければ build してから `tsx src/server/index.ts`（本番相当のローカル起動。ブラウザで http://localhost:5177 を開く） |
| test | `vitest run` |
| test:e2e | `playwright test`（サーバーを起動してから実行） |

CI/CD は作らない（environment.md で「なし」確定。テスト・ビルドはローカル実行）。

## コーディング規約（このプロジェクト固有）

1. **domain の純粋性**: `src/domain/` は DOM・Node API・`Date` 直接参照を禁止
   （現在年は必ず引数で受け取る）。import できるのは zod のみ。
2. **年変換の閉じ込め**: `toAstro`/`fromAstro` を書いてよいのは `src/domain/year.ts` だけ。
   他所で `y + 1` / `y - 1` のような紀元前補正を書かない（ADR 0004）。
   `StoredYear`/`AstroYear` はブランド型で区別する。
3. **データ変更の一元化**: ストアの変更は `appStore.ts` のミューテーション関数
   （data-model.md 4章の一覧）経由のみ。コンポーネントから直接 state を書き換えない。
   各ミューテーションは自動保存のスケジュール（500msデバウンス）を必ず通す。
4. **セキュリティ**: `dangerouslySetInnerHTML` 禁止（XSS。ユーザー入力は React の
   標準エスケープで表示する）。サーバーの listen は `127.0.0.1` 固定。外部への
   `fetch`/`http` 呼び出しをするコードを書かない（NFR: ネットワーク送信機能を持たない）。
5. **エラーID**: エラーメッセージは詳細設計のエラーIDカタログ（server-api.md 7章・
   ui-forms-dialogs.md）の ID・文言を使う。新しいエラーを増やすときはまず設計に追記する。
6. **見た目の正はモックアップ**: `docs/02-design/ui/screen-*.html` と design-tokens.md に
   従う。トークン値は `src/client/styles/tokens.css` にのみ定義し、色・寸法のリテラルを
   コンポーネントCSSに直接書かない。モックアップと違う見た目にしたくなったら、
   先にモックアップを更新してユーザー確認を取る（設計の差分駆動）。
7. **仮想化の規約**: セルの値はレンダリング時に `cellValue` で都度計算する。
   300万セル分の配列・キャッシュ・useMemoの巨大配列を作らない（ADR 0003）。
8. **テスト対応づけ**: 単体テストは domain-logic.md の検算表・境界値表を必ず網羅する
   （テストケースは docs/04-test/ のテスト計画と対応づける）。

## Windows 環境の注意

コマンド実行の落とし穴（ドライブレター・CRLF・PowerShell構文等）は
`windows-shell-conventions` スキルを参照する。特に:
- npm scripts はシェル非依存に書く（`&&` は npm が解釈するので可。リダイレクトや
  環境変数の inline 設定は cross-env 等を使わず、`scripts/*.mjs` の Node スクリプトに寄せる）。
- パス結合は `node:path` を使う（文字列連結しない）。データディレクトリの既定は
  `%LOCALAPPDATA%\ChronoLines`（server-api.md 2章）。

## 検証手順（実装タスクの done 契約の共通部分）

1. `npm run typecheck` がエラー0で通る。
2. `npm test` が通る（対象タスクのテストを含む）。
3. UIタスクは `npm run dev` で該当画面を目視し、モックアップと構造・トークンが一致している。
