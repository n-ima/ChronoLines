// 人物フォームの検証・変換ロジック（ui-forms-dialogs.md 1章 / TASK-105）。
// コンポーネント（React・DOM）から分離して単体テスト可能にする（timelineGridModel と同じ流儀）。
// 年の解釈は parseYearInput（domain/year.ts）が正 = 設計「同じ関数を使う」の具体化。
import type { Person, Timeline, TimelineEvent } from '../../domain/schema';
import { compareStoredYears, formatYear, parseYearInput, type StoredYear } from '../../domain/year';
import type { PersonInput } from '../store/appStore';
import { normalizeTags } from './tagPickerModel';

// フォームの入力状態。select（月・日）は '' = 未指定、'1'〜'12' / '1'〜'31'。
// 年はテキスト（「1543」「前100」「-100」を受理。ui-forms-dialogs.md 1章）
export interface PersonFormValues {
  name: string;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
  deathYear: string; // '' = 存命
  deathMonth: string;
  deathDay: string;
  tags: string[];
}

export type PersonFormErrorCode =
  | 'E-P-NAME-EMPTY'
  | 'E-YEAR-FORMAT'
  | 'E-YEAR-ZERO'
  | 'E-P-DEATH-BEFORE-BIRTH'
  | 'E-DAY-WITHOUT-MONTH';

// エラーID → メッセージ（文言の正は ui-forms-dialogs.md 1章のカタログ）
export const PERSON_FORM_MESSAGES: Record<PersonFormErrorCode, string> = {
  'E-P-NAME-EMPTY': '名前は必須です',
  'E-YEAR-FORMAT': '年の形式が正しくありません（例: 1600、前100、-100）',
  'E-YEAR-ZERO': '0年は存在しません（前1年の翌年は西暦1年です）',
  'E-P-DEATH-BEFORE-BIRTH': '没年は生年以降にしてください',
  'E-DAY-WITHOUT-MONTH': '日を指定する場合は月も指定してください',
};

// エラーを表示するフィールド（インライン表示位置。モックアップ screen-03 のとおり
// 没年関連のエラー = E-P-DEATH-BEFORE-BIRTH は deathYear の直下に出す）
export type PersonFormErrorField = 'name' | 'birthYear' | 'birthDay' | 'deathYear' | 'deathDay';

export type PersonFormErrors = Partial<Record<PersonFormErrorField, PersonFormErrorCode>>;

export type PersonFormValidation =
  | { ok: true; person: PersonInput }
  | { ok: false; errors: PersonFormErrors };

export function emptyPersonFormValues(): PersonFormValues {
  return {
    name: '',
    birthYear: '',
    birthMonth: '',
    birthDay: '',
    deathYear: '',
    deathMonth: '',
    deathDay: '',
    tags: [],
  };
}

// 編集時の初期値。年は formatYear の表示形（前100等）にする → parseYearInput で往復できる
export function personToFormValues(person: Person): PersonFormValues {
  return {
    name: person.name,
    birthYear: formatYear(person.birth.year),
    birthMonth: person.birth.month === undefined ? '' : String(person.birth.month),
    birthDay: person.birth.day === undefined ? '' : String(person.birth.day),
    deathYear: person.death === undefined ? '' : formatYear(person.death.year),
    deathMonth: person.death?.month === undefined ? '' : String(person.death.month),
    deathDay: person.death?.day === undefined ? '' : String(person.death.day),
    tags: [...person.tags],
  };
}

// blur・送信時の検証（ui-forms-dialogs.md 1章のエラーIDカタログ）。
// すべてのエラーを同時に返す（フィールドごとのインライン表示のため）。
// UI側は日selectを月未選択時に非活性化するが、E-DAY-WITHOUT-MONTH はここでも検証する
// （schema.ts の同規則と対になる防御。検証は境界とロジックの両方に置く）
export function validatePersonForm(values: PersonFormValues): PersonFormValidation {
  const errors: PersonFormErrors = {};

  const name = values.name.trim();
  if (name === '') {
    errors.name = 'E-P-NAME-EMPTY';
  }

  // 生年は必須。空欄も E-YEAR-FORMAT（parseYearInput が '' を形式エラーと判定する）
  const birthParsed = parseYearInput(values.birthYear);
  if (!birthParsed.ok) {
    errors.birthYear = birthParsed.code;
  }
  if (values.birthDay !== '' && values.birthMonth === '') {
    errors.birthDay = 'E-DAY-WITHOUT-MONTH';
  }

  // 没年は任意（空欄 = 存命）。ただし没月・没日だけ指定して没年が空欄の場合は、
  // 黙って月日を捨てず年の入力を要求する（E-YEAR-FORMAT を没年欄に表示）
  let deathYear: StoredYear | null = null;
  if (values.deathYear.trim() !== '') {
    const deathParsed = parseYearInput(values.deathYear);
    if (deathParsed.ok) {
      deathYear = deathParsed.year;
    } else {
      errors.deathYear = deathParsed.code;
    }
  } else if (values.deathMonth !== '' || values.deathDay !== '') {
    errors.deathYear = 'E-YEAR-FORMAT';
  }
  if (values.deathDay !== '' && values.deathMonth === '') {
    errors.deathDay = 'E-DAY-WITHOUT-MONTH';
  }

  // 没年 >= 生年（同年没 = 0歳は許可。紀元前も compareStoredYears の astro 比較で正しく判定）
  if (
    birthParsed.ok &&
    deathYear !== null &&
    errors.deathYear === undefined &&
    compareStoredYears(deathYear, birthParsed.year) < 0
  ) {
    errors.deathYear = 'E-P-DEATH-BEFORE-BIRTH';
  }

  if (Object.keys(errors).length > 0 || !birthParsed.ok) {
    return { ok: false, errors };
  }

  // month/day は未指定ならキー自体を持たせない（strictObject の optional と揃える）
  const birth: PersonInput['birth'] = { year: birthParsed.year };
  if (values.birthMonth !== '') {
    birth.month = Number(values.birthMonth);
  }
  if (values.birthDay !== '') {
    birth.day = Number(values.birthDay);
  }
  const person: PersonInput = { name, birth, tags: normalizeTags(values.tags) };
  if (deathYear !== null) {
    const death: NonNullable<PersonInput['death']> = { year: deathYear };
    if (values.deathMonth !== '') {
      death.month = Number(values.deathMonth);
    }
    if (values.deathDay !== '') {
      death.day = Number(values.deathDay);
    }
    person.death = death;
  }
  return { ok: true, person };
}

// 削除フローの分岐材料（US-001）: 紐付く個人イベント。
// あり → 3択（イベントも削除 / 紐付け解除 / キャンセル）、なし → 2択（削除 / キャンセル）
export function personalEventsOf(timeline: Timeline, personId: string): TimelineEvent[] {
  return timeline.events.filter((event) => event.personId === personId);
}
