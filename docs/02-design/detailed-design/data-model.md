# 詳細設計: データモデル・保存スキーマ・移行

対応要件: US-001/003/008/009/010/011。前提 ADR: [0002](../adr/0002-data-persistence.md) / [0004](../adr/0004-bc-year-representation.md)

## 1. 責務

- 保存データ（= エクスポートデータ）の唯一のスキーマ定義（Zod）と TypeScript 型の提供。
- 検証規則（形式・値域・参照整合性）の一元化。クライアントのフォーム検証・インポート検証・
  サーバーの PUT 検証はすべてこの定義を使う。
- スキーマバージョンの定義と移行チェーンの提供。

実装場所: `src/domain/schema.ts`（スキーマ・型）、`src/domain/migrate.ts`（移行）。

## 2. スキーマ定義（schemaVersion = 1）

Zod 定義（実装はこのとおりに書く。`z.strictObject` で未知フィールドを拒否する）:

```ts
// src/domain/schema.ts
import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1;

// StoredYear: 西暦Y = Y、前N = -N。0 は存在しない年（US-005）
// 技術上限 ±99999: 「前1000年以前も登録を拒否しない」(A-002) を満たしつつ極端値の暴走を防ぐ
export const yearSchema = z.number().int()
  .refine(y => y !== 0, { message: '0年は存在しません（前1年の翌年は西暦1年です）' })
  .refine(y => Math.abs(y) <= 99999, { message: '年は±99999の範囲で入力してください' });

const monthSchema = z.number().int().min(1).max(12);
const daySchema = z.number().int().min(1).max(31);

// 月日は参考情報（A-005: 年齢計算に使わない）。日は月がある場合のみ許可
const dateFieldsSchema = z.strictObject({
  year: yearSchema,
  month: monthSchema.optional(),
  day: daySchema.optional(),
}).refine(d => d.day === undefined || d.month !== undefined,
  { message: '日を指定する場合は月も指定してください' });

export const personSchema = z.strictObject({
  id: z.string().min(1),                     // "p_" + crypto.randomUUID()
  name: z.string().trim().min(1, '名前は必須です').max(100),
  birth: dateFieldsSchema,                   // 必須（年のみ可）
  death: dateFieldsSchema.optional(),        // 任意
  tags: z.array(z.string().trim().min(1).max(30)).max(50).default([]),
}).refine(p => p.death === undefined || compareStoredYears(p.death.year, p.birth.year) >= 0,
  { message: '没年は生年以降にしてください' });   // 同年没(0歳)は許可

export const timelineEventSchema = z.strictObject({
  id: z.string().min(1),                     // "e_" + crypto.randomUUID()
  name: z.string().trim().min(1, 'イベント名は必須です').max(100),
  year: yearSchema,                          // 必須
  month: monthSchema.optional(),
  day: daySchema.optional(),
  note: z.string().max(2000).optional(),
  personId: z.string().optional(),           // 任意 = 個人イベント（US-003）
  tags: z.array(z.string().trim().min(1).max(30)).max(50).default([]),  // 2026-08-12差分: イベントにもタグ
}).refine(e => e.day === undefined || e.month !== undefined,
  { message: '日を指定する場合は月も指定してください' });

export const timelineSchema = z.strictObject({
  id: z.string().min(1),                     // "tl_" + crypto.randomUUID()
  name: z.string().trim().min(1, '年表名は必須です').max(50),
  persons: z.array(personSchema),
  events: z.array(timelineEventSchema),
  sortMode: z.enum(['birthAsc', 'manual']),  // US-008
  personOrder: z.array(z.string()),          // manual時の行順（person id の列）
  view: z.strictObject({
    startYear: yearSchema.nullable(),        // null = 自動（US-006）
    endYear: yearSchema.nullable(),
    zoom: z.enum(['year', 'decade']),        // US-007
  }),
});

export const storeSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  activeTimelineId: z.string().min(1),
  timelines: z.array(timelineSchema).min(1),
});

export type Person = z.infer<typeof personSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type Store = z.infer<typeof storeSchema>;
```

### 参照整合性（superRefine で storeSchema に付加する）

| 規則 | 違反時メッセージ（エラーID） |
|---|---|
| `activeTimelineId` は `timelines[].id` のいずれかに一致する | E-STORE-ACTIVE-MISSING |
| `timelines[].id` は重複しない | E-STORE-DUP-TIMELINE |
| 各 timeline 内で person id / event id は重複しない | E-STORE-DUP-ID |
| `event.personId` は同一 timeline の `persons[].id` に存在する | E-STORE-EVENT-ORPHAN |
| `sortMode === 'manual'` のとき `personOrder` は persons の id 集合と一致する（過不足なし） | E-STORE-ORDER-MISMATCH |

補足: サーバーの PUT・インポートはこの厳密検証を通す。クライアント内の変更操作は
ストア層のミューテーション関数（後述 4章）だけがデータを触るため、整合性はコードで保証し、
検証は境界（保存・取り込み）で行う（NFR: 入力値検証はシステム境界で行う）。

## 3. 初期データ・既定値

- 初回起動（ファイル不在）時にサーバーが生成する初期ストア:
  `{ schemaVersion: 1, activeTimelineId: <新規id>, timelines: [{ id, name: "年表1", persons: [], events: [], sortMode: "birthAsc", personOrder: [], view: { startYear: null, endYear: null, zoom: "year" } }] }`
- 最後の年表を削除したときは、同じ形の空年表「年表1」を自動作成して active にする
  （年表0個の状態を作らない。削除確認は US-009 のとおり必須）。

## 4. 変更操作（クライアント側ミューテーションの一覧）

Zustand ストア（`src/client/store/appStore.ts`）は以下の操作だけでデータを変更する。
各操作は変更後に自動保存（デバウンス PUT。server-api.md 参照）をスケジュールする。

| 操作 | 内容・整合性処理 |
|---|---|
| addPerson / updatePerson | 検証済み入力から Person を作成/更新。manual 並びのときの新規追加は personOrder 末尾に追加（US-008） |
| deletePerson(id, eventPolicy) | eventPolicy: `'deleteEvents'`（紐付く個人イベントも削除）\| `'unlink'`（event.personId を外して残す）。personOrder からも除去（US-001） |
| addEvent / updateEvent / deleteEvent | イベントの CRUD |
| reorderPerson(id, toIndex) | sortMode を 'manual' にし personOrder を更新（US-008） |
| setSortMode('birthAsc'\|'manual') | 'birthAsc' に戻しても personOrder は保持する（再度 manual にすると前回の手動順に復帰） |
| addTimeline / renameTimeline / deleteTimeline / switchTimeline | 年表管理（US-009）。delete は確認ダイアログ経由でのみ呼ばれる |
| setViewRange(start, end) / setZoom(zoom) | 表示設定の変更（US-006/007）。年表データの一部として永続化される |
| replaceStore(store) | インポート「すべて置き換え」・リカバリ用（US-011） |
| appendTimelines(timelines) | インポート「年表として追加」。timeline/person/event の id をすべて新規採番して衝突を避け、`event.personId` は person の旧id→新id 対応表で再マップする（E-STORE-EVENT-ORPHAN を作らない） |

## 5. スキーマ移行（US-010）

実装場所: `src/domain/migrate.ts`。

```ts
// バージョン N のデータを N+1 に変換する関数の登録簿。現行 v1 のため空
const migrations: Record<number, (data: unknown) => unknown> = {};

export type LoadResult =
  | { ok: true; store: Store; migratedFrom?: number }
  | { ok: false; code: 'NEWER_SCHEMA'; fileVersion: number }
  | { ok: false; code: 'CORRUPT'; detail: string };

export function loadStore(raw: string): LoadResult;
```

`loadStore` の判定手順:

1. `JSON.parse` 失敗 → `CORRUPT`（detail = パースエラー概要）。
2. `schemaVersion` が整数で取れない → `CORRUPT`。
3. `schemaVersion > CURRENT_SCHEMA_VERSION` → `NEWER_SCHEMA`（**一切書き込まない**）。
4. `schemaVersion < CURRENT` → migrations を昇順に連鎖適用（欠番があれば `CORRUPT` 扱い）。
5. 最後に storeSchema で厳密検証。失敗 → `CORRUPT`（detail = Zod issue の先頭数件）。

移行を追加するときの契約（将来の実装者向け）:

- スキーマを変える変更は必ず `CURRENT_SCHEMA_VERSION` をインクリメントし、
  旧→新の移行関数を登録簿に追加し、旧形式サンプルを使った単体テストを追加する。
- 移行はデータを消さない方向でのみ書く（フィールド削除時も可能な限り変換して残す）。

## 6. エクスポート/インポート形式（US-011）

エクスポートファイルは保存ファイルと同じ `Store` スキーマに、識別用メタデータを added:

```json
{
  "format": "chronolines-export",
  "exportedAt": "2026-08-12T10:00:00+09:00",
  "appVersion": "1.0.0",
  "store": { "schemaVersion": 1, "activeTimelineId": "tl_...", "timelines": [ ... ] }
}
```

- 「現在の年表のみ」エクスポートは `store.timelines` を該当1件に絞り、
  `activeTimelineId` をその年表の id に差し替えたもの（絞った結果が
  E-STORE-ACTIVE-MISSING になる自己矛盾ファイルを生成しない）。
- インポートは次の2形式を受け付ける: (a) 上記エクスポート形式（`format` キーで判別）、
  (b) 保存ファイル（`Store`）そのもの（手動復旧経路。ADR 0002）。
- インポート時も `loadStore` 相当の判定を行う: 旧版 → 移行して取り込み。
  新版 → `E-IMPORT-NEWER` で拒否。検証失敗 → `E-IMPORT-INVALID`。
  **いずれの失敗でも既存データは無変更**（US-011）。
- ファイル名: `chronolines-export-YYYYMMDD-HHmm.json`。

## 7. 境界値・検証規則のまとめ（テストフェーズの入力）

| 項目 | 規則 |
|---|---|
| 年 | 整数・0禁止・±99999 以内。前N = -N（ADR 0004） |
| 没年 >= 生年 | 年の全順序（toAstro比較）で判定。同年可（0歳没） |
| 月/日 | 月 1〜12、日 1〜31。日は月必須。実在日チェック（2/30等）はしない（参考情報のため。A-005） |
| 名前/年表名 | trim 後 1文字以上。人物・イベント名 100 文字以内、年表名 50 文字以内 |
| タグ | 1〜30文字・人物/イベント1件あたり最大50個。タグの実体はマスタを持たず、人物・イベントの tags 配列の和集合が「登録済みタグ」（同名 = 同一タグ。色はタグ名から決定的に導出 → design-tokens.md） |
| メモ | 2000文字以内 |
| 年表数・人物数・イベント数 | 上限なし（性能保証は 年表10・人物1000・イベント総量5000。A-003 確定値） |
