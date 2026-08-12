# 実装タスクリスト

設計（`docs/02-design/`）を実装可能な粒度に分解したもの。依存関係の順に並べる。
1タスク = 概ね1コミットで完結する規模を目安にする。

**完了条件（done契約）**: 各タスクには着手前に「完了条件」を必ず定義する。
完了条件 = **機械的検証**（実行するテスト・ビルド・lint等のコマンド）+
**実行時確認**（起動・画面操作・API応答など、動くことの証拠。該当する場合のみ）。
`[x]` はこの完了条件を実行して満たした証拠をもって付ける。「実装し終えた」という
自己申告だけで付けない（完了を自然言語の主張ではなく検証に束縛する）。

**人手必須タスク**（`.github/workflows/` への配置などエージェントが書き込めない作業）:
該当なし（CI/CD・外部デプロイを使わない。environment.md で確定済み）。

## 共通事項（全タスク共通）

- task-worker は実装前に `stack-conventions` スキル（プロジェクト構成・依存バージョン・
  npm scripts・コーディング規約）を必ず読む。コマンド実行時は
  `windows-shell-conventions` スキルの注意に従う。
- **共通完了条件**（各タスク固有の完了条件に加えて常に満たす）:
  1. `npm run typecheck` がエラー0で通る。
  2. `npm test` が全件パス（既存テストのデグレなし）。
  3. UIタスクは `npm run dev` で該当画面を目視し、モックアップ
     （`docs/02-design/ui/screen-*.html`・design-tokens.md）と構造・トークンが一致している。
- 配線網羅表: 該当なし（新規開発のため。ui-timeline-grid.md 10章）。
- E2E（Playwright）の実装・実行はテストフェーズ（/07・/08）の管轄。本フェーズの
  機械的検証は typecheck + Vitest 単体テストを主とする。

## 基盤・共通部分

- [x] TASK-001: プロジェクト雛形の作成（package.json〔依存は stack-conventions の表どおり・engines node>=22〕・tsconfig strict・vite.config〔dev時 /api→5177 プロキシ〕・index.html・npm scripts〔dev/build/typecheck/start/test/test:e2e〕・scripts/start.mjs・最小の main.tsx/App.tsx・Vitest/Playwright 設定）
  - 対応要件: 全USの前提 / 対応設計: ADR 0001、stack-conventions
  - 完了条件: `npm run typecheck` エラー0・`npm test`（プレースホルダ1件）パス /
    実行時確認: `npm run dev` で http://localhost:5173 に最小画面が表示される
  - 証拠 (2026-08-12): typecheck exit0・Vitest 1/1 pass・dev起動で 5173(Vite)/5177(server) 確認、
    curl で index.html 返却を確認後に停止。補足: server/index.ts は起動可能な最小スケルトンのみ
    （本実装は TASK-007）。typescript は最新v7でなく表どおり ^5 にピン
- [x] TASK-002: `src/domain/year.ts` — 年の表現と計算（StoredYear/AstroYear ブランド型・toAstro/fromAstro・compareStoredYears・ageAt・cellValue・formatYear・parseYearInput・decadeStart/decadeEnd/formatDecade）+ 単体テスト
  - 対応要件: US-002/005/007 / 対応設計: domain-logic.md 1章、ADR 0004
  - 完了条件: domain-logic.md の検算表9行・10年境界検算表8行・cellValue 判定規則4行・
    parseYearInput 仕様（前100/-100/1600/全角/空白/0年/±99999超）を網羅した Vitest が全パス
  - 証拠 (2026-08-12): Vitest 48/48 pass（新規47件で検算表9行・境界表8行・判定規則4行・
    parseYearInput 仕様を網羅、期待値は表から転記）・typecheck エラー0。
    メモ: cellValue は Person でなく構造型 PersonLifespan を受ける（schema→year の依存方向のため。
    Zod推論型のブランド付け方針は TASK-003 で決定）
- [x] TASK-003: `src/domain/schema.ts` — Zodスキーマと型（strictObject・yearSchema・person/event/timeline/store・superRefine の参照整合性5規則）+ 単体テスト
  - 対応要件: US-001/003/005/008/009 / 対応設計: data-model.md 2章・7章
  - 完了条件: 境界値表（data-model.md 7章）と参照整合性5規則（E-STORE-ACTIVE-MISSING /
    E-STORE-DUP-TIMELINE / E-STORE-DUP-ID / E-STORE-EVENT-ORPHAN / E-STORE-ORDER-MISMATCH）の
    正常・違反ケースを網羅した Vitest が全パス
  - 証拠 (2026-08-12): schema.test.ts 60/60 pass（境界値表・5規則の正常/違反・複数違反同時報告を網羅）・
    typecheck エラー0・npm test 108/108（デグレなし）。
    メモ: ブランド付与は yearSchema 末尾の恒等 transform 1箇所に閉じ込め（z.brand は year.ts と
    非互換のため不採用）。DUP-ID は persons/events の名前空間別で判定
- [x] TASK-004: `src/domain/migrate.ts` — loadStore と移行チェーン（migrations 登録簿〔現行空〕・LoadResult・判定手順5段階）+ 単体テスト
  - 対応要件: US-010 / 対応設計: data-model.md 5章
  - 完了条件: 正常v1 / JSONパース不能→CORRUPT / schemaVersion 欠落→CORRUPT /
    新版→NEWER_SCHEMA / 検証失敗→CORRUPT（detail に Zod issue）の Vitest が全パス
  - 証拠 (2026-08-12): migrate.test.ts 20/20 pass（指定5ケース+旧版欠番→CORRUPT を網羅、
    detail は Zod issue 先頭5件+「ほか n 件」書式）・typecheck エラー0・npm test 128/128。
    メモ: 移行成功パス（migratedFrom 付与）は登録簿が空の現行では検証不能、
    移行追加時にテストを足す契約を migrate.ts コメントに明記
- [x] TASK-005: `src/domain/query.ts` — 行導出と範囲決定（sortedPersonIds・filterByTags・filterEventsByTags・allTags・searchPersons・autoRange・eventsByColumn）+ 単体テスト
  - 対応要件: US-003/006/008 / 対応設計: domain-logic.md 2章
  - 完了条件: 安定ソート（同年生まれは月日→名前→id、月日無指定は末尾）/ OR絞り込み
    （選択0個=全件・人物とイベント対称）/ allTags 和集合・出現順 / 検索の NFKC 正規化・
    空クエリ=ヒットなし / autoRange（0件時は現在年−99〜現在年・反転クランプ）/
    eventsByColumn（year/decade 集約・列内ソート順）を網羅した Vitest が全パス
  - 証拠 (2026-08-12): query.test.ts 32/32 pass（上記全項目を網羅）・typecheck エラー0・
    npm test 160/160（デグレなし）。メモ: autoRange の「−99」は astro 軸で減算（0年回避）、
    名前/id 比較はロケール非依存のコードユニット順（決定性優先）
- [x] TASK-006: `src/server/storage.ts` — 原子的書き込みとバックアップ（tmp書き込み+fsync → .bak 1世代コピー → rename・データディレクトリ決定〔CHRONOLINES_DATA_DIR → %LOCALAPPDATA%\ChronoLines〕・破損ファイルの改名保全）+ 単体テスト
  - 対応要件: US-009/010 / 対応設計: server-api.md 2章・4章、ADR 0002
  - 完了条件: 一時ディレクトリ（CHRONOLINES_DATA_DIR 指定)を使った Vitest で、初回生成・
    書き込み後の .bak 生成・rename 後の本体整合・corrupt 改名保全（chronolines.corrupt-*.json）が全パス
  - 証拠 (2026-08-12): storage.test.ts 15/15 pass（初回生成・.bak 1世代・rename 整合・corrupt 改名保全を
    mkdtemp 一時ディレクトリで実測）・typecheck エラー0・npm test 175/175。
    メモ: corrupt 保全名の同一秒衝突は付番で回避（Windows rename の黙示上書き対策）。
    移行前バックアップ（chronolines.v<旧版>.bak）は起動シーケンス側= TASK-007 の管轄として持ち越し
- [x] TASK-007: `src/server/index.ts` + `api.ts` — サーバー本体（起動シーケンス state=ok/corrupt/newer・GET/PUT /api/store〔直列化・Zod検証・rev楽観ロック・recovery〕・GET /api/health・静的配信+index.htmlフォールバック・127.0.0.1 固定・EADDRINUSE メッセージ・ボディ上限50MB）+ 統合テスト
  - 対応要件: US-009/010、NFR（外部送信なし） / 対応設計: server-api.md 全章
  - 完了条件: エフェメラルポート+一時データディレクトリで実サーバーを起動する Vitest で、
    server-api.md 3章の状態×操作の表（ok/corrupt/newer × GET/PUT、rev不一致→E-REV-CONFLICT、
    recovery時のrev照合スキップと改名保全、検証失敗→E-VALIDATION）が全パス /
    実行時確認: `npm run dev` 起動後 `curl http://localhost:5177/api/health` が state:"ok" を返す
  - 証拠 (2026-08-12): server-api.test.ts 25/25 pass（状態×操作の表・直列化・50MB・recovery 保全を
    実サーバー起動で実測）・typecheck エラー0・npm test 200/200・/api/health が state:"ok" を返却。
    メモ: 移行前バックアップ backupBeforeMigration を storage.ts へ追加（TASK-006 持ち越し解消）。
    /api/health の appVersion は package.json の version を正とする（二重管理回避）

## コア機能

- [x] TASK-101: デザイントークンとアプリシェル（`styles/tokens.css`〔design-tokens.md の写し・リテラル色をコンポーネントCSSに書かない〕・AppShell〔起動ロード中スピナー・GET失敗時の全画面接続エラー+再試行・ルートエラー境界=再読み込み+メモリ上データのJSON退避エクスポート〕・Toolbar の枠・GET /api/store によるストア初期ロード）
  - 対応要件: US-009、NFR / 対応設計: ui-timeline-grid.md 1章・9章、data-model.md 6章（エクスポート形式）
  - 完了条件: エクスポート形式生成関数の Vitest（format/exportedAt/appVersion/store）パス /
    実行時確認: dev 起動でロード→年表名が表示される。サーバー停止状態では接続エラー画面+再試行が出る
  - 証拠 (2026-08-12): export.test.ts 10/10 pass・typecheck エラー0・npm test 210/210・
    Playwright 機械確認で「年表1」表示と vite 単独起動時の接続エラー画面+再試行を確認。
    メモ: GET 409 時は事実表示のみの読み取り専用画面（リカバリ本実装は TASK-203）。
    アプリ版数は vite define __APP_VERSION__ で package.json から埋め込み
- [x] TASK-102: `store/appStore.ts` — Zustand ストアとミューテーション全12操作（addPerson/updatePerson・deletePerson〔deleteEvents/unlink の2ポリシー+personOrder除去〕・addEvent/updateEvent/deleteEvent・reorderPerson・setSortMode・addTimeline/renameTimeline/deleteTimeline/switchTimeline・setViewRange/setZoom・replaceStore・appendTimelines〔全id再採番+personId再マップ〕）+ 単体テスト
  - 対応要件: US-001/003/008/009/011 / 対応設計: data-model.md 3章・4章
  - 完了条件: 各ミューテーションの Vitest（特に deletePerson 2ポリシー・appendTimelines の
    personId 再マップで E-STORE-EVENT-ORPHAN を作らない・最後の年表削除→「年表1」自動作成・
    manual時の新規人物は personOrder 末尾）が全パス
  - 証拠 (2026-08-12): appStore.test.ts 41/41 pass（done契約4点を個別網羅・ほぼ全テストで
    storeSchema.parse による整合性検証）・typecheck エラー0・npm test 251/251。
    メモ: 全ミューテーションを mutate() 一点に集約（TASK-103 の自動保存差し込み口）。
    manual 切替初回は現在の生年順を初期値化。表示中年表削除時は同位置の年表へ切替
- [x] TASK-103: 自動保存プロトコルと保存状態UI（全ミューテーション後の500msデバウンスPUT・pagehide時の keepalive フラッシュ・rev管理・「保存済み HH:mm:ss」表示・E-REV-CONFLICT 競合ダイアログ〔読み直し/上書き=GET→再PUT〕・ネットワークエラー/5xx の常設バナー+再試行+以後の変更で自動再試行）
  - 対応要件: US-009 / 対応設計: server-api.md 5章
  - 完了条件: fetch をモックした Vitest（デバウンス集約・rev更新・競合分岐・失敗時の
    メモリ保持と再試行）が全パス / 実行時確認: 編集後500msで chronolines.json が更新され
    「保存済み」表示が出る。2タブ同時編集で競合ダイアログが出る
  - 証拠 (2026-08-12): autosave.test.ts 22/22 pass（fake timers で決定的に検証）・typecheck エラー0・
    npm test 273/273・Playwright 機械確認 8/8（500ms後のファイル更新・保存済み表示・
    2タブ競合ダイアログ・読み直し/上書き分岐）。メモ: 保存状態表示はモックアップ優先で
    ツールバー右端（設計5章の「右下」と乖離、見た目の正はモックアップ）。
    DEV時のみ window.__chronolines にストア露出（E2E用最小フック）
- [ ] TASK-104: TimelineGrid（1年ズーム）— 行・列2軸仮想化（列44px・行28px・人物列200px・オーバースキャン5）・sticky 人物列（名前+生没年併記+タグ色ドット最大4+ツールチップ）・年ヘッダー・cellValue に基づくセル描画（blank/alive/virtual の色+括弧書式の二重チャネル）・セルのホバーツールチップ・10倍数年の縦罫線と現在年の強調罫線
  - 対応要件: US-002/005 / 対応設計: ui-timeline-grid.md 1〜2章、ADR 0003、screen-01
  - 完了条件: 実行時確認: 検証データ（chronolines.json 直接編集で投入可。フォームは TASK-105）で
    家康1543–1616 が 1600=57（生存帯）・1700=(157)（仮想）・1500=空欄、前100年生まれが
    西暦1年=100 と表示される。1000人・3000年のダミーデータでスクロールが体感で滑らか
- [ ] TASK-105: 人物フォームとタグピッカーと削除フロー（〔＋人物〕/行メニュー〔編集〕・名前*/生年*/生月日/没年月日/タグ・blur+送信時検証〔E-P-NAME-EMPTY・E-YEAR-FORMAT・E-YEAR-ZERO・E-P-DEATH-BEFORE-BIRTH・E-DAY-WITHOUT-MONTH〕・タグピッカー〔付与済みピル✕除去/登録済みから選択/新規入力+サジェスト〕・削除確認〔個人イベントあり→3択、なし→2択〕）
  - 対応要件: US-001/005 / 対応設計: ui-forms-dialogs.md 1章、screen-03/04
  - 完了条件: 実行時確認: 家康を登録→行が追加される。生年1600没年1550→エラーで登録されない。
    生年「前100」「-100」「0」の受理/拒否が仕様どおり。生年編集→全セルの年齢が変わる。
    個人イベント付き人物の削除で3択が出て選択どおり処理される
- [ ] TASK-106: イベントフォーム（〔＋イベント〕/サイドパネル〔編集〕/年ヘッダー右クリック〔この年にイベント追加〕・イベント名*/年*/月日/メモ2000字/人物紐付け/タグ・検証〔E-E-NAME-EMPTY・E-YEAR-*・E-DAY-WITHOUT-MONTH〕・フォーム内〔削除〕+確認）
  - 対応要件: US-003 / 対応設計: ui-forms-dialogs.md 2章、screen-03
  - 完了条件: 実行時確認: 「関ヶ原の戦い」を1600年で登録できる。年空欄の登録はエラー。
    年ヘッダー右クリックから年が初期値で入る
- [ ] TASK-107: イベントレーンと選択列と年齢比較サイドパネル（年ヘッダー直下の固定レーン・列ごと最大2チップ+「+N」バッジ・タグ配色/既定アンバー・個人イベントの人物アイコン・チップ/バッジ/年ヘッダークリック→選択列強調+右パネル〔年見出し・イベント全件リスト〔展開でメモ・編集・削除〕・年齢比較リスト〔行順・セルと同じ色書式・行クリックでスクロール〕〕・Esc/×で解除）
  - 対応要件: US-003/004（コアバリュー） / 対応設計: ui-timeline-grid.md 3〜4章、screen-01
  - 完了条件: 実行時確認: 成功指標シナリオ = 関ヶ原の戦い（1600）を選択すると列が強調され、
    パネルに家康57・政宗33が同一画面で表示される。没後の人物は (n) のグレー表示。
    1年に100件のイベントもパネルのスクロールで全件到達できる
- [ ] TASK-108: 10年ズーム（トグル〔1年|10年〕・decadeStart による列生成〔西暦1〜9の9年バケット・紀元前境界〕・集約セル〔いずれか alive→帯+開始年年齢、全て没後/未来→仮想帯+(開始年仮想年齢)、生没マーカー〕・イベントレーンは件数バッジ→パネルで年別グループ全件・切替時の中心年保持スクロール）
  - 対応要件: US-007 / 対応設計: ui-timeline-grid.md 5章、domain-logic.md 1章、ADR 0003、screen-02
  - 完了条件: 実行時確認: 1000年分の年表で切替→列数が約1/10になり生存帯が視認できる。
    10年→1年に戻すと切替前の中心年が表示範囲に含まれる。前1000〜前991・1〜9 の
    境界ラベルが screen-02 と一致する
- [ ] TASK-109: 人物検索（検索ボックス・150msデバウンスで searchPersons・ヒット行の人物列強調・「k/n件」+〔前へ/次へ〕で scrollToIndex・ヒット0件は「該当なし」表示で表示は不変）
  - 対応要件: US-008 / 対応設計: ui-timeline-grid.md 6章
  - 完了条件: 実行時確認: 1000人中「家康」で検索→該当行が表示範囲に現れ強調される。
    該当なし語→「該当なし」が出て行は変化しない
- [ ] TASK-110: タグ絞り込み（〔タグ▼〕ドロップダウン・allTags をチェックボックス複数選択〔色ドット+人物n・イベントm件数〕・OR条件で行とイベント両方に適用・適用中は色付きピル表示+個別✕/〔すべて解除〕）
  - 対応要件: US-008 / 対応設計: ui-timeline-grid.md 6章、domain-logic.md 2章
  - 完了条件: 実行時確認: 「戦国」30人で絞り込み→30行のみ表示。「戦国」+「剣豪」5人
    （重複なし）の2選択→35行。「合戦」タグのイベント10件絞り込み→該当イベントのみ表示
- [ ] TASK-111: 並び替えと行ドラッグ&ドロップ（トグル〔生年順|手動〕・手動時のドラッグハンドル・Pointer Events 自前実装〔行高固定でドロップ位置=オフセット/行高〕・reorderPerson・並び順の永続化・〔生年順〕へワンクリック復帰〔personOrder 保持〕）
  - 対応要件: US-008 / 対応設計: ui-timeline-grid.md 6章、data-model.md 4章
  - 完了条件: 実行時確認: 行をドラッグで並び替え→リロード後も復元される。生年順に戻して
    再度手動にすると前回の手動順に復帰する
- [ ] TASK-112: 表示範囲指定と空状態（〔開始年〕〔終了年〕入力・parseYearInput・空欄=自動でプレースホルダに自動値・不正入力はインラインエラー〔E-YEAR-FORMAT/E-YEAR-ZERO/E-RANGE-INVERTED〕・範囲内に該当なし→空グリッド+バナー・人物0件→中央の空状態表示〔＋人物を追加〕）
  - 対応要件: US-006 / 対応設計: ui-timeline-grid.md 7章、domain-logic.md 2章
  - 完了条件: 実行時確認: 1543〜1636のデータで範囲指定なし→1543〜現在年。1590〜1620指定→
    31列のみ。1200〜1300指定→空の年表+「該当する人物・イベントはありません」バナー。
    開始>終了はエラーで適用されない
- [ ] TASK-113: 年表管理（ツールバー左端の年表切替ドロップダウン〔1クリック切替〕・〔年表の管理...〕ダイアログ〔一覧=名前/人物数/イベント数・切替・名前変更・削除〕・〔＋新しい年表〕〔E-T-NAME-EMPTY〕・削除確認〔人物n人・イベントm件も削除される旨〕・最後の1つ削除→空の「年表1」自動作成）
  - 対応要件: US-009 / 対応設計: ui-forms-dialogs.md 3章、data-model.md 3章
  - 完了条件: 実行時確認: 「戦国」「幕末」を切り替えるとそれぞれの人物・イベントだけが
    表示される。削除は確認ダイアログで承諾しない限り実行されない。最後の年表を削除すると
    空の「年表1」が作られる

## 周辺機能

- [ ] TASK-201: エクスポートダイアログ（〔入出力〕→〔エクスポート〕タブ・範囲選択〔現在の年表のみ=timelines を1件に絞り activeTimelineId 差し替え/すべて〕・クライアント単独の Blob ダウンロード・ファイル名 chronolines-export-YYYYMMDD-HHmm.json）
  - 対応要件: US-011 / 対応設計: ui-forms-dialogs.md 4章、data-model.md 6章
  - 完了条件: 「現在のみ」出力の activeTimelineId 差し替えの Vitest がパス /
    実行時確認: ダウンロードしたファイルが storeSchema 検証を通る
- [ ] TASK-202: インポートダイアログ（〔インポート〕タブ・.json 選択・エクスポート形式/保存形式の自動判別・旧版は移行・内容プレビュー〔年表n・人物n・イベントn・日時〕・〔すべて置き換える〕〔年表として追加する〕・置き換え時の追加確認・E-IMPORT-INVALID/E-IMPORT-NEWER・失敗時は既存データ無変更）
  - 対応要件: US-011 / 対応設計: ui-forms-dialogs.md 5章、data-model.md 6章
  - 完了条件: 判別・検証ロジックの Vitest（2形式受理・壊れたJSON拒否・新版拒否）がパス /
    実行時確認: エクスポート→全削除→インポート（置き換え）で元の状態に復元される。
    壊れたJSONはエラー表示のみで既存データ無傷
- [ ] TASK-203: リカバリ画面（E-STORE-CORRUPT: detail+データパス表示・〔JSONファイルから復旧〕=置き換えインポートを recovery:true で PUT・.bak 手動復旧手順の提示・〔空のデータで開始〕+追加確認・〔再試行〕+「修復後はサーバー再起動」の明記 / E-STORE-NEWER: 形式バージョン表示・書き込み系全面不可の読み取り専用説明）
  - 対応要件: US-010 / 対応設計: ui-forms-dialogs.md 6章、server-api.md 3章
  - 完了条件: 実行時確認: chronolines.json を手で壊して起動→リカバリ画面が出て既存ファイルは
    無変更。JSON復旧経路で復元でき、壊れたファイルが chronolines.corrupt-*.json に保全される。
    schemaVersion:2 のファイルで起動→NEWER 画面が出て一切書き込まれない
- [ ] TASK-204: 画像出力（〔画像出力〕ボタン・html-to-image の toPng をグリッドコンテナに適用〔可視範囲のみ〕・ファイル名 chronolines-<年表名>-<YYYYMMDD>.png・失敗時トーストのみ）※Could。全Mustタスク完了後に着手
  - 対応要件: US-012 / 対応設計: ui-timeline-grid.md 8章
  - 完了条件: 実行時確認: 表示中のグリッドが PNG としてダウンロードされ、人物列・年ヘッダー・
    イベントレーン・可視セルが含まれる

## 仕上げ（ドキュメント・クリーンアップ等）

- [ ] TASK-901: ルート README をアプリの README に置き換え（概要・必要環境 node>=22・インストール `npm ci`・起動 `npm start`・更新手順〔更新前の JSON エクスポート推奨+データ自動移行の説明〕・バックアップ/復旧手順〔エクスポート/インポート〕・データファイルの場所）
  - 対応要件: environment.md「利用者の運用作業」 / 対応設計: environment.md、ADR 0002
  - 完了条件: README の手順どおりにクリーンな状態から `npm ci` → `npm start` で起動し
    http://localhost:5177 で操作できることを実測
- [ ] TASK-902: 実装フェーズ完了検証（`npm run typecheck`・`npm test` 全件・`npm run build` 成功・成功指標シナリオ〔関ヶ原1600→家康57・政宗33〕の実行時確認・全タスクの完了条件証拠が tasks.md に記録済みであることの棚卸し・要件対応表〔architecture.md 7章〕の全USに対応実装が存在することの確認）
  - 対応要件: 全US / 対応設計: architecture.md 7章
  - 完了条件: 上記コマンド3点がすべて成功し、棚卸しで未完了・乖離が0件

---
実装メモ（判断に迷った点、後で見直すべき点など）はこのファイル末尾に追記してよい。
