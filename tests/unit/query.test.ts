import { describe, expect, it } from 'vitest';

import {
  allTags,
  autoRange,
  eventsByColumn,
  filterByTags,
  filterEventsByTags,
  searchPersons,
  sortedPersonIds,
} from '../../src/domain/query';
import type { Person, Timeline, TimelineEvent } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';

// テストデータの年をブランド型へ持ち上げるヘルパー（テスト内のみ。値は変えない）
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

const event = (
  id: string,
  name: string,
  year: number,
  opts: { month?: number; day?: number; tags?: string[] } = {},
): TimelineEvent => ({
  id,
  name,
  year: sy(year),
  month: opts.month,
  day: opts.day,
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

// domain-logic.md 検算表の「現在年=2026想定」に合わせる
const CURRENT = sy(2026);

// ---- sortedPersonIds（US-008 / domain-logic.md 2章） ----

describe('sortedPersonIds: birthAsc（生年昇順の安定ソート）', () => {
  it('生年の昇順（astro軸）。紀元前→紀元またぎも正しい順序（前100 < 前1 < 西暦1 < 1600）', () => {
    const tl = timeline({
      persons: [
        person('p_d', '丁', { year: 1600 }),
        person('p_a', '甲', { year: -100 }),
        person('p_c', '丙', { year: 1 }),
        person('p_b', '乙', { year: -1 }),
      ],
    });
    expect(sortedPersonIds(tl)).toEqual(['p_a', 'p_b', 'p_c', 'p_d']);
  });

  it('同年生まれは生月→生日の昇順', () => {
    const tl = timeline({
      persons: [
        person('p_3', 'う', { year: 1600, month: 5, day: 1 }),
        person('p_2', 'い', { year: 1600, month: 3, day: 15 }),
        person('p_1', 'あ', { year: 1600, month: 3, day: 1 }),
      ],
    });
    expect(sortedPersonIds(tl)).toEqual(['p_1', 'p_2', 'p_3']);
  });

  it('月日無指定は同年の末尾（月13/日32扱い）', () => {
    const tl = timeline({
      persons: [
        person('p_none', '月なし', { year: 1600 }),
        person('p_noday', '日なし', { year: 1600, month: 12 }),
        person('p_full', '月日あり', { year: 1600, month: 12, day: 31 }),
      ],
    });
    // 12/31 < 12月（日なし=32扱い） < 月なし（13扱い）
    expect(sortedPersonIds(tl)).toEqual(['p_full', 'p_noday', 'p_none']);
  });

  it('年月日まで同じなら名前→idの昇順（全順序 = 入力順に依存しない安定な結果）', () => {
    const tl = timeline({
      persons: [
        person('p_2', 'あ', { year: 1600 }),
        person('p_1', 'い', { year: 1600 }),
        person('p_3', 'あ', { year: 1600 }),
      ],
    });
    // 名前昇順: あ(p_2)・あ(p_3) → id昇順、い(p_1) は最後
    expect(sortedPersonIds(tl)).toEqual(['p_2', 'p_3', 'p_1']);
  });
});

describe('sortedPersonIds: manual（手動並び順）', () => {
  it('personOrder の順で返す（生年は無関係）', () => {
    const tl = timeline({
      sortMode: 'manual',
      persons: [
        person('p_a', '甲', { year: 1500 }),
        person('p_b', '乙', { year: 1600 }),
        person('p_c', '丙', { year: 1700 }),
      ],
      personOrder: ['p_c', 'p_a', 'p_b'],
    });
    expect(sortedPersonIds(tl)).toEqual(['p_c', 'p_a', 'p_b']);
  });

  it('personOrder に無い人物は末尾（persons への追加順）', () => {
    const tl = timeline({
      sortMode: 'manual',
      persons: [
        person('p_a', '甲', { year: 1500 }),
        person('p_b', '乙', { year: 1600 }),
        person('p_c', '丙', { year: 1400 }),
      ],
      personOrder: ['p_b'],
    });
    expect(sortedPersonIds(tl)).toEqual(['p_b', 'p_a', 'p_c']);
  });

  it('persons に存在しない id は無視する（防御。正規には E-STORE-ORDER-MISMATCH で弾かれる）', () => {
    const tl = timeline({
      sortMode: 'manual',
      persons: [person('p_a', '甲', { year: 1500 })],
      personOrder: ['p_x', 'p_a'],
    });
    expect(sortedPersonIds(tl)).toEqual(['p_a']);
  });
});

// ---- filterByTags / filterEventsByTags（US-008。OR条件・人物とイベント対称） ----

describe('filterByTags', () => {
  const persons = [
    person('p_1', '甲', { year: 1500 }, { tags: ['戦国'] }),
    person('p_2', '乙', { year: 1600 }, { tags: ['剣豪'] }),
    person('p_3', '丙', { year: 1700 }, { tags: ['幕末'] }),
    person('p_4', '丁', { year: 1800 }, { tags: [] }),
  ];
  const ids = ['p_1', 'p_2', 'p_3', 'p_4'];

  it('選択0個 = 全件（順序不変）', () => {
    expect(filterByTags(ids, persons, [])).toEqual(ids);
  });

  it('OR条件: 選択タグのいずれかを持つ人物を残す', () => {
    expect(filterByTags(ids, persons, ['戦国', '剣豪'])).toEqual(['p_1', 'p_2']);
  });

  it('絞り込み中はタグを持たない人物は非表示', () => {
    expect(filterByTags(ids, persons, ['戦国'])).toEqual(['p_1']);
    expect(filterByTags(ids, persons, ['戦国'])).not.toContain('p_4');
  });

  it('ids の順序を保つ（並び替えには影響しない）', () => {
    expect(filterByTags(['p_3', 'p_1', 'p_2'], persons, ['戦国', '幕末'])).toEqual(['p_3', 'p_1']);
  });
});

describe('filterEventsByTags', () => {
  const events = [
    event('e_1', '関ヶ原の戦い', 1600, { tags: ['合戦'] }),
    event('e_2', 'タグなし', 1601, { tags: [] }),
    event('e_3', '出版', 1605, { tags: ['文化'] }),
  ];

  it('選択0個 = 全件', () => {
    expect(filterEventsByTags(events, []).map((e) => e.id)).toEqual(['e_1', 'e_2', 'e_3']);
  });

  it('OR条件 + タグを持たないイベントは絞り込み中は非表示（人物と対称の規則）', () => {
    expect(filterEventsByTags(events, ['合戦', '文化']).map((e) => e.id)).toEqual(['e_1', 'e_3']);
    expect(filterEventsByTags(events, ['合戦']).map((e) => e.id)).toEqual(['e_1']);
  });
});

// ---- allTags（タグ選択UI・登録済みタグ候補の源） ----

describe('allTags', () => {
  it('人物→イベントの出現順で和集合（重複は初出のみ残す）', () => {
    const tl = timeline({
      persons: [
        person('p_1', '甲', { year: 1500 }, { tags: ['戦国', '武将'] }),
        person('p_2', '乙', { year: 1600 }, { tags: ['剣豪', '戦国'] }),
      ],
      events: [
        event('e_1', '合戦A', 1600, { tags: ['合戦', '戦国'] }),
        event('e_2', '出版B', 1605, { tags: ['武将', '文化'] }),
      ],
    });
    expect(allTags(tl)).toEqual(['戦国', '武将', '剣豪', '合戦', '文化']);
  });

  it('人物もイベントも0件（またはタグ0個）→ 空配列', () => {
    expect(allTags(timeline())).toEqual([]);
    expect(allTags(timeline({ persons: [person('p_1', '甲', { year: 1500 })] }))).toEqual([]);
  });
});

// ---- searchPersons（US-008。NFKC + toLowerCase + trim） ----

describe('searchPersons', () => {
  it('名前の部分一致で該当 id を表示行順（ids の順）で返す。行は減らさない用途', () => {
    const persons = [
      person('p_1', '徳川家康', { year: 1543 }),
      person('p_2', '家康影武者', { year: 1550 }),
      person('p_3', '伊達政宗', { year: 1567 }),
    ];
    expect(searchPersons(['p_3', 'p_2', 'p_1'], persons, '家康')).toEqual(['p_2', 'p_1']);
  });

  it('NFKC 正規化: 全角英数のクエリが半角の名前にヒットする（大文字小文字も無視）', () => {
    const persons = [person('p_1', 'Tokugawa Ieyasu', { year: 1543 })];
    expect(searchPersons(['p_1'], persons, 'ＴＯＫＵＧＡＷＡ')).toEqual(['p_1']);
    expect(searchPersons(['p_1'], persons, 'IEYASU')).toEqual(['p_1']);
  });

  it('NFKC 正規化: 半角カナの名前に全角カナのクエリがヒットする（名前側にも同じ正規化）', () => {
    const persons = [person('p_1', 'ﾄｸｶﾞﾜ', { year: 1543 })];
    expect(searchPersons(['p_1'], persons, 'トクガワ')).toEqual(['p_1']);
  });

  it('クエリの前後空白（全角空白含む）は trim して照合する', () => {
    const persons = [person('p_1', '徳川家康', { year: 1543 })];
    expect(searchPersons(['p_1'], persons, '  家康  ')).toEqual(['p_1']);
    expect(searchPersons(['p_1'], persons, '　家康　')).toEqual(['p_1']);
  });

  it('空クエリ・空白のみのクエリ = ヒットなし（検索UIを閉じた状態）', () => {
    const persons = [person('p_1', '徳川家康', { year: 1543 })];
    expect(searchPersons(['p_1'], persons, '')).toEqual([]);
    expect(searchPersons(['p_1'], persons, '   ')).toEqual([]);
    expect(searchPersons(['p_1'], persons, '　')).toEqual([]);
  });
});

// ---- autoRange（US-006） ----

describe('autoRange', () => {
  it('人物もイベントも0件: 現在年−99 〜 現在年（100年幅）', () => {
    expect(autoRange(timeline(), CURRENT)).toEqual({ start: 1927, end: 2026 });
  });

  it('start = min(全人物の生年, 全イベントの年)、end = max(全人物の没年, 全イベントの年, 現在年)', () => {
    const tl = timeline({
      persons: [
        person('p_1', '家康', { year: 1543 }, { death: { year: 1616 } }),
        person('p_2', '政宗', { year: 1567 }, { death: { year: 1636 } }),
      ],
      events: [event('e_1', '関ヶ原の戦い', 1600)],
    });
    // 没年1636 より現在年2026 が大きいので end = 現在年
    expect(autoRange(tl, CURRENT)).toEqual({ start: 1543, end: 2026 });
  });

  it('イベント年が最古・最新を決めるケース（現在年より未来のイベントは end を延ばす）', () => {
    const tl = timeline({
      persons: [person('p_1', '家康', { year: 1543 }, { death: { year: 1616 } })],
      events: [event('e_1', '古代イベント', 1500), event('e_2', '未来イベント', 2100)],
    });
    expect(autoRange(tl, CURRENT)).toEqual({ start: 1500, end: 2100 });
  });

  it('没年が現在年より未来 → end は没年', () => {
    const tl = timeline({
      persons: [person('p_1', '未来没', { year: 1980 }, { death: { year: 2100 } })],
    });
    expect(autoRange(tl, CURRENT)).toEqual({ start: 1980, end: 2100 });
  });

  it('存命人物（没年なし）は end を現在年より先へ延ばさない', () => {
    const tl = timeline({ persons: [person('p_1', '存命', { year: 1980 })] });
    expect(autoRange(tl, CURRENT)).toEqual({ start: 1980, end: 2026 });
  });

  it('反転クランプ: 生年がすべて現在年より未来でも start > end にならない（end = max(end, start)）', () => {
    const tl = timeline({ persons: [person('p_1', '未来人', { year: 2100 })] });
    expect(autoRange(tl, CURRENT)).toEqual({ start: 2100, end: 2100 });
  });

  it('紀元前の生年・イベント年も扱える（前100年生まれ → start 前100）', () => {
    const tl = timeline({ persons: [person('p_1', '古代人', { year: -100 })] });
    expect(autoRange(tl, CURRENT)).toEqual({ start: -100, end: 2026 });
  });

  it('0件時の「−99」は astro 軸で計算し、存在しない0年を生まない（現在年99 → 前1〜99）', () => {
    expect(autoRange(timeline(), sy(99))).toEqual({ start: -1, end: 99 });
  });
});

// ---- eventsByColumn（US-003 / ADR 0003） ----

describe('eventsByColumn', () => {
  it("zoom='year': toAstro(event.year) をキーに集約（紀元前は astro キー。前100 → -99）", () => {
    const events = [
      event('e_1', 'あ', 1600),
      event('e_2', 'い', 1600),
      event('e_3', 'う', 1605),
      event('e_4', '古代', -100),
    ];
    const map = eventsByColumn(events, 'year');
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([-99, 1600, 1605]);
    expect(map.get(1600)?.map((e) => e.id)).toEqual(['e_1', 'e_2']);
    expect(map.get(1605)?.map((e) => e.id)).toEqual(['e_3']);
    expect(map.get(-99)?.map((e) => e.id)).toEqual(['e_4']);
  });

  it("zoom='decade': decadeStart をキーに集約（1600〜1609 / 1〜9の9年バケット / 前10〜前1）", () => {
    const events = [
      event('e_1', 'あ', 1609),
      event('e_2', 'い', 1600),
      event('e_3', 'う', 1610),
      event('e_4', '西暦5', 5),
      event('e_5', '西暦9', 9),
      event('e_6', '前1', -1), // astro 0 → dStart -9（前10〜前1）
      event('e_7', '前10', -10), // astro -9 → dStart -9
    ];
    const map = eventsByColumn(events, 'decade');
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([-9, 1, 1600, 1610]);
    // 列内は年（astro）昇順: 1600 < 1609、前10(astro -9) < 前1(astro 0)
    expect(map.get(1600)?.map((e) => e.id)).toEqual(['e_2', 'e_1']);
    expect(map.get(1610)?.map((e) => e.id)).toEqual(['e_3']);
    expect(map.get(1)?.map((e) => e.id)).toEqual(['e_4', 'e_5']);
    expect(map.get(-9)?.map((e) => e.id)).toEqual(['e_7', 'e_6']);
  });

  it('列内ソート: 年 → 月（無指定は末尾）→ 日（無指定は末尾）→ 名前の昇順', () => {
    const events = [
      event('e_nomonth_i', 'い', 1600),
      event('e_m12_noday', '日なし', 1600, { month: 12 }),
      event('e_m12_d31', '月日あり', 1600, { month: 12, day: 31 }),
      event('e_m3', '3月', 1600, { month: 3 }),
      event('e_nomonth_a', 'あ', 1600),
    ];
    const map = eventsByColumn(events, 'year');
    // 3月 < 12/31 < 12月日なし(32扱い) < 月なし(13扱い。同キーは名前昇順: あ < い)
    expect(map.get(1600)?.map((e) => e.id)).toEqual([
      'e_m3',
      'e_m12_d31',
      'e_m12_noday',
      'e_nomonth_a',
      'e_nomonth_i',
    ]);
  });

  it('イベント0件 → 空の Map', () => {
    expect(eventsByColumn([], 'year').size).toBe(0);
    expect(eventsByColumn([], 'decade').size).toBe(0);
  });
});
