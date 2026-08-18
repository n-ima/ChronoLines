// 人物フォーム（US-001 / ui-forms-dialogs.md 1章 / screen-03 dlg-person / TASK-105）。
// 検証は blur と送信時（touched + submitted の交差で表示を制御）。検証ロジック本体は
// personFormModel.ts（純粋関数 = 単体テスト対象）。保存はミューテーション
// （addPerson/updatePerson）へ委譲し、このコンポーネントは入力状態だけを持つ。
import { useId, useState, type FormEvent } from 'react';

import type { Person } from '../../domain/schema';
import type { PersonInput } from '../store/appStore';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import styles from './dialog.module.css';
import {
  emptyPersonFormValues,
  PERSON_FORM_MESSAGES,
  personToFormValues,
  validatePersonForm,
  type PersonFormErrorCode,
  type PersonFormErrorField,
  type PersonFormErrors,
  type PersonFormValues,
} from './personFormModel';
import { TagPicker } from './TagPicker';

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => String(i + 1));

// インラインエラー（フィールド直下。data-error-code は機械確認・E2E 用のフック）
function FieldError({ code }: { code: PersonFormErrorCode | undefined }) {
  if (code === undefined) {
    return null;
  }
  return (
    <div className={styles.err} role="alert" data-error-code={code}>
      {PERSON_FORM_MESSAGES[code]}
    </div>
  );
}

export function PersonFormDialog({
  person,
  registeredTags,
  onSave,
  onRequestDelete,
  onClose,
}: {
  // null = 新規追加（〔＋人物〕）。非 null = 編集（行メニュー〔編集〕）
  person: Person | null;
  registeredTags: string[];
  onSave: (input: PersonInput) => void;
  // 編集時のみ（フォーム内〔削除...〕→ 削除確認ダイアログ。screen-03 dlg-foot .left）
  onRequestDelete: (() => void) | null;
  onClose: () => void;
}) {
  const formId = useId();
  const [initial] = useState<PersonFormValues>(() =>
    person === null ? emptyPersonFormValues() : personToFormValues(person),
  );
  const [values, setValues] = useState<PersonFormValues>(initial);
  const [touched, setTouched] = useState<ReadonlySet<PersonFormErrorField>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const validation = validatePersonForm(values);
  const errors: PersonFormErrors = validation.ok ? {} : validation.errors;
  // blur 済み（touched）または送信済みのフィールドだけエラーを表示する（blur+送信時検証）
  const errorOf = (field: PersonFormErrorField): PersonFormErrorCode | undefined =>
    submitted || touched.has(field) ? errors[field] : undefined;

  const setValue = (patch: Partial<PersonFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
  };
  const touch = (field: PersonFormErrorField) => {
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (validation.ok) {
      onSave(validation.person);
    }
  };

  const inputClass = (field: PersonFormErrorField) =>
    errorOf(field) === undefined ? styles.input : styles.inputError;

  return (
    <Dialog
      title={person === null ? '人物の追加' : '人物の編集'}
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
            名前 <span className={styles.req}>*</span>
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
          <label className={styles.label} htmlFor={`${formId}-birth-year`}>
            生年 <span className={styles.req}>*</span>
          </label>
          <input
            id={`${formId}-birth-year`}
            type="text"
            className={inputClass('birthYear')}
            placeholder="例: 1543、前100、-100"
            value={values.birthYear}
            onChange={(e) => setValue({ birthYear: e.target.value })}
            onBlur={() => touch('birthYear')}
          />
          <div className={styles.sub}>年のみでも登録できます（月日は参考情報）</div>
          <FieldError code={errorOf('birthYear')} />
        </div>
        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-birth-month`}>
              生月
            </label>
            <select
              id={`${formId}-birth-month`}
              className={styles.input}
              value={values.birthMonth}
              onChange={(e) =>
                // 月を未指定に戻したら日も未指定へ（日は月選択時のみ活性のため残すと直せない）
                setValue(
                  e.target.value === ''
                    ? { birthMonth: '', birthDay: '' }
                    : { birthMonth: e.target.value },
                )
              }
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
            <label className={styles.label} htmlFor={`${formId}-birth-day`}>
              生日
            </label>
            <select
              id={`${formId}-birth-day`}
              className={styles.input}
              value={values.birthDay}
              disabled={values.birthMonth === ''}
              onChange={(e) => setValue({ birthDay: e.target.value })}
              onBlur={() => touch('birthDay')}
            >
              <option value="">—</option>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {values.birthMonth === '' && <div className={styles.sub}>月を選ぶと指定できます</div>}
            <FieldError code={errorOf('birthDay')} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${formId}-death-year`}>
            没年
          </label>
          <input
            id={`${formId}-death-year`}
            type="text"
            className={inputClass('deathYear')}
            placeholder="空欄 = 存命"
            value={values.deathYear}
            onChange={(e) => setValue({ deathYear: e.target.value })}
            onBlur={() => touch('deathYear')}
          />
          <FieldError code={errorOf('deathYear')} />
        </div>
        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-death-month`}>
              没月
            </label>
            <select
              id={`${formId}-death-month`}
              className={styles.input}
              value={values.deathMonth}
              onChange={(e) =>
                setValue(
                  e.target.value === ''
                    ? { deathMonth: '', deathDay: '' }
                    : { deathMonth: e.target.value },
                )
              }
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
            <label className={styles.label} htmlFor={`${formId}-death-day`}>
              没日
            </label>
            <select
              id={`${formId}-death-day`}
              className={styles.input}
              value={values.deathDay}
              disabled={values.deathMonth === ''}
              onChange={(e) => setValue({ deathDay: e.target.value })}
              onBlur={() => touch('deathDay')}
            >
              <option value="">—</option>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {values.deathMonth === '' && <div className={styles.sub}>月を選ぶと指定できます</div>}
            <FieldError code={errorOf('deathDay')} />
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
