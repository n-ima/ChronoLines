// イベントフォーム（US-003 / ui-forms-dialogs.md 2章 / screen-03 dlg-event / TASK-106）。
// 起動経路（〔＋イベント〕/ 年ヘッダー右クリック / サイドパネル〔編集〕= TASK-107）に
// 依存しない本体: 新規は event=null（initialYear で年の初期値を指定可）、編集は event を渡す。
// 検証は blur と送信時（touched + submitted の交差で表示を制御）。検証ロジック本体は
// eventFormModel.ts（純粋関数 = 単体テスト対象）。保存はミューテーション
// （addEvent/updateEvent）へ委譲し、このコンポーネントは入力状態だけを持つ。
import { useId, useState, type FormEvent } from 'react';

import type { Person, TimelineEvent } from '../../domain/schema';
import type { StoredYear } from '../../domain/year';
import type { TimelineEventInput } from '../store/appStore';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import styles from './dialog.module.css';
import {
  emptyEventFormValues,
  EVENT_FORM_MESSAGES,
  eventToFormValues,
  validateEventForm,
  type EventFormErrorCode,
  type EventFormErrorField,
  type EventFormErrors,
  type EventFormValues,
} from './eventFormModel';
import { TagPicker } from './TagPicker';

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => String(i + 1));

// メモの上限（設計「textarea 2000字」= schema の note max と同値。超過入力を入口で止める）
const NOTE_MAX_LENGTH = 2000;

// インラインエラー（フィールド直下。data-error-code は機械確認・E2E 用のフック）
function FieldError({ code }: { code: EventFormErrorCode | undefined }) {
  if (code === undefined) {
    return null;
  }
  return (
    <div className={styles.err} role="alert" data-error-code={code}>
      {EVENT_FORM_MESSAGES[code]}
    </div>
  );
}

export function EventFormDialog({
  event,
  initialYear,
  persons,
  registeredTags,
  onSave,
  onRequestDelete,
  onClose,
}: {
  // null = 新規追加（〔＋イベント〕/ 年ヘッダー右クリック）。非 null = 編集
  event: TimelineEvent | null;
  // 新規追加時の年の初期値（年ヘッダー右クリック〔この年にイベント追加〕）。null = 空欄
  initialYear: StoredYear | null;
  // 人物への紐付けの選択肢（グリッドの行順で渡す）
  persons: Person[];
  registeredTags: string[];
  onSave: (input: TimelineEventInput) => void;
  // 編集時のみ（フォーム内〔削除...〕→ 削除確認ダイアログ。ui-forms-dialogs.md 2章）
  onRequestDelete: (() => void) | null;
  onClose: () => void;
}) {
  const formId = useId();
  const [initial] = useState<EventFormValues>(() =>
    event === null ? emptyEventFormValues(initialYear ?? undefined) : eventToFormValues(event),
  );
  const [values, setValues] = useState<EventFormValues>(initial);
  const [touched, setTouched] = useState<ReadonlySet<EventFormErrorField>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const validation = validateEventForm(values);
  const errors: EventFormErrors = validation.ok ? {} : validation.errors;
  // blur 済み（touched）または送信済みのフィールドだけエラーを表示する（blur+送信時検証）
  const errorOf = (field: EventFormErrorField): EventFormErrorCode | undefined =>
    submitted || touched.has(field) ? errors[field] : undefined;

  const setValue = (patch: Partial<EventFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
  };
  const touch = (field: EventFormErrorField) => {
    setTouched((t) => {
      if (t.has(field)) {
        return t;
      }
      const next = new Set(t);
      next.add(field);
      return next;
    });
  };

  // 編集中に閉じる場合は破棄確認（ui-forms-dialogs.md 共通仕様）。Esc/✕/オーバーレイ/
  // キャンセルのすべての閉じ経路で共通に適用する
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const requestClose = () => {
    if (!dirty || window.confirm('編集中の内容を破棄して閉じますか？')) {
      onClose();
    }
  };

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setSubmitted(true);
    if (validation.ok) {
      onSave(validation.event);
    }
  };

  const inputClass = (field: EventFormErrorField) =>
    errorOf(field) === undefined ? styles.input : styles.inputError;

  return (
    <Dialog
      title={event === null ? 'イベントの追加' : 'イベントの編集'}
      onClose={requestClose}
      footer={
        <>
          {onRequestDelete !== null && (
            <button
              type="button"
              className={`${controls.btnDanger} ${styles.footLeft}`}
              onClick={onRequestDelete}
            >
              削除...
            </button>
          )}
          <button type="button" className={controls.btn} onClick={requestClose}>
            キャンセル
          </button>
          <button type="submit" form={formId} className={controls.btnPrimary}>
            保存
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${formId}-name`}>
            イベント名 <span className={styles.req}>*</span>
          </label>
          <input
            id={`${formId}-name`}
            type="text"
            className={inputClass('name')}
            value={values.name}
            onChange={(e) => setValue({ name: e.target.value })}
            onBlur={() => touch('name')}
          />
          <FieldError code={errorOf('name')} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${formId}-year`}>
            年 <span className={styles.req}>*</span>
          </label>
          <input
            id={`${formId}-year`}
            type="text"
            className={inputClass('year')}
            placeholder="例: 1600、前100、-100"
            value={values.year}
            onChange={(e) => setValue({ year: e.target.value })}
            onBlur={() => touch('year')}
          />
          <FieldError code={errorOf('year')} />
        </div>
        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-month`}>
              月
            </label>
            <select
              id={`${formId}-month`}
              className={styles.input}
              value={values.month}
              onChange={(e) => setValue({ month: e.target.value })}
            >
              <option value="">—</option>
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            {/* 日は常時活性（screen-03 dlg-event。人物フォームと異なり月未選択でも選べるため、
                E-DAY-WITHOUT-MONTH のインライン検証が働く） */}
            <label className={styles.label} htmlFor={`${formId}-day`}>
              日
            </label>
            <select
              id={`${formId}-day`}
              className={styles.input}
              value={values.day}
              onChange={(e) => setValue({ day: e.target.value })}
              onBlur={() => touch('day')}
            >
              <option value="">—</option>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <FieldError code={errorOf('day')} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${formId}-note`}>
            メモ
          </label>
          <textarea
            id={`${formId}-note`}
            className={styles.input}
            rows={3}
            maxLength={NOTE_MAX_LENGTH}
            value={values.note}
            onChange={(e) => setValue({ note: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${formId}-person`}>
            人物への紐付け（任意）
          </label>
          <select
            id={`${formId}-person`}
            className={styles.input}
            value={values.personId}
            onChange={(e) => setValue({ personId: e.target.value })}
          >
            <option value="">なし（世の中の出来事）</option>
            {persons.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <div className={styles.sub}>
            紐付けると「個人イベント」として人物名バッジ付きで表示されます
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>タグ（複数可）</span>
          <TagPicker
            assigned={values.tags}
            registered={registeredTags}
            onChange={(tags) => setValue({ tags })}
          />
        </div>
      </form>
    </Dialog>
  );
}
