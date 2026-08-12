// TimelineGrid の純粋な導出ロジック（timelineGridModel.ts）と タグ配色（tagColor.ts）の
// 単体テスト。セル値そのもの（cellValue）の検算表は year.test.ts が正で、ここでは
// グリッド固有の導出（列の対応・書式・ツールチップ・罫線ガイド）を検証する。
import { describe, expect, it } from 'vitest';

import {
  cellText,
  cellTooltip,
  columnYear,
  gridColumns,
  isDecadeGuideYear,
  lifespanLabel,
  personTooltip,
} from '../../src/client/components/timelineGridModel';
import { TAG_COLOR_COUNT, tagColorIndex, tagDotColor } from '../../src/client/tagColor';
import type { Person, Timeline } from '../../src/domain/schema';
import { cellValue, type StoredYear } from '../../src/domain/year';

const sy = (n: number) => n as StoredYear;

type DateInput = { year: number; month?: number; day?: number };

const person = (
  id: string,
  name: string,
  birth: DateInput,
  opts: { death?: DateInput; tags?: string[] } = {},
): Person => ({
  id,
  name,
  birth: { year: sy(birth.year), month: birth.month, day: birth.day },
  death:
    opts.death === undefined
      ? undefined
      : { year: sy(opts.death.year), month: opts.death.month, day: opts.death.day },
  tags: opts.tags ?? [],
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

const ieyasu = person('p_ieyasu', '徳川家康', { year: 1543 }, { death: { year: 1616 } });

describe('gridColumns / columnYear（実効範囲と列⇔年の対応）', () => {
  it('view が null なら autoRange（生年min〜現在年）で列を作る', () => {
    const cols = gridColumns(timeline({ persons: [ieyasu] }), sy(2026));
    expect(cols.startAstro).toBe(1543);
    expect(cols.count).toBe(2026 - 1543 + 1);
    expect(columnYear(cols, 0)).toBe(1543);
    expect(columnYear(cols, cols.count - 1)).toBe(2026);
  });

  it('view の手動指定（開始・終了は独立）が autoRange より優先される', () => {
    const t = timeline({
      persons: [ieyasu],
      view: { startYear: sy(1500), endYear: sy(1700), zoom: 'year' },
    });
    const cols = gridColumns(t, sy(2026));
    expect(cols.startAstro).toBe(1500);
    expect(cols.count).toBe(201);
  });

  it('紀元前をまたぐ範囲は0年を挟まず連続する（前100〜西暦1 = 101列。ADR 0004）', () => {
    const t = timeline({
      view: { startYear: sy(-100), endYear: sy(1), zoom: 'year' },
    });
    const cols = gridColumns(t, sy(2026));
    expect(cols.count).toBe(101);
    expect(columnYear(cols, 0)).toBe(-100); // 前100
    expect(columnYear(cols, 99)).toBe(-1); // 前1
    expect(columnYear(cols, 100)).toBe(1); // 翌年は西暦1（0年は存在しない）
  });

  it('人物・イベント0件は現在年-99〜現在年の100列（autoRange の既定）', () => {
    const cols = gridColumns(timeline(), sy(2026));
    expect(cols.count).toBe(100);
    expect(columnYear(cols, 0)).toBe(1927);
    expect(columnYear(cols, 99)).toBe(2026);
  });

  it('反転した手動指定（開始 > 終了）でも列数が負にならない（防御。正規はフォームで拒否）', () => {
    const t = timeline({
      view: { startYear: sy(1700), endYear: sy(1600), zoom: 'year' },
    });
    expect(gridColumns(t, sy(2026)).count).toBe(1);
  });
});

describe('cellText（色 + 括弧書式の二重チャネル。US-002 / NFR）', () => {
  it('blank は空欄・alive は数値・virtual は括弧付き数値', () => {
    expect(cellText({ kind: 'blank' })).toBe('');
    expect(cellText({ kind: 'alive', age: 57 })).toBe('57');
    expect(cellText({ kind: 'virtual', age: 157 })).toBe('(157)');
  });

  it('検算表: 家康1543–1616 は 1600=57・1700=(157)・1500=空欄', () => {
    const cur = sy(2026);
    expect(cellText(cellValue(ieyasu, sy(1600), cur))).toBe('57');
    expect(cellText(cellValue(ieyasu, sy(1700), cur))).toBe('(157)');
    expect(cellText(cellValue(ieyasu, sy(1500), cur))).toBe('');
  });

  it('検算表: 前100年生まれは西暦1年 = 100（紀元またぎ。US-005）', () => {
    const bc = person('p_bc', '前100年生', { year: -100 });
    expect(cellText(cellValue(bc, sy(1), sy(2026)))).toBe('100');
  });
});

describe('cellTooltip（screen-01 の title 文言）', () => {
  it('alive: 「1600年 徳川家康 57歳（生存中）」', () => {
    expect(cellTooltip(ieyasu, sy(1600), { kind: 'alive', age: 57 })).toBe(
      '1600年 徳川家康 57歳（生存中）',
    );
  });

  it('virtual（没後）: 「1700年 徳川家康（没後・生きていれば157歳）」', () => {
    expect(cellTooltip(ieyasu, sy(1700), { kind: 'virtual', age: 157 })).toBe(
      '1700年 徳川家康（没後・生きていれば157歳）',
    );
  });

  it('virtual（存命者の未来年）は「没後・」を付けない', () => {
    const living = person('p_l', '存命者', { year: 1980 });
    expect(cellTooltip(living, sy(2100), { kind: 'virtual', age: 120 })).toBe(
      '2100年 存命者（生きていれば120歳）',
    );
  });

  it('blank はツールチップなし', () => {
    expect(cellTooltip(ieyasu, sy(1500), { kind: 'blank' })).toBeUndefined();
  });

  it('紀元前の年は「前N年」表記（US-005 の formatYear）', () => {
    const bc = person('p_bc', 'カエサル', { year: -100 });
    expect(cellTooltip(bc, sy(-50), { kind: 'alive', age: 50 })).toBe(
      '前50年 カエサル 50歳（生存中）',
    );
  });
});

describe('lifespanLabel / personTooltip（人物列の併記とツールチップ）', () => {
  it('没年ありは「1543–1616」、存命は「1980–」', () => {
    expect(lifespanLabel(ieyasu)).toBe('1543–1616');
    expect(lifespanLabel(person('p_l', '存命者', { year: 1980 }))).toBe('1980–');
  });

  it('紀元前は「前100–前44」', () => {
    expect(lifespanLabel(person('p_bc', 'カエサル', { year: -100 }, { death: { year: -44 } }))).toBe(
      '前100–前44',
    );
  });

  it('タグ全件を列挙し、0個は「なし」', () => {
    expect(personTooltip(person('p1', 'a', { year: 1543 }, { tags: ['戦国', '天下人'] }))).toBe(
      'タグ: 戦国、天下人',
    );
    expect(personTooltip(person('p2', 'b', { year: 1543 }))).toBe('タグ: なし');
  });
});

describe('isDecadeGuideYear（10倍数年の縦罫線ガイド）', () => {
  it('10の倍数年（紀元前含む）だけ true', () => {
    expect(isDecadeGuideYear(sy(1600))).toBe(true);
    expect(isDecadeGuideYear(sy(1601))).toBe(false);
    expect(isDecadeGuideYear(sy(-100))).toBe(true); // 前100
    expect(isDecadeGuideYear(sy(-95))).toBe(false);
  });
});

describe('tagColorIndex / tagDotColor（design-tokens.md タグ配色の割り当て規則）', () => {
  it('コードポイント値の和 mod 8 で決定的（「戦国」= (25126+22269) % 8 = 3）', () => {
    expect(tagColorIndex('戦国')).toBe(3);
    expect(tagColorIndex('戦国')).toBe(tagColorIndex('戦国')); // 同名 = 常に同色
  });

  it('結果は常に 0〜7 の範囲', () => {
    for (const name of ['a', '大名', '合戦', 'タグ', '𠮷野']) {
      const idx = tagColorIndex(name);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(TAG_COLOR_COUNT);
    }
  });

  it('サロゲートペアはコードポイント単位で数える（mod 8 の入力が壊れない）', () => {
    // '𠮷'(U+20BB7=134071) + '野'(U+91CE=37326) = 171397 → mod 8 = 5
    expect(tagColorIndex('𠮷野')).toBe(171397 % 8);
  });

  it('tagDotColor は tokens.css の --tag-N-dot を参照する', () => {
    expect(tagDotColor('戦国')).toBe('var(--tag-3-dot)');
  });
});
