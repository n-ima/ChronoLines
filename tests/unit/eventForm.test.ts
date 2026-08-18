import { describe, expect, it } from 'vitest';

import {
  emptyEventFormValues,
  EVENT_FORM_MESSAGES,
  eventToFormValues,
  validateEventForm,
  type EventFormErrorCode,
  type EventFormErrorField,
  type EventFormValues,
} from '../../src/client/components/eventFormModel';
import { timelineEventSchema, type TimelineEvent } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';

// イベントフォームの検証ロジック（TASK-106 / ui-forms-dialogs.md 2章）。
// エラーIDカタログの文言・受け入れ条件（関ヶ原の戦い1600年の登録・年空欄はエラー・
// 年ヘッダー右クリックの年初期値）をここで固定する。

function values(patch: Partial<EventFormValues>): EventFormValues {
  return { ...emptyEventFormValues(), ...patch };
}

// 有効な最小フォーム（イベント名+年）をベースに一部だけ変える
function valid(patch: Partial<EventFormValues> = {}): EventFormValues {
  return values({ name: '関ヶ原の戦い', year: '1600', ...patch });
}

function expectFieldError(
  v: EventFormValues,
  field: EventFormErrorField,
  code: EventFormErrorCode,
): void {
  const result = validateEventForm(v);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[field]).toBe(code);
  }
}

describe('validateEventForm: 正常系', () => {
  it('イベント名+年で ok（関ヶ原の戦い 1600年 = 受け入れ条件）', () => {
    const result = validateEventForm(valid());
    expect(result).toEqual({
      ok: true,
      event: { name: '関ヶ原の戦い', year: 1600, tags: [] },
    });
  });

  it('生成した event は id を付ければ timelineEventSchema を通る（境界検証との整合）', () => {
    const result = validateEventForm(
      valid({ month: '9', day: '15', note: '天下分け目の合戦。', personId: 'p_x', tags: ['合戦'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => timelineEventSchema.parse({ ...result.event, id: 'e_test' })).not.toThrow();
    }
  });

  it('月日未指定は month/day キー自体を持たない', () => {
    const result = validateEventForm(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('month' in result.event).toBe(false);
      expect('day' in result.event).toBe(false);
    }
  });

  it('月日指定は数値として event に載る', () => {
    const result = validateEventForm(valid({ month: '9', day: '15' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.month).toBe(9);
      expect(result.event.day).toBe(15);
    }
  });

  it('月のみ指定（日なし）は許可', () => {
    const result = validateEventForm(valid({ month: '9' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.month).toBe(9);
      expect('day' in result.event).toBe(false);
    }
  });

  it('メモ空欄は note キー自体を持たない（空白のみも同様）', () => {
    const empty = validateEventForm(valid({ note: '' }));
    const blank = validateEventForm(valid({ note: '   ' }));
    expect(empty.ok && !('note' in empty.event)).toBe(true);
    expect(blank.ok && !('note' in blank.event)).toBe(true);
  });

  it('メモはそのまま載る', () => {
    const result = validateEventForm(valid({ note: '天下分け目の合戦。東軍勝利。' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.note).toBe('天下分け目の合戦。東軍勝利。');
    }
  });

  it('紐付けなし（personId=""）は personId キー自体を持たない = 全体イベント', () => {
    const result = validateEventForm(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('personId' in result.event).toBe(false);
    }
  });

  it('紐付けあり = 個人イベント（US-003）', () => {
    const result = validateEventForm(valid({ personId: 'p_ieyasu' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.personId).toBe('p_ieyasu');
    }
  });

  it('イベント名の前後空白は trim される', () => {
    const result = validateEventForm(valid({ name: '  関ヶ原の戦い  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.name).toBe('関ヶ原の戦い');
    }
  });

  it('タグは防御的に trim・空除去・重複除去される', () => {
    const result = validateEventForm(valid({ tags: [' 合戦 ', '合戦', '', '政治'] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.tags).toEqual(['合戦', '政治']);
    }
  });
});

describe('validateEventForm: 年の受理/拒否（parseYearInput が正。A-006）', () => {
  it.each([
    ['前100', -100],
    ['-100', -100],
    ['1600', 1600],
    ['１６００', 1600], // 全角
    [' 1600 ', 1600], // 前後空白
  ])('「%s」は受理して %d に正規化', (input, expected) => {
    const result = validateEventForm(valid({ year: input }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.year).toBe(expected);
    }
  });

  it('年空欄は E-YEAR-FORMAT（受け入れ条件: 年空欄で登録 → エラー）', () => {
    expectFieldError(valid({ year: '' }), 'year', 'E-YEAR-FORMAT');
  });

  it('「0」は E-YEAR-ZERO で拒否', () => {
    expectFieldError(valid({ year: '0' }), 'year', 'E-YEAR-ZERO');
  });

  it.each([['abc'], ['16 00'], ['100000']])('「%s」は E-YEAR-FORMAT', (input) => {
    expectFieldError(valid({ year: input }), 'year', 'E-YEAR-FORMAT');
  });
});

describe('validateEventForm: エラー系', () => {
  it('イベント名空欄 → E-E-NAME-EMPTY', () => {
    expectFieldError(valid({ name: '' }), 'name', 'E-E-NAME-EMPTY');
  });

  it('イベント名が空白のみ → E-E-NAME-EMPTY', () => {
    expectFieldError(valid({ name: '   ' }), 'name', 'E-E-NAME-EMPTY');
  });

  it('日だけ指定（月なし）→ E-DAY-WITHOUT-MONTH', () => {
    expectFieldError(valid({ day: '15' }), 'day', 'E-DAY-WITHOUT-MONTH');
  });

  it('複数エラーは同時に報告される（フィールドごとのインライン表示のため）', () => {
    const result = validateEventForm(values({ name: '', year: '0', day: '15' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual({
        name: 'E-E-NAME-EMPTY',
        year: 'E-YEAR-ZERO',
        day: 'E-DAY-WITHOUT-MONTH',
      });
    }
  });
});

describe('エラーメッセージのカタログ（文言の正は ui-forms-dialogs.md 1〜2章）', () => {
  it.each([
    ['E-E-NAME-EMPTY', 'イベント名は必須です'],
    ['E-YEAR-FORMAT', '年の形式が正しくありません（例: 1600、前100、-100）'],
    ['E-YEAR-ZERO', '0年は存在しません（前1年の翌年は西暦1年です）'],
    ['E-DAY-WITHOUT-MONTH', '日を指定する場合は月も指定してください'],
  ] as const)('%s → 「%s」', (code, message) => {
    expect(EVENT_FORM_MESSAGES[code]).toBe(message);
  });
});

describe('emptyEventFormValues（新規追加の初期値）', () => {
  it('引数なし → 年は空欄', () => {
    expect(emptyEventFormValues().year).toBe('');
  });

  it('initialYear 指定 → 年が初期値で入る（年ヘッダー右クリック = 受け入れ条件）', () => {
    expect(emptyEventFormValues(1600 as StoredYear).year).toBe('1600');
  });

  it('紀元前の initialYear は「前N」形で入り、validate 往復で同じ年に戻る', () => {
    const initial = emptyEventFormValues(-100 as StoredYear);
    expect(initial.year).toBe('前100');
    const result = validateEventForm({ ...initial, name: '事変' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.year).toBe(-100);
    }
  });
});

describe('eventToFormValues（編集時の初期値）', () => {
  const event: TimelineEvent = timelineEventSchema.parse({
    id: 'e_sekigahara',
    name: '関ヶ原の戦い',
    year: 1600,
    month: 9,
    day: 15,
    note: '天下分け目の合戦。東軍勝利。',
    personId: 'p_ieyasu',
    tags: ['合戦'],
  });

  it('年は表示形（formatYear）・月日は文字列・note/personId/tags はコピー', () => {
    expect(eventToFormValues(event)).toEqual({
      name: '関ヶ原の戦い',
      year: '1600',
      month: '9',
      day: '15',
      note: '天下分け目の合戦。東軍勝利。',
      personId: 'p_ieyasu',
      tags: ['合戦'],
    });
  });

  it('任意項目なしのイベントは空文字で初期化される', () => {
    const minimal = timelineEventSchema.parse({
      id: 'e_min',
      name: '大地震',
      year: 1605,
      tags: [],
    });
    expect(eventToFormValues(minimal)).toEqual({
      name: '大地震',
      year: '1605',
      month: '',
      day: '',
      note: '',
      personId: '',
      tags: [],
    });
  });

  it('紀元前の年は「前N」形で往復できる', () => {
    const bc = timelineEventSchema.parse({
      id: 'e_bc',
      name: 'カンナエの戦い',
      year: -216,
      tags: [],
    });
    const formValues = eventToFormValues(bc);
    expect(formValues.year).toBe('前216');
    const result = validateEventForm(formValues);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.year).toBe(-216);
    }
  });

  it('eventToFormValues → validateEventForm の往復で同じ event に戻る', () => {
    const result = validateEventForm(eventToFormValues(event));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { id: _id, ...input } = event;
      expect(result.event).toEqual(input);
    }
  });
});
