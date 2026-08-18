// イベントフォームの検証・変換ロジック（ui-forms-dialogs.md 2章 / TASK-106）。
// personFormModel と同じ流儀でコンポーネント（React・DOM）から分離して単体テスト可能にする。
// 年の解釈は parseYearInput（domain/year.ts）が正 = 設計「同じ関数を使う」の具体化。
import type { TimelineEvent } from '../../domain/schema';
import { formatYear, parseYearInput, type StoredYear } from '../../domain/year';
import type { TimelineEventInput } from '../store/appStore';
import { normalizeTags } from './tagPickerModel';

// フォームの入力状態。select（月・日）は '' = 未指定、'1'〜'12' / '1'〜'31'。
// 年はテキスト（「1600」「前100」「-100」を受理）。personId の '' = 「なし（世の中の出来事）」
export interface EventFormValues {
  name: string;
  year: string;
  month: string;
  day: string;
  note: string;
  personId: string;
  tags: string[];
}

export type EventFormErrorCode =
  | 'E-E-NAME-EMPTY'
  | 'E-YEAR-FORMAT'
  | 'E-YEAR-ZERO'
  | 'E-DAY-WITHOUT-MONTH';

// エラーID → メッセージ（文言の正は ui-forms-dialogs.md 1〜2章のカタログ）
export const EVENT_FORM_MESSAGES: Record<EventFormErrorCode, string> = {
  'E-E-NAME-EMPTY': 'イベント名は必須です',
  'E-YEAR-FORMAT': '年の形式が正しくありません（例: 1600、前100、-100）',
  'E-YEAR-ZERO': '0年は存在しません（前1年の翌年は西暦1年です）',
  'E-DAY-WITHOUT-MONTH': '日を指定する場合は月も指定してください',
};

// エラーを表示するフィールド（インライン表示位置。screen-03 dlg-event のとおり年欄の直下）
export type EventFormErrorField = 'name' | 'year' | 'day';

export type EventFormErrors = Partial<Record<EventFormErrorField, EventFormErrorCode>>;

export type EventFormValidation =
  | { ok: true; event: TimelineEventInput }
  | { ok: false; errors: EventFormErrors };

// 新規追加の初期値。年ヘッダー右クリック〔この年にイベント追加〕は initialYear で
// 年を初期値に入れる（formatYear の表示形 = parseYearInput で往復できる）
export function emptyEventFormValues(initialYear?: StoredYear): EventFormValues {
  return {
    name: '',
    year: initialYear === undefined ? '' : formatYear(initialYear),
    month: '',
    day: '',
    note: '',
    personId: '',
    tags: [],
  };
}

// 編集時の初期値（サイドパネル〔編集〕= TASK-107 とフォーム内〔削除〕経路で使う）
export function eventToFormValues(event: TimelineEvent): EventFormValues {
  return {
    name: event.name,
    year: formatYear(event.year),
    month: event.month === undefined ? '' : String(event.month),
    day: event.day === undefined ? '' : String(event.day),
    note: event.note ?? '',
    personId: event.personId ?? '',
    tags: [...event.tags],
  };
}

// blur・送信時の検証（ui-forms-dialogs.md 2章）。年空欄も E-YEAR-FORMAT
// （parseYearInput が '' を形式エラーと判定する = 受け入れ条件「年空欄で登録 → エラー」）。
// すべてのエラーを同時に返す（フィールドごとのインライン表示のため）。
// イベントフォームの日 select は常時活性（screen-03 dlg-event）なので
// E-DAY-WITHOUT-MONTH は UI 上も到達しうる実検証
export function validateEventForm(values: EventFormValues): EventFormValidation {
  const errors: EventFormErrors = {};

  const name = values.name.trim();
  if (name === '') {
    errors.name = 'E-E-NAME-EMPTY';
  }

  const yearParsed = parseYearInput(values.year);
  if (!yearParsed.ok) {
    errors.year = yearParsed.code;
  }

  if (values.day !== '' && values.month === '') {
    errors.day = 'E-DAY-WITHOUT-MONTH';
  }

  if (Object.keys(errors).length > 0 || !yearParsed.ok) {
    return { ok: false, errors };
  }

  // month/day/note/personId は未指定ならキー自体を持たせない（strictObject の optional と揃える）
  const event: TimelineEventInput = {
    name,
    year: yearParsed.year,
    tags: normalizeTags(values.tags),
  };
  if (values.month !== '') {
    event.month = Number(values.month);
  }
  if (values.day !== '') {
    event.day = Number(values.day);
  }
  if (values.note.trim() !== '') {
    event.note = values.note;
  }
  if (values.personId !== '') {
    event.personId = values.personId;
  }
  return { ok: true, event };
}
