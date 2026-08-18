// TASK-108: 10年ズームのモデルロジック単体テスト。
// - 10年列生成（gridColumns / columnKeyAstro / columnLabel）は domain-logic.md 1章の
//   「10年境界の検算表」8行（decadeStart の境界ケース）と screen-02 の見出しに整合させる。
// - 集約セル判定（decadeCellValue）は ui-timeline-grid.md 5章の規則と screen-02 の
//   集約表現（decadeCell）に整合させる。
// - 中心年保持（centerYearAstro / scrollLeftForCenterYear）は US-007 受け入れ条件
//   （切替前の中心年が切替後も表示範囲に含まれる）を座標計算として検証する。
import { describe, expect, it } from 'vitest';

import {
  CELL_W,
  CELL_W_DECADE,
  NAME_COL_W,
  centerYearAstro,
  columnKeyAstro,
  columnLabel,
  columnWidth,
  columnYear,
  decadeCellValue,
  decadeRangeLabel,
  gridColumns,
  scrollLeftForCenterYear,
  type GridColumns,
} from '../../src/client/components/timelineGridModel';
import {
  ageRowText,
  decadeAgeRows,
  groupEventsByYear,
  panelColumnLabel,
} from '../../src/client/components/selectionModel';
import type { Person, Timeline, TimelineEvent } from '../../src/domain/schema';
import type { AstroYear, StoredYear } from '../../src/domain/year';

const sy = (n: number) => n as StoredYear;
const ay = (n: number) => n as AstroYear;

const person = (
  id: string,
  name: string,
  birthYear: number,
  deathYear?: number,
): Person => ({
  id,
  name,
  birth: { year: sy(birthYear) },
  death: deathYear === undefined ? undefined : { year: sy(deathYear) },
  tags: [],
});

const timeline = (overrides: Partial<Timeline> = {}): Timeline => ({
  id: 'tl_1',
  name: 'テスト年表',
  persons: [],
  events: [],
  sortMode: 'birthAsc',
  personOrder: [],
  view: { startYear: null, endYear: null, zoom: 'year' },
  ...overrides,
});

const event = (id: string, year: number, name = `イベント${id}`): TimelineEvent => ({
  id,
  name,
  year: sy(year),
  tags: [],
});

const ieyasu = person('p_ieyasu', '徳川家康', 1543, 1616);
const CUR = sy(2026);

describe('gridColumns（10年列生成。domain-logic.md 1章の10年境界検算表と整合）', () => {
  it('前1000〜西暦19 の範囲は 102 列（紀元前100個 + 9年バケット1個 + 10〜19 の1個）', () => {
    const t = timeline({ view: { startYear: sy(-1000), endYear: sy(19), zoom: 'decade' } });
    const cols = gridColumns(t, CUR);
    expect(cols.zoom).toBe('decade');
    expect(cols.startAstro).toBe(-999); // 前1000 の属する 前1000〜前991（dStart astro -999）
    expect(cols.count).toBe(102);
  });

  it('境界の列キーとラベル: 前1000〜 / 前990〜 / 前10〜 / 1〜（9年バケット） / 10〜', () => {
    const t = timeline({ view: { startYear: sy(-1000), endYear: sy(19), zoom: 'decade' } });
    const cols = gridColumns(t, CUR);
    // 検算表: 前1000(astro -999)・前991(astro -990) → dStart astro -999
    expect(columnKeyAstro(cols, 0)).toBe(-999);
    expect(columnYear(cols, 0)).toBe(-1000);
    expect(columnLabel(cols, 0)).toBe('前1000〜');
    expect(columnLabel(cols, 1)).toBe('前990〜'); // screen-02 の見出し並び
    // 検算表: 前10(astro -9)・前1(astro 0) → dStart astro -9
    expect(columnKeyAstro(cols, 99)).toBe(-9);
    expect(columnLabel(cols, 99)).toBe('前10〜');
    // 検算表: 西暦1・西暦9 → dStart astro 1（9年バケット）
    expect(columnKeyAstro(cols, 100)).toBe(1);
    expect(columnLabel(cols, 100)).toBe('1〜');
    // 検算表: 西暦10 → dStart astro 10
    expect(columnKeyAstro(cols, 101)).toBe(10);
    expect(columnLabel(cols, 101)).toBe('10〜');
  });

  it('検算表: 1600 は 1600〜1609 の列（範囲 1595〜1620 は 1590/1600/1610/1620 の4列）', () => {
    const t = timeline({ view: { startYear: sy(1595), endYear: sy(1620), zoom: 'decade' } });
    const cols = gridColumns(t, CUR);
    expect(cols.startAstro).toBe(1590);
    expect(cols.count).toBe(4);
    expect(columnKeyAstro(cols, 1)).toBe(1600);
    expect(decadeRangeLabel(columnKeyAstro(cols, 1))).toBe('1600〜1609');
  });

  it('1000年分の範囲で列数が 1/10 になる（US-007 実行時確認の計算根拠）', () => {
    const yearT = timeline({ view: { startYear: sy(1000), endYear: sy(1999), zoom: 'year' } });
    const decadeT = timeline({ view: { startYear: sy(1000), endYear: sy(1999), zoom: 'decade' } });
    expect(gridColumns(yearT, CUR).count).toBe(1000);
    expect(gridColumns(decadeT, CUR).count).toBe(100);
  });

  it('列幅はズームで切り替わる（--cell-w 44 / --cell-w-decade 72）', () => {
    const yearCols = gridColumns(timeline(), CUR);
    const decadeCols = gridColumns(
      timeline({ view: { startYear: null, endYear: null, zoom: 'decade' } }),
      CUR,
    );
    expect(columnWidth(yearCols)).toBe(CELL_W);
    expect(columnWidth(decadeCols)).toBe(CELL_W_DECADE);
  });

  it('反転した手動指定（開始 > 終了）でも列数が負にならない（1年ズームと同じ防御）', () => {
    const t = timeline({ view: { startYear: sy(1700), endYear: sy(1600), zoom: 'decade' } });
    expect(gridColumns(t, CUR).count).toBe(1);
  });
});

describe('decadeRangeLabel（区間の全範囲表記。パネル見出し等）', () => {
  it('西暦 "1600〜1609"・紀元前 "前1000〜前991"・9年バケット "1〜9"・紀元またぎ "前10〜前1"', () => {
    expect(decadeRangeLabel(ay(1600))).toBe('1600〜1609');
    expect(decadeRangeLabel(ay(-999))).toBe('前1000〜前991');
    expect(decadeRangeLabel(ay(1))).toBe('1〜9');
    expect(decadeRangeLabel(ay(-9))).toBe('前10〜前1');
  });
});

describe('decadeCellValue（集約セル判定。ui-timeline-grid.md 5章 / screen-02）', () => {
  it('家康 1543–1616: 1530年代=blank・1540年代=alive 0+生年マーカー', () => {
    expect(decadeCellValue(ieyasu, ay(1530), CUR)).toEqual({ kind: 'blank' });
    expect(decadeCellValue(ieyasu, ay(1540), CUR)).toEqual({
      kind: 'alive',
      age: 0, // 開始年より後の生まれは 0（5章）
      birthMarker: true,
      deathMarker: false,
    });
  });

  it('家康: 1600年代=alive 57（区間開始年の年齢）・1610年代=alive 67+没年マーカー', () => {
    expect(decadeCellValue(ieyasu, ay(1600), CUR)).toEqual({
      kind: 'alive',
      age: 57,
      birthMarker: false,
      deathMarker: false,
    });
    expect(decadeCellValue(ieyasu, ay(1610), CUR)).toEqual({
      kind: 'alive',
      age: 67,
      birthMarker: false,
      deathMarker: true,
    });
  });

  it('家康: 1620年代 = 全期間が没後 → virtual (77)', () => {
    expect(decadeCellValue(ieyasu, ay(1620), CUR)).toEqual({ kind: 'virtual', age: 77 });
  });

  it('三成 1560–1600: 没年が区間の開始年でも alive（40）+没年マーカー（screen-02 と同値）', () => {
    const mitsunari = person('p_m', '石田三成', 1560, 1600);
    expect(decadeCellValue(mitsunari, ay(1600), CUR)).toEqual({
      kind: 'alive',
      age: 40,
      birthMarker: false,
      deathMarker: true,
    });
  });

  it('生年・没年が同じ区間なら両端マーカー（1584–1589 → alive 0 + 両マーカー）', () => {
    expect(decadeCellValue(person('p_s', '短命', 1584, 1589), ay(1580), CUR)).toEqual({
      kind: 'alive',
      age: 0,
      birthMarker: true,
      deathMarker: true,
    });
  });

  it('存命者: 現在年を含む区間は alive・全期間が未来なら virtual（cellValue 規則3の集約）', () => {
    const living = person('p_l', '存命者', 1980);
    expect(decadeCellValue(living, ay(2020), CUR)).toEqual({
      kind: 'alive',
      age: 40,
      birthMarker: false,
      deathMarker: false,
    });
    expect(decadeCellValue(living, ay(2030), CUR)).toEqual({ kind: 'virtual', age: 50 });
  });

  it('紀元またぎ: 前5生〜西暦3没は 前10〜前1 = alive 0+生年、1〜9 = alive 5+没年（Y+B−1 と整合）', () => {
    const bc = person('p_bc', '紀元またぎ', -5, 3);
    expect(decadeCellValue(bc, ay(-9), CUR)).toEqual({
      kind: 'alive',
      age: 0,
      birthMarker: true,
      deathMarker: false,
    });
    // 開始年 = 西暦1 の年齢 = ageAt(前5, 西暦1) = 1 + 5 − 1 = 5（検算表の紀元またぎ式）
    expect(decadeCellValue(bc, ay(1), CUR)).toEqual({
      kind: 'alive',
      age: 5,
      birthMarker: false,
      deathMarker: true,
    });
  });

  it('9年バケットの終端: 西暦9生は 1〜9 に含まれ、西暦10生は含まれない（blank）', () => {
    expect(decadeCellValue(person('p_9', '九年生', 9), ay(1), CUR)).toEqual({
      kind: 'alive',
      age: 0,
      birthMarker: true,
      deathMarker: false,
    });
    expect(decadeCellValue(person('p_10', '十年生', 10), ay(1), CUR)).toEqual({ kind: 'blank' });
  });
});

describe('centerYearAstro / scrollLeftForCenterYear（切替時の中心年保持。US-007）', () => {
  // 1000〜1999 の1000年分（実行時確認と同じスケール）。ビューポート 1000px（セル可視域 800px）
  const yearCols: GridColumns = { zoom: 'year', startAstro: ay(1000), count: 1000 };
  const decadeCols: GridColumns = { zoom: 'decade', startAstro: ay(1000), count: 100 };
  const VW = 1000;

  it('1年ズーム: 指定年を中心に置く scrollLeft を返し、逆算で同じ年に戻る（往復整合）', () => {
    const left = scrollLeftForCenterYear(yearCols, ay(1500), VW);
    // index 500 の中心(500*44+22)からセル可視域の半分(400)を引いた位置
    expect(left).toBe(500 * CELL_W + CELL_W / 2 - (VW - NAME_COL_W) / 2);
    expect(centerYearAstro(yearCols, left, VW)).toBe(1500);
  });

  it('1年→10年: 中心年の属する10年列が可視範囲に含まれる位置になる', () => {
    const center = ay(1504);
    const left = scrollLeftForCenterYear(decadeCols, center, VW);
    // 1504 の属する列 = 1500〜1509（index 50）。列全体がセル可視域 [left, left+800] に入る
    const colLeft = 50 * CELL_W_DECADE;
    expect(colLeft).toBeGreaterThanOrEqual(left);
    expect(colLeft + CELL_W_DECADE).toBeLessThanOrEqual(left + (VW - NAME_COL_W));
    // 10年→1年に戻したときの中心年が保持される（列内位置の比例配分による往復整合）
    expect(centerYearAstro(decadeCols, left, VW)).toBe(1504);
  });

  it('範囲の端では 0〜最大スクロールにクランプされ、中心列も範囲内にクランプされる', () => {
    expect(scrollLeftForCenterYear(yearCols, ay(1000), VW)).toBe(0);
    const maxScroll = NAME_COL_W + 1000 * CELL_W - VW;
    expect(scrollLeftForCenterYear(yearCols, ay(1999), VW)).toBe(maxScroll);
    // 過大な scrollLeft でも最終列の年を返す（防御）
    expect(centerYearAstro(yearCols, 10 ** 9, VW)).toBe(1999);
  });

  it('9年バケットでも比例配分の往復が成立する（西暦5 → 1〜9 列 → 西暦5）', () => {
    const bcCols: GridColumns = { zoom: 'decade', startAstro: ay(-999), count: 102 };
    // クランプの影響を受けない位置関係で純粋な往復を確認する
    const index = 100; // 1〜9 の列
    const centerX = index * CELL_W_DECADE + ((4 + 0.5) / 9) * CELL_W_DECADE; // 西暦5 の中心
    const left = centerX - (VW - NAME_COL_W) / 2;
    expect(centerYearAstro(bcCols, left, VW)).toBe(5);
  });

  it('コンテンツ末尾へのクランプ時も中心年の列は可視範囲に含まれる（含有保証）', () => {
    const bcCols: GridColumns = { zoom: 'decade', startAstro: ay(-999), count: 102 };
    const vw = 800; // セル可視域 600px
    const left = scrollLeftForCenterYear(bcCols, ay(5), vw);
    const maxScroll = NAME_COL_W + 102 * CELL_W_DECADE - vw;
    expect(left).toBe(maxScroll); // 末尾付近のためクランプされる
    const colLeft = 100 * CELL_W_DECADE; // 1〜9 の列
    expect(colLeft).toBeGreaterThanOrEqual(left);
    expect(colLeft + CELL_W_DECADE).toBeLessThanOrEqual(left + (vw - NAME_COL_W));
  });
});

describe('panelColumnLabel / groupEventsByYear / decadeAgeRows（パネルの10年対応）', () => {
  it('見出し: 1年 = 「1600年」、10年 = 範囲「1600〜1609」「前1000〜前991」（4章）', () => {
    expect(panelColumnLabel('year', sy(1600))).toBe('1600年');
    expect(panelColumnLabel('decade', sy(1600))).toBe('1600〜1609');
    expect(panelColumnLabel('decade', sy(-1000))).toBe('前1000〜前991');
  });

  it('groupEventsByYear: ソート済み入力を出現順のまま年別グループに区切る', () => {
    const groups = groupEventsByYear([
      event('e1', 1600, '関ヶ原の戦い'),
      event('e2', 1600, '家康上洛'),
      event('e3', 1603, '江戸幕府成立'),
    ]);
    expect(groups.map((g) => g.year)).toEqual([1600, 1603]);
    expect(groups[0]?.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(groups[1]?.events.map((e) => e.id)).toEqual(['e3']);
    expect(groupEventsByYear([])).toEqual([]);
  });

  it('decadeAgeRows: セル（decadeCellValue）と同じ判定・ageRowText と同じ書式', () => {
    const later = person('p_later', '後世人', 1650, 1700);
    const rows = decadeAgeRows([ieyasu, later], sy(1620), CUR);
    expect(rows[0]?.value).toEqual({ kind: 'virtual', age: 77 }); // 家康は没後
    expect(rows[1]?.value).toEqual({ kind: 'blank' }); // 後世人は生前
    expect(ageRowText(rows[0]!.value)).toBe('(77)');
    expect(ageRowText(rows[1]!.value)).toBe('—（生前）');
    // alive はマーカー情報を落とした {kind, age} になる（セルと同じ数値・書式）
    const aliveRows = decadeAgeRows([ieyasu], sy(1600), CUR);
    expect(aliveRows[0]?.value).toEqual({ kind: 'alive', age: 57 });
    expect(ageRowText(aliveRows[0]!.value)).toBe('57');
  });
});
