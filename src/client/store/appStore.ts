// クライアントの状態管理（Zustand）。データ変更は本ファイルのミューテーション
// （data-model.md 4章の12操作）経由のみで行い、コンポーネントから直接 state を
// 書き換えない（stack-conventions）。ミューテーション後のストアは常に storeSchema の
// 参照整合性（data-model.md 2章の5規則）を満たすことをコードで保証する
// （Zod による検証は境界 = 保存・取り込みで行う設計のため。同 2章補足）。
// 自動保存（500msデバウンス PUT・rev 管理）の本体は store/autosave.ts。ユーザー操作による
// 変更はすべて mutate()（と replaceStore）を通り、そこから notifyMutation() で自動保存に乗る。
import { create } from 'zustand';

import { sortedPersonIds } from '../../domain/query';
import type { Person, Store, Timeline, TimelineEvent } from '../../domain/schema';
import type { StoredYear } from '../../domain/year';
import { notifyMutation } from './autosave';

// 入力はフォーム層（TASK-105/106）で検証済みの値を受け取る前提（data-model.md 4章）。
// id はストア側で採番するため入力に含めない
export type PersonInput = Omit<Person, 'id'>;
export type TimelineEventInput = Omit<TimelineEvent, 'id'>;

// deletePerson の個人イベントの扱い（US-001）:
// deleteEvents = 紐付く個人イベントも削除 / unlink = personId を外して全体イベントとして残す
export type DeletePersonEventPolicy = 'deleteEvents' | 'unlink';

interface AppState {
  // null = 初期ロード（GET /api/store）前。ロード完了時に initializeStore で注入される
  store: Store | null;

  // 初期ロードの注入。ユーザー操作による変更ではないため自動保存の対象にしない
  // （インポート「すべて置き換え」は replaceStore を使う。両者の違いはそこだけ）
  initializeStore: (store: Store) => void;

  // --- data-model.md 4章のミューテーション12操作（対象は表示中の年表） ---
  addPerson: (input: PersonInput) => string;
  updatePerson: (id: string, input: PersonInput) => void;
  deletePerson: (id: string, eventPolicy: DeletePersonEventPolicy) => void;
  addEvent: (input: TimelineEventInput) => string;
  updateEvent: (id: string, input: TimelineEventInput) => void;
  deleteEvent: (id: string) => void;
  reorderPerson: (id: string, toIndex: number) => void;
  setSortMode: (mode: Timeline['sortMode']) => void;
  addTimeline: (name: string) => string;
  renameTimeline: (id: string, name: string) => void;
  deleteTimeline: (id: string) => void;
  switchTimeline: (id: string) => void;
  setViewRange: (startYear: StoredYear | null, endYear: StoredYear | null) => void;
  setZoom: (zoom: Timeline['view']['zoom']) => void;
  replaceStore: (store: Store) => void;
  appendTimelines: (timelines: Timeline[]) => void;
}

function newId(prefix: 'p' | 'e' | 'tl'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// 初期データ・最後の年表削除時の自動作成で使う空年表（data-model.md 3章と同じ形）
function createEmptyTimeline(name: string): Timeline {
  return {
    id: newId('tl'),
    name,
    persons: [],
    events: [],
    sortMode: 'birthAsc',
    personOrder: [],
    view: { startYear: null, endYear: null, zoom: 'year' },
  };
}

// 表示中の年表だけを更新する。activeTimelineId の不整合は境界検証済みのため通常起きない。
// 起きたら黙って何もしないのではなく明示的に失敗させる（ルートエラー境界が受ける）
function withActiveTimeline(store: Store, update: (timeline: Timeline) => Timeline): Store {
  if (!store.timelines.some((t) => t.id === store.activeTimelineId)) {
    throw new Error('E-STORE-ACTIVE-MISSING: activeTimelineId が timelines に存在しません');
  }
  return {
    ...store,
    timelines: store.timelines.map((t) => (t.id === store.activeTimelineId ? update(t) : t)),
  };
}

function requireTimeline(store: Store, id: string): Timeline {
  const timeline = store.timelines.find((t) => t.id === id);
  if (timeline === undefined) {
    throw new Error(`年表が存在しません (id=${id})`);
  }
  return timeline;
}

// event.personId が表示中の年表の人物を指すことの保証（E-STORE-EVENT-ORPHAN を作らない）。
// フォームは登録済み人物からしか選べないため、ここに来たら呼び出し側のバグ = 明示的に失敗
function assertPersonRefExists(timeline: Timeline, personId: string | undefined): void {
  if (personId !== undefined && !timeline.persons.some((p) => p.id === personId)) {
    throw new Error(`E-STORE-EVENT-ORPHAN: 紐付け先の人物が存在しません (personId=${personId})`);
  }
}

// 手動並び順の実体化（sortMode を 'manual' にする直前に呼ぶ）。
// - 初回（personOrder が空）: 現在の生年順の表示をそのまま初期の手動順にする
//   （切り替えた瞬間に行が入れ替わらない = 表示の連続性）
// - 保持されていた手動順がある: それを優先し、生年順の間に追加された人物は末尾に置く
//   （US-008「手動並び替え後に追加された人物は末尾」。合成規則は表示側
//   sortedPersonIds の manual 分岐と同一なので、検証と表示が食い違わない）
function materializeManualOrder(timeline: Timeline): string[] {
  return timeline.personOrder.length === 0
    ? sortedPersonIds({ ...timeline, sortMode: 'birthAsc' })
    : sortedPersonIds({ ...timeline, sortMode: 'manual' });
}

// インポート「年表として追加」（US-011）: timeline/person/event の id をすべて新規採番して
// 既存データとの衝突（E-STORE-DUP-TIMELINE / E-STORE-DUP-ID）を避け、event.personId と
// personOrder は旧id→新id の対応表で再マップする（E-STORE-EVENT-ORPHAN /
// E-STORE-ORDER-MISMATCH を作らない。data-model.md 4章）
function renumberTimeline(source: Timeline): Timeline {
  const personIdMap = new Map<string, string>();
  const persons = source.persons.map((person) => {
    const id = newId('p');
    personIdMap.set(person.id, id);
    return { ...person, id };
  });
  const events = source.events.map((event) => {
    const id = newId('e');
    if (event.personId === undefined) {
      return { ...event, id };
    }
    const mappedPersonId = personIdMap.get(event.personId);
    if (mappedPersonId === undefined) {
      // 取り込みファイルは境界（インポート検証）で参照整合性を確認済みのため通常起きない
      throw new Error(
        `E-STORE-EVENT-ORPHAN: 追加する年表のイベントが存在しない人物を参照しています (personId=${event.personId})`,
      );
    }
    return { ...event, id, personId: mappedPersonId };
  });
  // birthAsc の年表では personOrder に古い（削除済み等の）id が残っていてもスキーマ上
  // 有効なため、再マップできない項目は捨てる（manual の年表は過不足なしが検証済み = 全件残る）
  const personOrder = source.personOrder.flatMap((oldId) => {
    const mapped = personIdMap.get(oldId);
    return mapped === undefined ? [] : [mapped];
  });
  return { ...source, id: newId('tl'), persons, events, personOrder };
}

export const useAppStore = create<AppState>()((set, get) => {
  // 全ミューテーション共通の適用口。recipe が例外を投げたら state は一切変わらない。
  const mutate = (recipe: (store: Store) => Store): void => {
    const current = get().store;
    if (current === null) {
      throw new Error('ストアが未初期化です（initializeStore の前にミューテーションが呼ばれました）');
    }
    set({ store: recipe(current) });
    // ユーザー操作による変更は必ず自動保存に乗せる（500msデバウンスPUT。server-api.md 5章）
    notifyMutation();
  };

  return {
    store: null,

    initializeStore: (store) => {
      set({ store });
    },

    addPerson: (input) => {
      const id = newId('p');
      mutate((store) =>
        withActiveTimeline(store, (t) => ({
          ...t,
          persons: [...t.persons, { ...input, id }],
          // manual 並びのときの新規追加は personOrder 末尾（US-008）。birthAsc のときは
          // 触らない（保持中の手動順への合流は setSortMode('manual') 時に行う）
          personOrder: t.sortMode === 'manual' ? [...t.personOrder, id] : t.personOrder,
        })),
      );
      return id;
    },

    updatePerson: (id, input) => {
      mutate((store) =>
        withActiveTimeline(store, (t) => {
          if (!t.persons.some((p) => p.id === id)) {
            throw new Error(`人物が存在しません (id=${id})`);
          }
          return {
            ...t,
            persons: t.persons.map((p) => (p.id === id ? { ...input, id } : p)),
          };
        }),
      );
    },

    deletePerson: (id, eventPolicy) => {
      mutate((store) =>
        withActiveTimeline(store, (t) => {
          if (!t.persons.some((p) => p.id === id)) {
            throw new Error(`人物が存在しません (id=${id})`);
          }
          const events =
            eventPolicy === 'deleteEvents'
              ? t.events.filter((e) => e.personId !== id)
              : t.events.map((e) => {
                  if (e.personId !== id) {
                    return e;
                  }
                  // unlink: personId キーごと外して全体イベントとして残す（US-001）
                  const { personId: _unlinked, ...rest } = e;
                  return rest;
                });
          return {
            ...t,
            persons: t.persons.filter((p) => p.id !== id),
            events,
            // 保持中の手動順（birthAsc 中）からも除去する（US-001）
            personOrder: t.personOrder.filter((pid) => pid !== id),
          };
        }),
      );
    },

    addEvent: (input) => {
      const id = newId('e');
      mutate((store) =>
        withActiveTimeline(store, (t) => {
          assertPersonRefExists(t, input.personId);
          return { ...t, events: [...t.events, { ...input, id }] };
        }),
      );
      return id;
    },

    updateEvent: (id, input) => {
      mutate((store) =>
        withActiveTimeline(store, (t) => {
          if (!t.events.some((e) => e.id === id)) {
            throw new Error(`イベントが存在しません (id=${id})`);
          }
          assertPersonRefExists(t, input.personId);
          return {
            ...t,
            events: t.events.map((e) => (e.id === id ? { ...input, id } : e)),
          };
        }),
      );
    },

    deleteEvent: (id) => {
      mutate((store) =>
        withActiveTimeline(store, (t) => {
          if (!t.events.some((e) => e.id === id)) {
            throw new Error(`イベントが存在しません (id=${id})`);
          }
          return { ...t, events: t.events.filter((e) => e.id !== id) };
        }),
      );
    },

    reorderPerson: (id, toIndex) => {
      mutate((store) =>
        withActiveTimeline(store, (t) => {
          if (!t.persons.some((p) => p.id === id)) {
            throw new Error(`人物が存在しません (id=${id})`);
          }
          const rest = materializeManualOrder(t).filter((pid) => pid !== id);
          // ドロップ位置はオフセット/行高から計算されるため端では範囲外になりうる → クランプ
          const insertAt = Math.max(0, Math.min(Math.trunc(toIndex), rest.length));
          return {
            ...t,
            sortMode: 'manual',
            personOrder: [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)],
          };
        }),
      );
    },

    setSortMode: (mode) => {
      mutate((store) =>
        withActiveTimeline(store, (t) =>
          mode === 'manual'
            ? { ...t, sortMode: 'manual', personOrder: materializeManualOrder(t) }
            : // 'birthAsc' に戻しても personOrder は保持する（再度 manual で復帰。data-model.md 4章）
              { ...t, sortMode: 'birthAsc' },
        ),
      );
    },

    addTimeline: (name) => {
      const timeline = createEmptyTimeline(name);
      // 空の年表を作成し切替（ui-forms-dialogs.md 3章）
      mutate((store) => ({
        ...store,
        activeTimelineId: timeline.id,
        timelines: [...store.timelines, timeline],
      }));
      return timeline.id;
    },

    renameTimeline: (id, name) => {
      mutate((store) => {
        requireTimeline(store, id);
        return {
          ...store,
          timelines: store.timelines.map((t) => (t.id === id ? { ...t, name } : t)),
        };
      });
    },

    deleteTimeline: (id) => {
      mutate((store) => {
        const index = store.timelines.findIndex((t) => t.id === id);
        if (index === -1) {
          throw new Error(`年表が存在しません (id=${id})`);
        }
        const remaining = store.timelines.filter((t) => t.id !== id);
        if (remaining.length === 0) {
          // 最後の1つを削除したら空の「年表1」を自動作成して active にする
          // （年表0個の状態を作らない。data-model.md 3章）
          const fresh = createEmptyTimeline('年表1');
          return { ...store, activeTimelineId: fresh.id, timelines: [fresh] };
        }
        if (store.activeTimelineId !== id) {
          return { ...store, timelines: remaining };
        }
        // 表示中の年表を削除したときは同じ位置（= 次の年表）、末尾なら1つ前へ切り替える
        const next = remaining[Math.min(index, remaining.length - 1)];
        if (next === undefined) {
          throw new Error('E-STORE-ACTIVE-MISSING: 切替先の年表を特定できません'); // 到達不能（remaining は非空）
        }
        return { ...store, activeTimelineId: next.id, timelines: remaining };
      });
    },

    switchTimeline: (id) => {
      mutate((store) => {
        requireTimeline(store, id);
        return { ...store, activeTimelineId: id };
      });
    },

    setViewRange: (startYear, endYear) => {
      mutate((store) =>
        withActiveTimeline(store, (t) => ({
          ...t,
          view: { ...t.view, startYear, endYear }, // null = 自動（US-006）
        })),
      );
    },

    setZoom: (zoom) => {
      mutate((store) =>
        withActiveTimeline(store, (t) => ({ ...t, view: { ...t.view, zoom } })),
      );
    },

    replaceStore: (store) => {
      // インポート「すべて置き換え」・リカバリ用（US-011）。リカバリ画面（初期ロード失敗 =
      // store が null）からも使うため mutate（未初期化チェック）を通さない。
      // これもユーザー操作による変更なので自動保存の対象にする（初期ロードの
      // initializeStore・競合読み直しの注入との違いはこの1点）
      set({ store });
      notifyMutation();
    },

    appendTimelines: (timelines) => {
      mutate((store) => ({
        ...store,
        // 追加のみ。表示中の年表は切り替えない
        timelines: [...store.timelines, ...timelines.map(renumberTimeline)],
      }));
    },
  };
});
