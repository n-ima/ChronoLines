import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CURRENT_SCHEMA_VERSION,
  personSchema,
  storeSchema,
  timelineEventSchema,
  timelineSchema,
  yearSchema,
  type Person,
  type Store,
} from '../../src/domain/schema';
import { cellValue, type StoredYear } from '../../src/domain/year';

// ---- ヘルパー: 検証結果の可読なアサーション ----

function expectValid(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  // 失敗時に issue 一覧が diff に出るようにする
  expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([]);
}

function expectInvalid(schema: z.ZodType, value: unknown, expectedMessage: string): void {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }
  expect(result.error.issues.map((i) => i.message)).toContain(expectedMessage);
}

// ---- ヘルパー: テストデータビルダー（上書きで違反ケースを作る） ----

const validPerson = (overrides: Record<string, unknown> = {}) => ({
  id: 'p_1',
  name: '徳川家康',
  birth: { year: 1543 },
  death: { year: 1616 },
  ...overrides,
});

const validEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'e_1',
  name: '関ヶ原の戦い',
  year: 1600,
  ...overrides,
});

const validTimeline = (overrides: Record<string, unknown> = {}) => ({
  id: 'tl_1',
  name: '戦国',
  persons: [],
  events: [],
  sortMode: 'birthAsc',
  personOrder: [],
  view: { startYear: null, endYear: null, zoom: 'year' },
  ...overrides,
});

const validStore = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  activeTimelineId: 'tl_1',
  timelines: [validTimeline()],
  ...overrides,
});

it('CURRENT_SCHEMA_VERSION は 1（data-model.md 2章）', () => {
  expect(CURRENT_SCHEMA_VERSION).toBe(1);
});

// ---- 境界値表（data-model.md 7章）「年」行 ----

describe('yearSchema: 整数・0禁止・±99999。前N = -N（ADR 0004）', () => {
  it('1600 を受理し値はそのまま', () => {
    expect(yearSchema.parse(1600)).toBe(1600);
  });
  it('前100 = -100 を受理', () => {
    expect(yearSchema.parse(-100)).toBe(-100);
  });
  it('0年は拒否', () => {
    expectInvalid(yearSchema, 0, '0年は存在しません（前1年の翌年は西暦1年です）');
  });
  it('境界: ±99999 は受理', () => {
    expect(yearSchema.parse(99999)).toBe(99999);
    expect(yearSchema.parse(-99999)).toBe(-99999);
  });
  it('境界: ±100000 は拒否', () => {
    expectInvalid(yearSchema, 100000, '年は±99999の範囲で入力してください');
    expectInvalid(yearSchema, -100000, '年は±99999の範囲で入力してください');
  });
  it('非整数（1600.5）は拒否', () => {
    expect(yearSchema.safeParse(1600.5).success).toBe(false);
  });
  it('数値以外（文字列 "1600"）は拒否', () => {
    expect(yearSchema.safeParse('1600').success).toBe(false);
  });
});

// ---- 境界値表「没年 >= 生年」行（toAstro 比較・同年可） ----

describe('personSchema: 没年 >= 生年（年の全順序で判定。同年 = 0歳没は許可）', () => {
  it('生1543 没1616 を受理', () => {
    expectValid(personSchema, validPerson());
  });
  it('同年没（生1600 没1600）を受理', () => {
    expectValid(personSchema, validPerson({ birth: { year: 1600 }, death: { year: 1600 } }));
  });
  it('没年 < 生年（生1600 没1550）は拒否', () => {
    expectInvalid(
      personSchema,
      validPerson({ birth: { year: 1600 }, death: { year: 1550 } }),
      '没年は生年以降にしてください',
    );
  });
  it('紀元またぎ: 生前1 没西暦1 を受理（前1年 < 西暦1年）', () => {
    expectValid(personSchema, validPerson({ birth: { year: -1 }, death: { year: 1 } }));
  });
  it('紀元またぎの逆転: 生西暦1 没前1 は拒否', () => {
    expectInvalid(
      personSchema,
      validPerson({ birth: { year: 1 }, death: { year: -1 } }),
      '没年は生年以降にしてください',
    );
  });
  it('紀元前同士: 生前100 没前50 を受理、生前50 没前100 は拒否', () => {
    expectValid(personSchema, validPerson({ birth: { year: -100 }, death: { year: -50 } }));
    expectInvalid(
      personSchema,
      validPerson({ birth: { year: -50 }, death: { year: -100 } }),
      '没年は生年以降にしてください',
    );
  });
  it('没年なし（存命）を受理', () => {
    expectValid(personSchema, validPerson({ death: undefined }));
  });
});

// ---- 境界値表「月/日」行 ----

describe('月/日: 月 1〜12・日 1〜31・日は月必須・実在日チェックはしない（A-005）', () => {
  it('境界: 月 1 / 12 を受理、0 / 13 は拒否', () => {
    expectValid(personSchema, validPerson({ birth: { year: 1543, month: 1 } }));
    expectValid(personSchema, validPerson({ birth: { year: 1543, month: 12 } }));
    expect(personSchema.safeParse(validPerson({ birth: { year: 1543, month: 0 } })).success).toBe(false);
    expect(personSchema.safeParse(validPerson({ birth: { year: 1543, month: 13 } })).success).toBe(false);
  });
  it('境界: 日 1 / 31 を受理、0 / 32 は拒否', () => {
    expectValid(personSchema, validPerson({ birth: { year: 1543, month: 1, day: 1 } }));
    expectValid(personSchema, validPerson({ birth: { year: 1543, month: 1, day: 31 } }));
    expect(personSchema.safeParse(validPerson({ birth: { year: 1543, month: 1, day: 0 } })).success).toBe(false);
    expect(personSchema.safeParse(validPerson({ birth: { year: 1543, month: 1, day: 32 } })).success).toBe(false);
  });
  it('日だけ指定（月なし）は拒否: birth', () => {
    expectInvalid(
      personSchema,
      validPerson({ birth: { year: 1543, day: 5 } }),
      '日を指定する場合は月も指定してください',
    );
  });
  it('日だけ指定（月なし）は拒否: death', () => {
    expectInvalid(
      personSchema,
      validPerson({ death: { year: 1616, day: 5 } }),
      '日を指定する場合は月も指定してください',
    );
  });
  it('日だけ指定（月なし）は拒否: event', () => {
    expectInvalid(
      timelineEventSchema,
      validEvent({ day: 21 }),
      '日を指定する場合は月も指定してください',
    );
  });
  it('実在日チェックはしない: 2月30日を受理（参考情報のため）', () => {
    expectValid(personSchema, validPerson({ birth: { year: 1543, month: 2, day: 30 } }));
  });
});

// ---- 境界値表「名前/年表名」行 ----

describe('名前/年表名: trim 後 1文字以上。人物・イベント名 100 文字・年表名 50 文字以内', () => {
  it('人物名: 空文字・空白のみは拒否（trim 後に判定）', () => {
    expectInvalid(personSchema, validPerson({ name: '' }), '名前は必須です');
    expectInvalid(personSchema, validPerson({ name: '   ' }), '名前は必須です');
  });
  it('人物名: 前後空白は trim されて保存される', () => {
    const result = personSchema.parse(validPerson({ name: ' 家康 ' }));
    expect(result.name).toBe('家康');
  });
  it('人物名: 境界 100 文字は受理、101 文字は拒否', () => {
    expectValid(personSchema, validPerson({ name: 'あ'.repeat(100) }));
    expect(personSchema.safeParse(validPerson({ name: 'あ'.repeat(101) })).success).toBe(false);
  });
  it('イベント名: 空は拒否、境界 100 / 101 文字', () => {
    expectInvalid(timelineEventSchema, validEvent({ name: '' }), 'イベント名は必須です');
    expectValid(timelineEventSchema, validEvent({ name: 'あ'.repeat(100) }));
    expect(timelineEventSchema.safeParse(validEvent({ name: 'あ'.repeat(101) })).success).toBe(false);
  });
  it('年表名: 空は拒否、境界 50 / 51 文字', () => {
    expectInvalid(timelineSchema, validTimeline({ name: '' }), '年表名は必須です');
    expectValid(timelineSchema, validTimeline({ name: 'あ'.repeat(50) }));
    expect(timelineSchema.safeParse(validTimeline({ name: 'あ'.repeat(51) })).success).toBe(false);
  });
});

// ---- 境界値表「タグ」行 ----

describe('タグ: 1〜30文字・1件あたり最大50個・省略時は []', () => {
  it('tags 省略時は既定値 [] が入る（人物・イベント）', () => {
    expect(personSchema.parse(validPerson()).tags).toEqual([]);
    expect(timelineEventSchema.parse(validEvent()).tags).toEqual([]);
  });
  it('境界: 30 文字タグは受理、31 文字は拒否', () => {
    expectValid(personSchema, validPerson({ tags: ['あ'.repeat(30)] }));
    expect(personSchema.safeParse(validPerson({ tags: ['あ'.repeat(31)] })).success).toBe(false);
  });
  it('空文字・空白のみのタグは拒否（trim 後 1 文字以上）', () => {
    expect(personSchema.safeParse(validPerson({ tags: [''] })).success).toBe(false);
    expect(personSchema.safeParse(validPerson({ tags: ['  '] })).success).toBe(false);
  });
  it('境界: 50 個は受理、51 個は拒否', () => {
    const tags50 = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expectValid(personSchema, validPerson({ tags: tags50 }));
    expect(personSchema.safeParse(validPerson({ tags: [...tags50, 'tag50'] })).success).toBe(false);
  });
  it('イベントのタグにも同じ規則が効く（2026-08-12 差分: イベントにもタグ）', () => {
    expectValid(timelineEventSchema, validEvent({ tags: ['合戦'] }));
    expect(timelineEventSchema.safeParse(validEvent({ tags: ['あ'.repeat(31)] })).success).toBe(false);
  });
});

// ---- 境界値表「メモ」行 ----

describe('メモ: 2000 文字以内', () => {
  it('境界: 2000 文字は受理、2001 文字は拒否', () => {
    expectValid(timelineEventSchema, validEvent({ note: 'あ'.repeat(2000) }));
    expect(timelineEventSchema.safeParse(validEvent({ note: 'あ'.repeat(2001) })).success).toBe(false);
  });
  it('note 省略可・personId 省略可（全体イベント）', () => {
    expectValid(timelineEventSchema, validEvent());
  });
});

// ---- strictObject: 未知フィールドの拒否 ----

describe('strictObject: 未知フィールドを拒否する', () => {
  it('person / timeline / view / store の未知キーはすべて拒否', () => {
    expect(personSchema.safeParse(validPerson({ unknownKey: 1 })).success).toBe(false);
    expect(timelineSchema.safeParse(validTimeline({ unknownKey: 1 })).success).toBe(false);
    expect(
      timelineSchema.safeParse(
        validTimeline({ view: { startYear: null, endYear: null, zoom: 'year', unknownKey: 1 } }),
      ).success,
    ).toBe(false);
    expect(storeSchema.safeParse(validStore({ unknownKey: 1 })).success).toBe(false);
  });
});

// ---- timeline / store の形式 ----

describe('timelineSchema: sortMode / view', () => {
  it('sortMode は birthAsc | manual のみ', () => {
    expectValid(timelineSchema, validTimeline({ sortMode: 'manual', personOrder: [] }));
    expect(timelineSchema.safeParse(validTimeline({ sortMode: 'nameAsc' })).success).toBe(false);
  });
  it('zoom は year | decade のみ', () => {
    expectValid(timelineSchema, validTimeline({ view: { startYear: null, endYear: null, zoom: 'decade' } }));
    expect(
      timelineSchema.safeParse(validTimeline({ view: { startYear: null, endYear: null, zoom: 'month' } })).success,
    ).toBe(false);
  });
  it('view.startYear/endYear は null（自動）または有効年。0 年は拒否', () => {
    expectValid(timelineSchema, validTimeline({ view: { startYear: 1543, endYear: 1636, zoom: 'year' } }));
    expectValid(timelineSchema, validTimeline({ view: { startYear: -100, endYear: null, zoom: 'year' } }));
    expect(
      timelineSchema.safeParse(validTimeline({ view: { startYear: 0, endYear: null, zoom: 'year' } })).success,
    ).toBe(false);
  });
});

describe('storeSchema: 形式', () => {
  it('正常な最小ストアを受理', () => {
    expectValid(storeSchema, validStore());
  });
  it('schemaVersion は literal 1（2 や欠落は拒否）', () => {
    expect(storeSchema.safeParse(validStore({ schemaVersion: 2 })).success).toBe(false);
    expect(storeSchema.safeParse({ activeTimelineId: 'tl_1', timelines: [validTimeline()] }).success).toBe(false);
  });
  it('timelines は 1 件以上（空配列は拒否）', () => {
    expect(storeSchema.safeParse(validStore({ timelines: [] })).success).toBe(false);
  });
  it('activeTimelineId は空文字不可', () => {
    expect(storeSchema.safeParse(validStore({ activeTimelineId: '' })).success).toBe(false);
  });
});

// ---- 参照整合性 5 規則（data-model.md 2章の superRefine） ----

describe('参照整合性: 正常系（5 規則をすべて満たすストア）', () => {
  const fullStore = () => ({
    schemaVersion: 1,
    activeTimelineId: 'tl_2',
    timelines: [
      validTimeline({
        id: 'tl_1',
        persons: [
          validPerson({ id: 'p_1' }),
          validPerson({ id: 'p_2', name: '伊達政宗', birth: { year: 1567 }, death: { year: 1636 } }),
        ],
        events: [
          validEvent({ id: 'e_1', personId: 'p_1' }),
          validEvent({ id: 'e_2', name: '大坂の陣', year: 1615 }),
        ],
        sortMode: 'manual',
        personOrder: ['p_2', 'p_1'],
      }),
      validTimeline({ id: 'tl_2', name: '幕末' }),
    ],
  });
  it('複数年表・個人イベント・manual 並びを含むストアを受理', () => {
    expectValid(storeSchema, fullStore());
  });
  it('activeTimelineId が 2 番目の年表でも一致すれば受理', () => {
    expectValid(storeSchema, fullStore());
    expectValid(storeSchema, { ...fullStore(), activeTimelineId: 'tl_1' });
  });
});

describe('E-STORE-ACTIVE-MISSING: activeTimelineId は timelines[].id のいずれかに一致する', () => {
  it('存在しない id を指すと違反', () => {
    expectInvalid(storeSchema, validStore({ activeTimelineId: 'tl_missing' }), 'E-STORE-ACTIVE-MISSING');
  });
  it('issue の path は activeTimelineId を指す', () => {
    const result = storeSchema.safeParse(validStore({ activeTimelineId: 'tl_missing' }));
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const issue = result.error.issues.find((i) => i.message === 'E-STORE-ACTIVE-MISSING');
    expect(issue?.path).toEqual(['activeTimelineId']);
  });
});

describe('E-STORE-DUP-TIMELINE: timelines[].id は重複しない', () => {
  it('同一 id の年表が 2 つあると違反', () => {
    expectInvalid(
      storeSchema,
      validStore({
        timelines: [validTimeline({ id: 'tl_1' }), validTimeline({ id: 'tl_1', name: '幕末' })],
      }),
      'E-STORE-DUP-TIMELINE',
    );
  });
});

describe('E-STORE-DUP-ID: 各 timeline 内で person id / event id は重複しない', () => {
  it('同一 timeline 内の person id 重複は違反', () => {
    expectInvalid(
      storeSchema,
      validStore({
        timelines: [
          validTimeline({
            persons: [validPerson({ id: 'p_1' }), validPerson({ id: 'p_1', name: '伊達政宗' })],
          }),
        ],
      }),
      'E-STORE-DUP-ID',
    );
  });
  it('同一 timeline 内の event id 重複は違反', () => {
    expectInvalid(
      storeSchema,
      validStore({
        timelines: [
          validTimeline({
            events: [validEvent({ id: 'e_1' }), validEvent({ id: 'e_1', name: '大坂の陣', year: 1615 })],
          }),
        ],
      }),
      'E-STORE-DUP-ID',
    );
  });
  it('別 timeline 間の同一 person id は違反にならない（規則は「各 timeline 内」）', () => {
    expectValid(
      storeSchema,
      validStore({
        timelines: [
          validTimeline({ id: 'tl_1', persons: [validPerson({ id: 'p_1' })] }),
          validTimeline({ id: 'tl_2', name: '幕末', persons: [validPerson({ id: 'p_1' })] }),
        ],
      }),
    );
  });
});

describe('E-STORE-EVENT-ORPHAN: event.personId は同一 timeline の persons[].id に存在する', () => {
  it('存在しない personId を指すと違反', () => {
    const store = validStore({
      timelines: [
        validTimeline({
          persons: [validPerson({ id: 'p_1' })],
          events: [validEvent({ personId: 'p_missing' })],
        }),
      ],
    });
    expectInvalid(storeSchema, store, 'E-STORE-EVENT-ORPHAN');
    const result = storeSchema.safeParse(store);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.message === 'E-STORE-EVENT-ORPHAN');
      expect(issue?.path).toEqual(['timelines', 0, 'events', 0, 'personId']);
    }
  });
  it('別の timeline にだけ存在する person を指しても違反（同一 timeline 内で解決する）', () => {
    expectInvalid(
      storeSchema,
      validStore({
        timelines: [
          validTimeline({ id: 'tl_1', persons: [validPerson({ id: 'p_1' })] }),
          validTimeline({ id: 'tl_2', name: '幕末', events: [validEvent({ personId: 'p_1' })] }),
        ],
      }),
      'E-STORE-EVENT-ORPHAN',
    );
  });
  it('personId 未指定（全体イベント）は違反にならない', () => {
    expectValid(
      storeSchema,
      validStore({ timelines: [validTimeline({ events: [validEvent()] })] }),
    );
  });
});

describe('E-STORE-ORDER-MISMATCH: manual のとき personOrder は persons の id 集合と一致（過不足なし）', () => {
  const manualTimeline = (personOrder: string[]) =>
    validTimeline({
      persons: [validPerson({ id: 'p_1' }), validPerson({ id: 'p_2', name: '伊達政宗', birth: { year: 1567 } })],
      sortMode: 'manual',
      personOrder,
    });
  it('一致（順序は自由）なら受理', () => {
    expectValid(storeSchema, validStore({ timelines: [manualTimeline(['p_2', 'p_1'])] }));
  });
  it('不足（1 人欠け）は違反', () => {
    expectInvalid(storeSchema, validStore({ timelines: [manualTimeline(['p_1'])] }), 'E-STORE-ORDER-MISMATCH');
  });
  it('過剰（存在しない id を含む）は違反', () => {
    expectInvalid(
      storeSchema,
      validStore({ timelines: [manualTimeline(['p_1', 'p_2', 'p_3'])] }),
      'E-STORE-ORDER-MISMATCH',
    );
  });
  it('重複エントリ（[p_1, p_1]）は違反', () => {
    expectInvalid(storeSchema, validStore({ timelines: [manualTimeline(['p_1', 'p_1'])] }), 'E-STORE-ORDER-MISMATCH');
  });
  it('persons 0 人 + personOrder 空なら受理', () => {
    expectValid(
      storeSchema,
      validStore({ timelines: [validTimeline({ sortMode: 'manual', personOrder: [] })] }),
    );
  });
  it('birthAsc のときは personOrder の過不足を判定しない（手動順の保持を許す。data-model.md 4章）', () => {
    expectValid(
      storeSchema,
      validStore({
        timelines: [
          validTimeline({
            persons: [validPerson({ id: 'p_1' })],
            sortMode: 'birthAsc',
            personOrder: ['p_old_1', 'p_old_2'],
          }),
        ],
      }),
    );
  });
});

describe('参照整合性: 複数違反は同時にすべて報告される', () => {
  it('ACTIVE-MISSING + DUP-ID + EVENT-ORPHAN + ORDER-MISMATCH を 1 回の検証で全部検出する', () => {
    const result = storeSchema.safeParse({
      schemaVersion: 1,
      activeTimelineId: 'tl_missing',
      timelines: [
        validTimeline({
          persons: [validPerson({ id: 'p_1' }), validPerson({ id: 'p_1', name: '伊達政宗' })],
          events: [validEvent({ personId: 'p_x' })],
          sortMode: 'manual',
          personOrder: ['p_1'],
        }),
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const messages = result.error.issues.map((i) => i.message);
    expect(messages).toContain('E-STORE-ACTIVE-MISSING');
    expect(messages).toContain('E-STORE-DUP-ID');
    expect(messages).toContain('E-STORE-EVENT-ORPHAN');
    expect(messages).toContain('E-STORE-ORDER-MISMATCH');
  });
});

// ---- year.ts との型整合（TASK-002 からの引き継ぎ: ブランド型方針の検証） ----

describe('ブランド型: parse 結果の年は StoredYear を持ち year.ts にそのまま渡せる', () => {
  it('parse した Person をキャストなしで cellValue に渡せる（構造型 PersonLifespan を満たす）', () => {
    const store: Store = storeSchema.parse(
      validStore({ timelines: [validTimeline({ persons: [validPerson()] })] }),
    );
    const person: Person | undefined = store.timelines[0]?.persons[0];
    expect(person).toBeDefined();
    if (person === undefined) {
      return;
    }
    // 型レベル検証: yearSchema の出力・Person の年フィールドに StoredYear ブランドが付いている
    const birthYear: StoredYear = person.birth.year;
    const current: StoredYear = yearSchema.parse(2026);
    expect(cellValue(person, birthYear, current)).toEqual({ kind: 'alive', age: 0 });
    expect(cellValue(person, yearSchema.parse(1600), current)).toEqual({ kind: 'alive', age: 57 });
  });
});
