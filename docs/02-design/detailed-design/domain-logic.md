# 詳細設計: ドメインロジック（年計算・検索・並び替え・範囲決定）

対応要件: US-002/005/006/007/008、glossary.md「満年齢」「仮想年齢」「現在年」。
前提 ADR: [0003](../adr/0003-grid-rendering.md) / [0004](../adr/0004-bc-year-representation.md)

実装場所: `src/domain/year.ts` / `src/domain/query.ts`。
**純粋関数のみ**（DOM・Node API・Date 直接参照を禁止。現在年は引数で受け取る）。
このファイルの関数群がアプリの計算仕様の正であり、単体テストはこの表を網羅する。

## 1. year.ts — 年の表現と計算

```ts
export type StoredYear = number & { __brand: 'StoredYear' }; // 前N = -N。0は不正
export type AstroYear  = number & { __brand: 'AstroYear' };  // 前1年 = 0（連続整数軸）

export function toAstro(y: StoredYear): AstroYear;      // y < 0 ? y + 1 : y
export function fromAstro(a: AstroYear): StoredYear;    // a <= 0 ? a - 1 : a
export function compareStoredYears(a: StoredYear, b: StoredYear): number; // toAstro差。年の全順序
export function ageAt(birthYear: StoredYear, displayYear: StoredYear): number;
  // = toAstro(displayYear) - toAstro(birthYear)。負値 = 生前（呼び出し側で空欄扱い）

export type CellValue =
  | { kind: 'blank' }                    // 生前（US-002）
  | { kind: 'alive'; age: number }       // 生存中（生年=0、没年=生存扱い）
  | { kind: 'virtual'; age: number };    // 仮想年齢（没後・存命者の現在年より後）

export function cellValue(person: Person, year: StoredYear, currentYear: StoredYear): CellValue;

export function formatYear(y: StoredYear): string;       // 1600 → "1600"、-100 → "前100"
export type YearParseResult = { ok: true; year: StoredYear } | { ok: false; code: 'E-YEAR-FORMAT' | 'E-YEAR-ZERO' };
export function parseYearInput(input: string): YearParseResult;

export function decadeStart(a: AstroYear): AstroYear;
  // 10年列の境界は stored年のラベルに整列させる（モックアップ screen-02 で合意した見た目が正）:
  //   a >= 10          → Math.floor(a / 10) * 10            例: 10〜19、1600〜1609
  //   1 <= a <= 9      → 1                                   西暦1〜9 の【9年バケット】（0年が存在しないための例外）
  //   a <= 0（紀元前） → Math.floor((a - 1) / 10) * 10 + 1   例: 前10〜前1、前1000〜前991
export function decadeEnd(dStart: AstroYear): AstroYear;  // dStart === 1 ? 9 : dStart + 9
export function formatDecade(dStart: AstroYear): string;  // "1600〜" / "前1000〜"（10年列の見出し。パネル等の全範囲表記は "1600〜1609" / "前1000〜前991"）
```

### cellValue の判定規則（US-002 の正規化。上から順に評価）

| # | 条件 | 結果 |
|---|---|---|
| 1 | `ageAt(birth.year, year) < 0` | blank（生前） |
| 2 | 没年あり かつ `compareStoredYears(year, death.year) > 0` | virtual（没後） |
| 3 | 没年なし かつ `compareStoredYears(year, currentYear) > 0` | virtual（存命者の未来年） |
| 4 | それ以外 | alive（生年セル = 0、没年セル = 生存扱い、現在年セル = 生存扱い） |

補足: 没年が現在年より未来に入力された人物は、規則2/3の帰結として没年まで alive 表示に
なる（意図した挙動として許容。入力自体は拒否しない）。

### parseYearInput の仕様（A-006 の確定）

- 受け付ける表記: `"1600"` / `"-100"` / `"前100"`（全角数字・前後空白は正規化して受理）。
- `"0"` / `"前0"` / `"-0"` → `E-YEAR-ZERO`（メッセージ: 「0年は存在しません（前1年の翌年は西暦1年です）」）。
- 整数と解釈できない・±99999超 → `E-YEAR-FORMAT`。
- 表示は常に `formatYear`（「前100」形式。US-005で確定済み）。

### 検算表（単体テストに転記する。glossary.md との一致を固定）

| 生年 | 表示年 | 期待値 | 根拠 |
|---|---|---|---|
| 1543 | 1600 | alive 57 | US-004 成功指標 |
| 1543(没1616) | 1700 | virtual 157 | US-002 |
| 1543 | 1500 | blank | 生前 |
| 1543(没1616) | 1543 / 1616 | alive 0 / alive 73 | 境界 |
| 1980(存命) | 2100 | virtual 120 | 現在年=2026想定・未来年 |
| 前100 | 前100 | alive 0 | US-005 |
| 前100 | 前50 | alive 50 | 紀元前同士: B−C = 100−50 |
| 前100 | 西暦1 | alive 100 | 紀元またぎ: Y+B−1 = 1+100−1 |
| 前1(死没なし) | 西暦1 | alive 1 | 最小の紀元またぎ（astro 0 → 1） |

### 10年境界の検算表（decadeStart の境界ケース。単体テストに転記する）

| 年（stored） | astro | 属する10年列 | 根拠 |
|---|---|---|---|
| 前1000 | -999 | 前1000〜前991（dStart astro -999） | 紀元前規則: floor((-999-1)/10)*10+1 = -999 |
| 前991 | -990 | 前1000〜前991 | 同上（バケット終端） |
| 前10 | -9 | 前10〜前1（dStart astro -9） | 紀元前規則 |
| 前1 | 0 | 前10〜前1 | 紀元前規則（バケット終端） |
| 西暦1 | 1 | 1〜9（dStart astro 1・9年バケット） | 例外規則 |
| 西暦9 | 9 | 1〜9 | 例外規則（バケット終端） |
| 西暦10 | 10 | 10〜19 | 西暦規則 |
| 1600 | 1600 | 1600〜1609 | 西暦規則 |

## 2. query.ts — 行の導出（並び替え・絞り込み・検索）と範囲決定

グリッドは「表示行 = person id の配列」を受け取るだけにする（ADR 0003）。
導出パイプライン: `persons → sort → tagFilter → 表示行`。検索は行を減らさず該当行を指す。

```ts
export function sortedPersonIds(timeline: Timeline): string[];
  // sortMode='birthAsc': (toAstro(birth.year), 生月, 生日, name, id) の昇順で安定ソート
  //   （月日は参考情報だが同年生まれの表示順の安定化にのみ使う。無指定は月13/日32扱いで末尾）
  // sortMode='manual'  : personOrder の順。personOrder に無い id は末尾（追加順）、
  //                      存在しない id は無視（防御。正規には検証で弾かれる）
export function filterByTags(ids: string[], persons: Person[], selectedTags: string[]): string[];
  // OR条件（選択タグのいずれかを持つ人物を残す）。選択0個 = 全件
export function filterEventsByTags(events: TimelineEvent[], selectedTags: string[]): TimelineEvent[];
  // イベントも同じOR条件。選択0個 = 全件。絞り込み中はタグを持たないイベントも非表示
  // （人物と対称の規則。US-008 の2026-08-12差分）
export function allTags(timeline: Timeline): string[];
  // 人物・イベントの tags の和集合（出現順）。タグ選択UI・フォームの「登録済みタグ」候補の源
export function searchPersons(ids: string[], persons: Person[], query: string): string[];
  // 名前の部分一致で該当する id を表示行順で返す。正規化: NFKC + toLowerCase + trim。
  // 空クエリ = ヒットなし扱い（検索UIを閉じた状態）
```

### 表示範囲の自動決定（US-006）

```ts
export function autoRange(timeline: Timeline, currentYear: StoredYear): { start: StoredYear; end: StoredYear };
```

- start = min(全人物の生年, 全イベントの年)。end = max(全人物の没年, 全イベントの年, 現在年)。
  最後に `end = max(end, start)` でクランプする（生年・イベント年がすべて現在年より未来、
  という入力でも反転しない防御）。
- 人物もイベントも0件のとき: `{ start: 現在年−99, end: 現在年 }`（空状態表示と併用。ui-timeline-grid.md）。
- 実効範囲 = `view.startYear ?? autoRange().start` 〜 `view.endYear ?? autoRange().end`
  （開始・終了は独立に手動指定できる。US-006）。
- start > end になる手動指定はフォーム側で拒否する（E-RANGE-INVERTED）。
- 指定範囲に生存期間もイベントも重ならない場合もエラーにせず描画し、
  「該当なし」バナーを出す（US-006 異常系。判定: 全人物で
  `[birth, death||currentYear]` と範囲の交差なし かつ 範囲内イベント0件）。

### イベントの列集計（US-003、ADR 0003）

```ts
export function eventsByColumn(events: TimelineEvent[], zoom: 'year' | 'decade'): Map<number, TimelineEvent[]>;
  // key: zoom='year' → toAstro(event.year)、zoom='decade' → decadeStart(toAstro(event.year))
  // 各配列は (year, month(無指定は末尾), day(同), name) 昇順。データ変更時のみ再計算（memo）
```

## 3. 性能上の規約

- ここに載る関数はすべて O(n)（n = 人物数 or イベント数）以下。保証スケール
  （1000人・5000件）で1フレーム（16ms）内に収まることをテストフェーズで実測する。
- グリッドセルの描画パスで配列の再生成・全件走査をしない（cellValue は O(1)）。
- `sortedPersonIds` / `filterByTags` / `eventsByColumn` の結果はデータ・条件が変わったときのみ
  再計算する（Zustand セレクタ + メモ化）。
