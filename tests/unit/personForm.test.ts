import { describe, expect, it } from 'vitest';

import {
  emptyPersonFormValues,
  PERSON_FORM_MESSAGES,
  personToFormValues,
  personalEventsOf,
  validatePersonForm,
  type PersonFormErrorField,
  type PersonFormErrorCode,
  type PersonFormValues,
} from '../../src/client/components/personFormModel';
import {
  addTag,
  availableTags,
  removeTag,
  tagSuggestions,
} from '../../src/client/components/tagPickerModel';
import { personSchema, timelineSchema, type Person } from '../../src/domain/schema';

// 人物フォームの検証ロジックと削除フロー分岐・タグピッカーのロジック（TASK-105 /
// ui-forms-dialogs.md 1章）。エラーIDカタログの文言・受け入れ条件
// （生年1600没年1550拒否・前100/-100受理・0拒否）をここで固定する。

function values(patch: Partial<PersonFormValues>): PersonFormValues {
  return { ...emptyPersonFormValues(), ...patch };
}

// 有効な最小フォーム（名前+生年）をベースに一部だけ変える
function valid(patch: Partial<PersonFormValues> = {}): PersonFormValues {
  return values({ name: '徳川家康', birthYear: '1543', ...patch });
}

function expectFieldError(
  v: PersonFormValues,
  field: PersonFormErrorField,
  code: PersonFormErrorCode,
): void {
  const result = validatePersonForm(v);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[field]).toBe(code);
  }
}

describe('validatePersonForm: 正常系', () => {
  it('名前+生年+没年で ok（家康 1543–1616）', () => {
    const result = validatePersonForm(valid({ deathYear: '1616' }));
    expect(result).toEqual({
      ok: true,
      person: { name: '徳川家康', birth: { year: 1543 }, death: { year: 1616 }, tags: [] },
    });
  });

  it('生成した person は id を付ければ personSchema を通る（境界検証との整合）', () => {
    const result = validatePersonForm(
      valid({ birthMonth: '12', birthDay: '26', deathYear: '1616', deathMonth: '4', tags: ['戦国'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => personSchema.parse({ ...result.person, id: 'p_test' })).not.toThrow();
    }
  });

  it('没年空欄 = 存命（death キー自体を持たない）', () => {
    const result = validatePersonForm(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('death' in result.person).toBe(false);
    }
  });

  it('月日未指定は birth に month/day キー自体を持たない', () => {
    const result = validatePersonForm(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('month' in result.person.birth).toBe(false);
      expect('day' in result.person.birth).toBe(false);
    }
  });

  it('月日指定は数値として person に載る', () => {
    const result = validatePersonForm(
      valid({ birthMonth: '12', birthDay: '26', deathYear: '1616', deathMonth: '4', deathDay: '17' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.person.birth).toEqual({ year: 1543, month: 12, day: 26 });
      expect(result.person.death).toEqual({ year: 1616, month: 4, day: 17 });
    }
  });

  it('名前の前後空白は trim される', () => {
    const result = validatePersonForm(valid({ name: '  徳川家康  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.person.name).toBe('徳川家康');
    }
  });

  it('同年没（0歳）は許可', () => {
    expect(validatePersonForm(valid({ birthYear: '1600', deathYear: '1600' })).ok).toBe(true);
  });

  it('紀元またぎ（生 前100・没 50）は許可', () => {
    const result = validatePersonForm(valid({ birthYear: '前100', deathYear: '50' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.person.birth.year).toBe(-100);
      expect(result.person.death?.year).toBe(50);
    }
  });

  it('タグは防御的に trim・空除去・重複除去される', () => {
    const result = validatePersonForm(valid({ tags: [' 戦国 ', '戦国', '', '大名'] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.person.tags).toEqual(['戦国', '大名']);
    }
  });
});

describe('validatePersonForm: 生年の受理/拒否（受け入れ条件 A-006）', () => {
  it.each([
    ['前100', -100],
    ['-100', -100],
    ['1600', 1600],
    ['１６００', 1600], // 全角
    [' 1600 ', 1600], // 前後空白
  ])('「%s」は受理して %d に正規化', (input, expected) => {
    const result = validatePersonForm(valid({ birthYear: input }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.person.birth.year).toBe(expected);
    }
  });

  it('「0」は E-YEAR-ZERO で拒否', () => {
    expectFieldError(valid({ birthYear: '0' }), 'birthYear', 'E-YEAR-ZERO');
  });

  it('「前0」も E-YEAR-ZERO', () => {
    expectFieldError(valid({ birthYear: '前0' }), 'birthYear', 'E-YEAR-ZERO');
  });

  it.each([['abc'], ['15 43'], ['100000'], ['']])('「%s」は E-YEAR-FORMAT', (input) => {
    expectFieldError(valid({ birthYear: input }), 'birthYear', 'E-YEAR-FORMAT');
  });
});

describe('validatePersonForm: エラー系', () => {
  it('名前空欄 → E-P-NAME-EMPTY', () => {
    expectFieldError(valid({ name: '' }), 'name', 'E-P-NAME-EMPTY');
  });

  it('名前が空白のみ → E-P-NAME-EMPTY', () => {
    expectFieldError(valid({ name: '   ' }), 'name', 'E-P-NAME-EMPTY');
  });

  it('生年1600・没年1550 → E-P-DEATH-BEFORE-BIRTH（受け入れ条件）', () => {
    expectFieldError(
      valid({ birthYear: '1600', deathYear: '1550' }),
      'deathYear',
      'E-P-DEATH-BEFORE-BIRTH',
    );
  });

  it('紀元前同士の逆転（生 前100・没 前150）も E-P-DEATH-BEFORE-BIRTH', () => {
    expectFieldError(
      valid({ birthYear: '前100', deathYear: '前150' }),
      'deathYear',
      'E-P-DEATH-BEFORE-BIRTH',
    );
  });

  it('没年の形式不正は E-YEAR-FORMAT（逆転判定より優先）', () => {
    expectFieldError(valid({ deathYear: 'abc' }), 'deathYear', 'E-YEAR-FORMAT');
  });

  it('没年「0」→ E-YEAR-ZERO', () => {
    expectFieldError(valid({ deathYear: '0' }), 'deathYear', 'E-YEAR-ZERO');
  });

  it('生日だけ指定（生月なし）→ E-DAY-WITHOUT-MONTH', () => {
    expectFieldError(valid({ birthDay: '5' }), 'birthDay', 'E-DAY-WITHOUT-MONTH');
  });

  it('没日だけ指定（没月なし）→ E-DAY-WITHOUT-MONTH', () => {
    expectFieldError(
      valid({ deathYear: '1616', deathDay: '17' }),
      'deathDay',
      'E-DAY-WITHOUT-MONTH',
    );
  });

  it('没月だけ指定して没年空欄 → 黙って捨てず没年欄に E-YEAR-FORMAT', () => {
    expectFieldError(valid({ deathMonth: '4' }), 'deathYear', 'E-YEAR-FORMAT');
  });

  it('複数エラーは同時に報告される（フィールドごとのインライン表示のため）', () => {
    const result = validatePersonForm(
      values({ name: '', birthYear: '0', deathYear: 'x', birthDay: '5' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual({
        name: 'E-P-NAME-EMPTY',
        birthYear: 'E-YEAR-ZERO',
        deathYear: 'E-YEAR-FORMAT',
        birthDay: 'E-DAY-WITHOUT-MONTH',
      });
    }
  });
});

describe('エラーメッセージのカタログ（文言の正は ui-forms-dialogs.md 1章）', () => {
  it.each([
    ['E-P-NAME-EMPTY', '名前は必須です'],
    ['E-YEAR-FORMAT', '年の形式が正しくありません（例: 1600、前100、-100）'],
    ['E-YEAR-ZERO', '0年は存在しません（前1年の翌年は西暦1年です）'],
    ['E-P-DEATH-BEFORE-BIRTH', '没年は生年以降にしてください'],
    ['E-DAY-WITHOUT-MONTH', '日を指定する場合は月も指定してください'],
  ] as const)('%s → 「%s」', (code, message) => {
    expect(PERSON_FORM_MESSAGES[code]).toBe(message);
  });
});

describe('personToFormValues（編集時の初期値）', () => {
  const person: Person = personSchema.parse({
    id: 'p_ieyasu',
    name: '徳川家康',
    birth: { year: 1543, month: 12, day: 26 },
    death: { year: 1616 },
    tags: ['戦国', '天下人'],
  });

  it('年は表示形（formatYear）・月日は文字列・タグはコピー', () => {
    expect(personToFormValues(person)).toEqual({
      name: '徳川家康',
      birthYear: '1543',
      birthMonth: '12',
      birthDay: '26',
      deathYear: '1616',
      deathMonth: '',
      deathDay: '',
      tags: ['戦国', '天下人'],
    });
  });

  it('紀元前の年は「前N」形で往復できる', () => {
    const bc: Person = personSchema.parse({
      id: 'p_bc',
      name: '卑弥呼',
      birth: { year: -100 },
      tags: [],
    });
    const formValues = personToFormValues(bc);
    expect(formValues.birthYear).toBe('前100');
    const result = validatePersonForm(formValues);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.person.birth.year).toBe(-100);
    }
  });

  it('personToFormValues → validatePersonForm の往復で同じ person に戻る', () => {
    const result = validatePersonForm(personToFormValues(person));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { id: _id, ...input } = person;
      expect(result.person).toEqual(input);
    }
  });
});

describe('personalEventsOf（削除フローの分岐材料。US-001）', () => {
  const timeline = timelineSchema.parse({
    id: 'tl_1',
    name: '戦国',
    persons: [
      { id: 'p_ieyasu', name: '徳川家康', birth: { year: 1543 }, tags: [] },
      { id: 'p_masamune', name: '伊達政宗', birth: { year: 1567 }, tags: [] },
    ],
    events: [
      { id: 'e_1', name: '関ヶ原の戦い', year: 1600, personId: 'p_ieyasu', tags: [] },
      { id: 'e_2', name: '徳川家康死去', year: 1616, personId: 'p_ieyasu', tags: [] },
      { id: 'e_3', name: '慶長の大地震', year: 1605, tags: [] }, // 全体イベント
      { id: 'e_4', name: '独眼竜正宗', year: 1584, personId: 'p_masamune', tags: [] },
    ],
    sortMode: 'birthAsc',
    personOrder: [],
    view: { startYear: null, endYear: null, zoom: 'year' },
  });

  it('個人イベントあり → その人物のイベントだけを返す（3択に進む）', () => {
    expect(personalEventsOf(timeline, 'p_ieyasu').map((e) => e.id)).toEqual(['e_1', 'e_2']);
  });

  it('個人イベントなし（全体イベントは数えない）→ 空配列（2択に進む）', () => {
    const withoutOwn = timelineSchema.parse({
      ...timeline,
      events: timeline.events.filter((e) => e.personId !== 'p_masamune'),
    });
    expect(personalEventsOf(withoutOwn, 'p_masamune')).toEqual([]);
  });
});

describe('tagPickerModel（付与・除去・候補・サジェスト）', () => {
  const registered = ['戦国', '大名', '天下人', '武将'];

  it('addTag: trim して付与する', () => {
    expect(addTag(['戦国'], ' 大名 ')).toEqual(['戦国', '大名']);
  });

  it('addTag: 同名の重複付与は無視（参照同一 = 変化なし）', () => {
    const assigned = ['戦国'];
    expect(addTag(assigned, '戦国')).toBe(assigned);
  });

  it('addTag: 空・空白のみは無視', () => {
    const assigned = ['戦国'];
    expect(addTag(assigned, '   ')).toBe(assigned);
  });

  it('addTag: 30文字超は無視（schema の tag 上限と同値）', () => {
    const assigned: string[] = [];
    expect(addTag(assigned, 'あ'.repeat(31))).toBe(assigned);
    expect(addTag(assigned, 'あ'.repeat(30))).toEqual(['あ'.repeat(30)]);
  });

  it('addTag: 50個到達で無視（schema の tags 上限と同値）', () => {
    const assigned = Array.from({ length: 50 }, (_, i) => `t${i}`);
    expect(addTag(assigned, '追加')).toBe(assigned);
  });

  it('removeTag: 指定タグだけ除去', () => {
    expect(removeTag(['戦国', '大名'], '戦国')).toEqual(['大名']);
  });

  it('availableTags: 未付与のみ・登録順を保つ', () => {
    expect(availableTags(registered, ['大名'])).toEqual(['戦国', '天下人', '武将']);
  });

  it('tagSuggestions: 空入力 = 未付与の全候補', () => {
    expect(tagSuggestions(registered, ['戦国'], '')).toEqual(['大名', '天下人', '武将']);
  });

  it('tagSuggestions: 部分一致で絞り込む（前後空白は無視）', () => {
    expect(tagSuggestions(registered, [], ' 名 ')).toEqual(['大名']);
  });

  it('tagSuggestions: 付与済みは候補に出さない', () => {
    expect(tagSuggestions(registered, ['大名'], '名')).toEqual([]);
  });
});
