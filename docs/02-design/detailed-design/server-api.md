# 詳細設計: ローカルサーバー API・永続化・自動保存プロトコル

対応要件: US-009/010/011、NFR（性能・データ保全・外部送信なし）。
前提 ADR: [0001](../adr/0001-tech-stack.md) / [0002](../adr/0002-data-persistence.md)

## 1. 責務

- ビルド済みSPAの静的配信（`dist/client/` を配信、未知パスは `index.html` にフォールバック）。
- 保存データ（単一JSONファイル）の読み込み・検証・移行・原子的書き込み。
- クライアントからの全量置き換え（PUT）の直列化と多重タブ検出（楽観ロック）。

実装場所: `src/server/index.ts`（起動・配線）、`src/server/api.ts`（ルート）、
`src/server/storage.ts`（ファイルI/O）。listen は **127.0.0.1 のみ**（外部送信・受信なし）。

## 2. 起動シーケンス

1. データディレクトリを決定: `CHRONOLINES_DATA_DIR` 環境変数 → 無ければ
   `%LOCALAPPDATA%\ChronoLines`（Windows）/ `~/.local/share/chronolines`（その他）。無ければ作成。
2. `chronolines.json` を読み込み、`loadStore`（data-model.md 5章）で判定:
   - ファイル不在 → 初期ストアを生成してファイルを書き、`state = 'ok'`。
   - `ok` かつ移行あり → 元ファイルを `chronolines.v<旧版>.bak` にコピー保全してから
     移行後データを書き戻し、`state = 'ok'`。
   - `NEWER_SCHEMA` → メモリに読み込まず `state = 'newer'`（**以後書き込み一切禁止**。US-010）。
   - `CORRUPT` → `state = 'corrupt'`（ファイルは触らない。US-010）。
3. ポート `CHRONOLINES_PORT`（既定 5177）で listen。`EADDRINUSE` の場合は
   「ポート5177が使用中です。CHRONOLINES_PORT で変更するか、既存の ChronoLines を終了してください」
   を表示して終了コード1で停止（ADR 0001 の劣化受け皿）。
4. 起動成功時、コンソールに URL・データファイルパスを表示する。

サーバーはストアをメモリに保持し（`rev` 初期値 1）、GET はメモリから返す。

## 3. API 仕様

Content-Type はすべて `application/json`。ボディ上限 50MB（保証スケール2MB の余裕枠）。

### GET /api/store

| 状態 | レスポンス |
|---|---|
| state = ok | `200 { "rev": 3, "store": { ...Store... } }` |
| state = corrupt | `409 { "error": { "code": "E-STORE-CORRUPT", "message": "保存データを読み込めませんでした", "detail": "<パース/検証エラー概要>", "dataPath": "C:\\...\\chronolines.json" } }` |
| state = newer | `409 { "error": { "code": "E-STORE-NEWER", "message": "より新しいバージョンのアプリで保存されたデータです", "fileVersion": 2, "appSchemaVersion": 1, "dataPath": "..." } }` |

### PUT /api/store

リクエスト: `{ "rev": 3, "store": { ...Store... }, "recovery": false }`

処理順（書き込みは常に直列化キューで1件ずつ）:

1. `state = 'newer'` → `409 E-STORE-NEWER`（**無条件拒否**。US-010「上書きせず停止」）。
2. `state = 'corrupt'` かつ `recovery !== true` → `409 E-NEEDS-RECOVERY`
   （リカバリ画面を経由しない書き込みを防ぐ）。
3. storeSchema 厳密検証（参照整合性含む）。失敗 → `400 E-VALIDATION`（issue 一覧を detail に）。
4. `state = 'ok'` かつ `rev` 不一致 → `409 { "error": { "code": "E-REV-CONFLICT", "currentRev": 5 } }`
   （多重タブ検出。recovery 時は rev 照合をスキップ）。
5. `state = 'corrupt'` かつ `recovery === true` → 既存ファイルを
   `chronolines.corrupt-<YYYYMMDD-HHmmss>.json` に改名保全（ADR 0002「黙って捨てない」）。
6. 原子的書き込み（4章）。成功 → `state = 'ok'`、rev をインクリメントし `200 { "rev": 6 }`。
   失敗 → `500 { "error": { "code": "E-SAVE-FAILED", "message": "保存に失敗しました", "detail": "<OSエラー>" } }`
   （メモリ・ファイルは書き込み前の状態を維持）。

### GET /api/health

`200 { "ok": true, "appVersion": "1.0.0", "schemaVersion": 1, "dataPath": "...", "state": "ok" | "corrupt" | "newer" }`

## 4. 原子的書き込み手順（storage.ts）

1. `chronolines.json.tmp` に JSON を書き込み `fsync`。
2. 既存の `chronolines.json` があれば `chronolines.json.bak` へコピー（1世代バックアップ）。
3. `rename(tmp → chronolines.json)`（同一ボリューム内 rename = 原子的置き換え）。

どの段階で失敗しても本体ファイルは「直前の正常版」か「新版」のどちらかであり、
中途半端な状態にならない。`.bak` はユーザーの手動復旧のためのもので、アプリは自動では読まない
（リカバリ画面がパスを提示する。ui-forms-dialogs.md 6章）。

## 5. 自動保存プロトコル（クライアント側）

- すべてのミューテーション（data-model.md 4章）後、**500ms デバウンス**で
  `PUT /api/store` を送る（連続編集中は最後の1回に集約。全量2MB・ローカルなので十分軽い）。
- タブを閉じる・リロード時（`pagehide` イベント）にデバウンス中の未送信変更があれば
  `fetch(..., { keepalive: true })` で即時フラッシュする。それでも保証されない
  ごく短い喪失窓（プロセス強制終了等）は許容する（単一ユーザー・ローカルの割り切り）。
- PUT 成功 → 保持している `rev` を更新し、画面右下に「保存済み HH:mm:ss」を表示。
- `E-REV-CONFLICT` → エラーダイアログ「別のタブまたはウィンドウでデータが更新されています」
  を表示し、選択肢〔最新を読み込み直す（自分の変更は破棄）/ 自分の内容で上書きする〕を出す。
  上書きは GET で最新 rev を取得してから再 PUT する。
- ネットワークエラー・5xx → 画面上部に常設エラーバナー
  「保存できていません（最終保存: HH:mm:ss）。編集内容はこの画面に保持されています」+
  〔再試行〕ボタン。以後の変更時にも自動で再試行する。**編集は継続可能**（メモリ保持）で、
  クライアント単独のJSONエクスポートを退避手段として案内する（ADR 0002 の劣化受け皿）。
- 起動時 GET が失敗（サーバー死亡）→ 全画面の接続エラー表示 + 再試行ボタン。

## 6. セキュリティ（NFR対応）

- listen は 127.0.0.1 固定。外部ネットワークへの fetch を行うコードは存在しない。
- 入力検証はシステム境界 = PUT（Zod 厳密検証）とインポート（同じ検証）で行う。
- 認証・認可・暗号化は行わない（nfr.md で「該当なし」確定）。
- パス操作はデータディレクトリ配下の固定ファイル名のみ（ユーザー入力からパスを組み立てない）。

## 7. エラーIDカタログ（サーバー起点）

| ID | HTTP | 意味 | クライアントの振る舞い |
|---|---|---|---|
| E-STORE-CORRUPT | 409 | 保存ファイルが解析不能 | リカバリ画面（ui-forms-dialogs.md 6章） |
| E-STORE-NEWER | 409 | 保存ファイルが未知の新版 | リカバリ画面（読み取り専用・書き込み不可の説明） |
| E-NEEDS-RECOVERY | 409 | 破損状態でのリカバリ外書き込み | リカバリ画面へ誘導 |
| E-REV-CONFLICT | 409 | 多重タブによる競合 | 競合ダイアログ（5章） |
| E-VALIDATION | 400 | スキーマ検証失敗 | バグとして扱いエラーダイアログ（正常系では発生しない） |
| E-SAVE-FAILED | 500 | ファイル書き込み失敗 | 常設エラーバナー + 再試行（5章） |
