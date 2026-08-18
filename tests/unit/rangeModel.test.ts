// 表示範囲指定と空状態のモデル（rangeModel.ts）の単体テスト（TASK-112 /
// ui-timeline-grid.md 7章 / domain-logic.md 2章 / US-006）。
// 範囲入力の解釈（parseYearInput 経由・E-RANGE-INVERTED・エラー優先順）・
// 実効範囲とプレースホルダ（view ?? autoRange）・「範囲内に該当なし」バナー判定・
// 空の年表（空状態表示）判定を検証する。parseYearInput 自体の検算の正は year.test.ts。
import { describe, expect, it } from 'vitest';

import type { Person, Timeline, TimelineEvent } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';
import {
  RANGE_ERROR_MESSAGES,
  effectiveRange,
  hasNoMatchInRange,
  isTimelineEmpty,
  noMatchBannerText,
  parseRangeInputs,
  rangeInputValues,
  rangePlaceholders,
} from '../../src/client/components/rangeModel';

const sy = (n: number) => n as StoredYear;

const person = (id: string, name: string, birthYear: number, deathYear?: number): Person => ({
  id,
  name,
  birth: { year: sy(birthYear) },
  ...(deathYear === undefined ? {} : { death: { year: sy(deathYear) } }),
  tags: [],
});

const event = (id: string, name: string, year: number): TimelineEvent => ({
  id,
  name,
  year: sy(year),
  tags: [],
});

const timeline = (
  persons: Person[],
  events: TimelineEvent[],
  view: Partial<Timeline['view']> = {},
): Timeline => ({
  id: 'tl_1',
  name: '戦国',
  persons,
  events,
  sortMode: 'birthAsc',
  personOrder: [],
  view: { startYear: null, endYear: null, zoom: 'year', ...view },
});

// 完了条件の実行時確認と同じデータ形: 1543〜1636（家康 1543–1616・政宗 1567–1636 + 関ヶ原 1600）
const sengoku = (view: Partial<Timeline['view']> = {}) =>
  timeline(
    [person('p_ieyasu', '徳川家康', 1543, 1616), person('p_masamune', '伊達政宗', 1567, 1636)],
    [event('e_sekigahara', '関ヶ原の戦い', 1600)],
    view,
  );

const CURRENT = sy(2026);

describe('parseRangeInputs（範囲入力の解釈。空欄=自動・エラー時は適用しない）', () => {
  it('両方空欄 → 自動（start/end とも null）', () => {
    expect(parseRangeInputs('', '')).toEqual({ ok: true, start: null, end: null });
    expect(parseRangeInputs('  ', '　')).toEqual({ ok: true, start: null, end: null });
  });

  it('「1590」「1620」→ そのままの年', () => {
    expect(parseRangeInputs('1590', '1620')).toEqual({ ok: true, start: sy(1590), end: sy(1620) });
  });

  it('「前100」「-50」の紀元前表記を受理する（parseYearInput の3表記）', () => {
    expect(parseRangeInputs('前100', '-50')).toEqual({ ok: true, start: sy(-100), end: sy(-50) });
  });

  it('全角数字・前後空白は正規化して受理する', () => {
    expect(parseRangeInputs('　前１００　', ' １５９０ ')).toEqual({
      ok: true,
      start: sy(-100),
      end: sy(1590),
    });
  });

  it('開始のみ・終了のみの独立指定ができる（US-006）', () => {
    expect(parseRangeInputs('1590', '')).toEqual({ ok: true, start: sy(1590), end: null });
    expect(parseRangeInputs('', '1620')).toEqual({ ok: true, start: null, end: sy(1620) });
  });

  it('整数と解釈できない入力 → E-YEAR-FORMAT（該当フィールドを報告）', () => {
    expect(parseRangeInputs('abc', '1620')).toEqual({
      ok: false,
      code: 'E-YEAR-FORMAT',
      field: 'start',
    });
    expect(parseRangeInputs('1590', '16世紀')).toEqual({
      ok: false,
      code: 'E-YEAR-FORMAT',
      field: 'end',
    });
  });

  it('±99999超 → E-YEAR-FORMAT', () => {
    expect(parseRangeInputs('100000', '')).toEqual({
      ok: false,
      code: 'E-YEAR-FORMAT',
      field: 'start',
    });
  });

  it('0年 → E-YEAR-ZERO（「0」「前0」「-0」）', () => {
    expect(parseRangeInputs('0', '')).toEqual({ ok: false, code: 'E-YEAR-ZERO', field: 'start' });
    expect(parseRangeInputs('', '前0')).toEqual({ ok: false, code: 'E-YEAR-ZERO', field: 'end' });
    expect(parseRangeInputs('-0', '')).toEqual({ ok: false, code: 'E-YEAR-ZERO', field: 'start' });
  });

  it('開始 > 終了 → E-RANGE-INVERTED（完了条件: 1620 > 1590）', () => {
    expect(parseRangeInputs('1620', '1590')).toEqual({
      ok: false,
      code: 'E-RANGE-INVERTED',
      field: 'range',
    });
  });

  it('紀元前同士の反転も astro 軸の全順序で検出する（前50 > 前100）', () => {
    expect(parseRangeInputs('前50', '前100')).toEqual({
      ok: false,
      code: 'E-RANGE-INVERTED',
      field: 'range',
    });
  });

  it('紀元またぎの正順（前100〜1600）・開始=終了は受理する', () => {
    expect(parseRangeInputs('前100', '1600')).toEqual({ ok: true, start: sy(-100), end: sy(1600) });
    expect(parseRangeInputs('1600', '1600')).toEqual({ ok: true, start: sy(1600), end: sy(1600) });
  });

  it('片側が自動（空欄）のときは反転判定をしない（自動値はデータと共に動くため）', () => {
    expect(parseRangeInputs('3000', '')).toEqual({ ok: true, start: sy(3000), end: null });
  });

  it('エラーの優先順は開始 → 終了 → 反転（両方不正なら開始側を報告）', () => {
    expect(parseRangeInputs('abc', '0')).toEqual({
      ok: false,
      code: 'E-YEAR-FORMAT',
      field: 'start',
    });
  });
});

describe('RANGE_ERROR_MESSAGES（エラーIDカタログの文言）', () => {
  it('3エラーとも設計の文言と一致する', () => {
    expect(RANGE_ERROR_MESSAGES['E-YEAR-FORMAT']).toBe(
      '年の形式が正しくありません（例: 1600、前100、-100）',
    );
    expect(RANGE_ERROR_MESSAGES['E-YEAR-ZERO']).toBe(
      '0年は存在しません（前1年の翌年は西暦1年です）',
    );
    expect(RANGE_ERROR_MESSAGES['E-RANGE-INVERTED']).toBe('開始年は終了年以前にしてください');
  });
});

describe('effectiveRange（実効範囲 = view ?? autoRange）', () => {
  it('範囲指定なし → autoRange（1543〜現在年。完了条件の実行時確認と同値）', () => {
    expect(effectiveRange(sengoku(), CURRENT)).toEqual({ start: sy(1543), end: CURRENT });
  });

  it('開始・終了は独立に手動指定できる（片側だけ自動）', () => {
    expect(effectiveRange(sengoku({ startYear: sy(1590) }), CURRENT)).toEqual({
      start: sy(1590),
      end: CURRENT,
    });
    expect(effectiveRange(sengoku({ endYear: sy(1620) }), CURRENT)).toEqual({
      start: sy(1543),
      end: sy(1620),
    });
  });

  it('両方手動なら view の値そのまま', () => {
    expect(effectiveRange(sengoku({ startYear: sy(1200), endYear: sy(1300) }), CURRENT)).toEqual({
      start: sy(1200),
      end: sy(1300),
    });
  });
});

describe('rangePlaceholders（空欄時に自動値を薄く表示）', () => {
  it('「1543（自動）」「2026（自動）」形式（screen-01 の placeholder 書式）', () => {
    expect(rangePlaceholders(sengoku(), CURRENT)).toEqual({
      start: '1543（自動）',
      end: '2026（自動）',
    });
  });

  it('空の年表は autoRange の既定（現在年−99〜現在年）を表示する', () => {
    expect(rangePlaceholders(timeline([], []), CURRENT)).toEqual({
      start: '1927（自動）',
      end: '2026（自動）',
    });
  });

  it('紀元前の自動値は formatYear（「前100」形式）で表示する', () => {
    const tl = timeline([person('p_caesar', 'カエサル', -100, -44)], []);
    expect(rangePlaceholders(tl, CURRENT).start).toBe('前100（自動）');
  });
});

describe('rangeInputValues（入力欄の表示値。表示は常に formatYear）', () => {
  it('自動（null）は空欄、手動指定は formatYear', () => {
    expect(rangeInputValues({ startYear: null, endYear: null, zoom: 'year' })).toEqual({
      start: '',
      end: '',
    });
    expect(rangeInputValues({ startYear: sy(-100), endYear: sy(1600), zoom: 'year' })).toEqual({
      start: '前100',
      end: '1600',
    });
  });
});

describe('isTimelineEmpty（人物0件・イベント0件 = 中央の空状態表示）', () => {
  it('人物0件・イベント0件 → true', () => {
    expect(isTimelineEmpty(timeline([], []))).toBe(true);
  });

  it('人物かイベントのどちらかがあれば false', () => {
    expect(isTimelineEmpty(timeline([person('p_1', '家康', 1543)], []))).toBe(false);
    expect(isTimelineEmpty(timeline([], [event('e_1', '関ヶ原', 1600)]))).toBe(false);
  });
});

describe('hasNoMatchInRange（範囲内に該当なしバナーの判定）', () => {
  it('1200〜1300指定: 生存期間もイベントも重ならない → true（完了条件の実行時確認）', () => {
    expect(hasNoMatchInRange(sengoku({ startYear: sy(1200), endYear: sy(1300) }), CURRENT)).toBe(
      true,
    );
  });

  it('1590〜1620指定: 生存期間が交差する → false', () => {
    expect(hasNoMatchInRange(sengoku({ startYear: sy(1590), endYear: sy(1620) }), CURRENT)).toBe(
      false,
    );
  });

  it('範囲指定なし（自動）はデータの両端を含むため常に false', () => {
    expect(hasNoMatchInRange(sengoku(), CURRENT)).toBe(false);
  });

  it('人物は交差しないがイベントが範囲内 → false（人物・イベントの両方を見る）', () => {
    const tl = timeline(
      [person('p_ieyasu', '徳川家康', 1543, 1616)],
      [event('e_kyoho', '享保の改革', 1716)],
      { startYear: sy(1700), endYear: sy(1750) },
    );
    expect(hasNoMatchInRange(tl, CURRENT)).toBe(false);
  });

  it('没年なしの存命者は現在年まで生存扱いで交差判定する', () => {
    const alive = timeline([person('p_alive', '存命の人', 1980)], [], {
      startYear: sy(2020),
      endYear: sy(2030),
    });
    expect(hasNoMatchInRange(alive, CURRENT)).toBe(false); // [1980, 2026] と交差
    const future = timeline([person('p_alive', '存命の人', 1980)], [], {
      startYear: sy(2027),
      endYear: sy(2100),
    });
    expect(hasNoMatchInRange(future, CURRENT)).toBe(true); // 現在年より先は交差しない
  });

  it('境界の一致（範囲の開始 = 没年）は交差あり → false', () => {
    expect(hasNoMatchInRange(sengoku({ startYear: sy(1636), endYear: sy(1700) }), CURRENT)).toBe(
      false, // 政宗の没年 1636 が範囲開始と一致
    );
    expect(hasNoMatchInRange(sengoku({ startYear: sy(1637), endYear: sy(1700) }), CURRENT)).toBe(
      true,
    );
  });

  it('紀元前の範囲も astro 軸で交差判定する（0年を挟む比較）', () => {
    const caesar = () => [person('p_caesar', 'カエサル', -100, -44)];
    expect(
      hasNoMatchInRange(timeline(caesar(), [], { startYear: sy(-200), endYear: sy(-150) }), CURRENT),
    ).toBe(true);
    expect(
      hasNoMatchInRange(timeline(caesar(), [], { startYear: sy(-50), endYear: sy(1) }), CURRENT),
    ).toBe(false); // [前100, 前44] と [前50, 西暦1] は前50〜前44 で交差
  });

  it('空の年表は false（バナーではなく空状態表示の管轄）', () => {
    expect(
      hasNoMatchInRange(timeline([], [], { startYear: sy(1200), endYear: sy(1300) }), CURRENT),
    ).toBe(false);
  });
});

describe('noMatchBannerText（バナー文言。screen-01 #banner-range のとおり）', () => {
  it('実効範囲を埋め込んだ文言を返す', () => {
    expect(noMatchBannerText(sengoku({ startYear: sy(1200), endYear: sy(1300) }), CURRENT)).toBe(
      '指定した範囲（1200〜1300）に該当する人物・イベントはありません。範囲を変更してください。',
    );
  });

  it('紀元前は formatYear（「前300〜前200」）で表記する', () => {
    expect(noMatchBannerText(sengoku({ startYear: sy(-300), endYear: sy(-200) }), CURRENT)).toBe(
      '指定した範囲（前300〜前200）に該当する人物・イベントはありません。範囲を変更してください。',
    );
  });
});
