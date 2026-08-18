// 年表管理の表示用導出・名前検証（TASK-113 / ui-forms-dialogs.md 3章 / US-009）。
// コンポーネント（React・DOM）から分離して単体テスト可能にする（personFormModel と同じ流儀）。
// 実際の変更（追加・名前変更・削除・切替）は appStore のミューテーションが正で、
// ここは「一覧に何を表示するか」と「名前入力を受理できるか」だけを純粋に扱う。
import type { Store, Timeline } from '../../domain/schema';

// ツールバーの年表切替 select で「年表の管理...」を表す特殊値。
// 年表 id は "tl_<uuid>" 形式（appStore の採番）のため実データと衝突しない
export const MANAGE_TIMELINES_VALUE = '__manage-timelines__';

// 管理ダイアログの一覧1行分（名前・人物数・イベント数・表示中か。screen-03 .tl-row）
export interface TimelineListItem {
  id: string;
  name: string;
  personCount: number;
  eventCount: number;
  isActive: boolean;
}

// 一覧は timelines の保存順のまま出す（並び替え機能は要件にない。YAGNI）
export function timelineListItems(store: Store): TimelineListItem[] {
  return store.timelines.map((timeline) => ({
    id: timeline.id,
    name: timeline.name,
    personCount: timeline.persons.length,
    eventCount: timeline.events.length,
    isActive: timeline.id === store.activeTimelineId,
  }));
}

export type TimelineNameErrorCode = 'E-T-NAME-EMPTY';

// エラーID → メッセージ（文言の正は ui-forms-dialogs.md 3章のカタログ）
export const TIMELINE_NAME_MESSAGES: Record<TimelineNameErrorCode, string> = {
  'E-T-NAME-EMPTY': '年表名は必須です',
};

export type TimelineNameValidation =
  | { ok: true; name: string }
  | { ok: false; code: TimelineNameErrorCode };

// 新規作成・名前変更の共通検証。trim 後に空なら拒否（schema.ts の
// timelineSchema.name（trim().min(1)）と対になる検証。上限50字は入力側の maxLength で防ぐ）
export function validateTimelineName(raw: string): TimelineNameValidation {
  const name = raw.trim();
  if (name === '') {
    return { ok: false, code: 'E-T-NAME-EMPTY' };
  }
  return { ok: true, name };
}

// 削除確認の「人物n人・イベントm件も削除される」文言の材料（US-009 受け入れ条件）
export function deleteImpact(timeline: Timeline): { personCount: number; eventCount: number } {
  return { personCount: timeline.persons.length, eventCount: timeline.events.length };
}
