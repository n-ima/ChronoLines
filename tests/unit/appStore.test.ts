import { beforeEach, describe, expect, it } from 'vitest';

import {
  useAppStore,
  type PersonInput,
  type TimelineEventInput,
} from '../../src/client/store/appStore';
import { storeSchema, type Store, type Timeline } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';

// Zustand ストアとミューテーション12操作（data-model.md 3章・4章）のテスト（TASK-102）。
// 各ミューテーション後のストアが storeSchema の参照整合性（2章の5規則）を満たすことを
// parse で確認する（ミューテーションは検証を通さずコードで整合性を保証する設計のため、
// ここで機械的に検証するのが唯一の網）。

// テストデータの年をブランド型へ持ち上げるヘルパー（テスト内のみ。値は変えない）
const sy = (n: number) => n as StoredYear;

// 生年昇順: 信長(1534) → 秀吉(1537) → 家康(1543)
function fixtureStore(): Store {
  return storeSchema.parse({
    schemaVersion: 1,
    activeTimelineId: 'tl_sengoku',
    timelines: [
      {
        id: 'tl_sengoku',
        name: '戦国',
        persons: [
          { id: 'p_ieyasu', name: '徳川家康', birth: { year: 1543 }, death: { year: 1616 }, tags: ['戦国'] },
          { id: 'p_nobunaga', name: '織田信長', birth: { year: 1534 }, death: { year: 1582 }, tags: [] },
          { id: 'p_hideyoshi', name: '豊臣秀吉', birth: { year: 1537 }, death: { year: 1598 }, tags: [] },
        ],
        events: [
          { id: 'e_sekigahara', name: '関ヶ原の戦い', year: 1600, personId: 'p_ieyasu', tags: [] },
          { id: 'e_taiju', name: '征夷大将軍就任', year: 1603, personId: 'p_ieyasu', tags: [] },
          { id: 'e_honnoji', name: '本能寺の変', year: 1582, personId: 'p_nobunaga', tags: [] },
          { id: 'e_keicho', name: '慶長の大地震', year: 1605, tags: [] }, // 全体イベント
        ],
        sortMode: 'birthAsc',
        personOrder: [],
        view: { startYear: null, endYear: null, zoom: 'year' },
      },
      {
        id: 'tl_bakumatsu',
        name: '幕末',
        persons: [{ id: 'p_ryoma', name: '坂本龍馬', birth: { year: 1836 }, death: { year: 1867 }, tags: [] }],
        events: [{ id: 'e_taisei', name: '大政奉還', year: 1867, personId: 'p_ryoma', tags: [] }],
        sortMode: 'birthAsc',
        personOrder: [],
        view: { startYear: null, endYear: null, zoom: 'year' },
      },
    ],
  });
}

const state = () => useAppStore.getState();

function currentStore(): Store {
  const store = state().store;
  if (store === null) {
    throw new Error('テスト前提エラー: ストアが未初期化です');
  }
  return store;
}

function activeTimeline(): Timeline {
  const store = currentStore();
  const timeline = store.timelines.find((t) => t.id === store.activeTimelineId);
  if (timeline === undefined) {
    throw new Error('テスト前提エラー: activeTimelineId が timelines に存在しません');
  }
  return timeline;
}

// ミューテーション後の参照整合性の機械的検証（E-STORE-* を作っていないことの網）
function expectStoreIntegrity(): void {
  expect(() => storeSchema.parse(currentStore())).not.toThrow();
}

const personInput = (
  name: string,
  birthYear: number,
  opts: { deathYear?: number; tags?: string[] } = {},
): PersonInput => ({
  name,
  birth: { year: sy(birthYear) },
  death: opts.deathYear === undefined ? undefined : { year: sy(opts.deathYear) },
  tags: opts.tags ?? [],
});

const eventInput = (
  name: string,
  year: number,
  opts: { personId?: string; tags?: string[] } = {},
): TimelineEventInput => ({
  name,
  year: sy(year),
  personId: opts.personId,
  tags: opts.tags ?? [],
});

beforeEach(() => {
  useAppStore.setState({ store: null });
  state().initializeStore(fixtureStore());
});

describe('未初期化ガード', () => {
  it('initializeStore 前のミューテーションは明示的に失敗する', () => {
    useAppStore.setState({ store: null });
    expect(() => state().addPerson(personInput('テスト', 1500))).toThrow(/未初期化/);
  });
});

describe('addPerson / updatePerson（US-001/008）', () => {
  it('p_ 接頭辞の新規idで人物を追加し、参照整合性を保つ', () => {
    const id = state().addPerson(personInput('明智光秀', 1528, { deathYear: 1582 }));
    expect(id).toMatch(/^p_/);
    const added = activeTimeline().persons.find((p) => p.id === id);
    expect(added?.name).toBe('明智光秀');
    expect(activeTimeline().persons).toHaveLength(4);
    expectStoreIntegrity();
  });

  it('birthAsc のときは personOrder に触らない', () => {
    state().addPerson(personInput('明智光秀', 1528));
    expect(activeTimeline().personOrder).toEqual([]);
    expectStoreIntegrity();
  });

  it('manual のときの新規人物は personOrder 末尾に追加される（done契約）', () => {
    state().setSortMode('manual');
    const id = state().addPerson(personInput('明智光秀', 1528));
    const order = activeTimeline().personOrder;
    expect(order[order.length - 1]).toBe(id);
    expect(order).toHaveLength(4);
    expectStoreIntegrity();
  });

  it('他の年表には影響しない', () => {
    state().addPerson(personInput('明智光秀', 1528));
    const other = currentStore().timelines.find((t) => t.id === 'tl_bakumatsu');
    expect(other?.persons).toHaveLength(1);
  });

  it('updatePerson は id を保ったまま内容を置き換える', () => {
    state().updatePerson('p_ieyasu', personInput('徳川家康（改）', 1543, { deathYear: 1616, tags: ['江戸'] }));
    const person = activeTimeline().persons.find((p) => p.id === 'p_ieyasu');
    expect(person?.name).toBe('徳川家康（改）');
    expect(person?.tags).toEqual(['江戸']);
    expect(activeTimeline().persons).toHaveLength(3);
    expectStoreIntegrity();
  });

  it('updatePerson は存在しない id で失敗する', () => {
    expect(() => state().updatePerson('p_missing', personInput('誰か', 1500))).toThrow(/存在しません/);
  });
});

describe('deletePerson の2ポリシー（US-001・done契約）', () => {
  it('deleteEvents: 紐付く個人イベントも削除し、他の人物のイベント・全体イベントは残す', () => {
    state().deletePerson('p_ieyasu', 'deleteEvents');
    const t = activeTimeline();
    expect(t.persons.map((p) => p.id)).toEqual(['p_nobunaga', 'p_hideyoshi']);
    expect(t.events.map((e) => e.id)).toEqual(['e_honnoji', 'e_keicho']);
    expectStoreIntegrity();
  });

  it('unlink: イベントは personId を外して全体イベントとして残す', () => {
    state().deletePerson('p_ieyasu', 'unlink');
    const t = activeTimeline();
    expect(t.events).toHaveLength(4);
    const sekigahara = t.events.find((e) => e.id === 'e_sekigahara');
    expect(sekigahara?.personId).toBeUndefined();
    expect(sekigahara?.name).toBe('関ヶ原の戦い');
    // 他の人物のイベントの紐付けは維持される
    expect(t.events.find((e) => e.id === 'e_honnoji')?.personId).toBe('p_nobunaga');
    expectStoreIntegrity();
  });

  it('personOrder からも除去される（manual 並び）', () => {
    state().setSortMode('manual'); // personOrder = [信長, 秀吉, 家康]
    state().deletePerson('p_hideyoshi', 'deleteEvents');
    expect(activeTimeline().personOrder).toEqual(['p_nobunaga', 'p_ieyasu']);
    expectStoreIntegrity(); // manual の過不足なし規則（E-STORE-ORDER-MISMATCH）を parse で確認
  });

  it('birthAsc 中に保持されている手動順からも除去される', () => {
    state().setSortMode('manual');
    state().setSortMode('birthAsc'); // personOrder は保持されたまま
    state().deletePerson('p_nobunaga', 'unlink');
    expect(activeTimeline().personOrder).toEqual(['p_hideyoshi', 'p_ieyasu']);
    expectStoreIntegrity();
  });

  it('存在しない id で失敗する', () => {
    expect(() => state().deletePerson('p_missing', 'deleteEvents')).toThrow(/存在しません/);
  });
});

describe('addEvent / updateEvent / deleteEvent（US-003）', () => {
  it('e_ 接頭辞の新規idでイベントを追加する（全体イベント）', () => {
    const id = state().addEvent(eventInput('桶狭間の戦い', 1560));
    expect(id).toMatch(/^e_/);
    const added = activeTimeline().events.find((e) => e.id === id);
    expect(added?.name).toBe('桶狭間の戦い');
    expect(added?.personId).toBeUndefined();
    expectStoreIntegrity();
  });

  it('personId 付き（個人イベント）で追加できる', () => {
    const id = state().addEvent(eventInput('清洲同盟', 1562, { personId: 'p_nobunaga' }));
    expect(activeTimeline().events.find((e) => e.id === id)?.personId).toBe('p_nobunaga');
    expectStoreIntegrity();
  });

  it('存在しない人物への紐付けは E-STORE-EVENT-ORPHAN で失敗し、ストアは変わらない', () => {
    expect(() => state().addEvent(eventInput('孤児イベント', 1600, { personId: 'p_missing' }))).toThrow(
      /E-STORE-EVENT-ORPHAN/,
    );
    expect(activeTimeline().events).toHaveLength(4);
    expectStoreIntegrity();
  });

  it('updateEvent は id を保ったまま内容を置き換える', () => {
    state().updateEvent('e_keicho', eventInput('慶長伏見地震', 1596, { personId: 'p_hideyoshi' }));
    const event = activeTimeline().events.find((e) => e.id === 'e_keicho');
    expect(event?.name).toBe('慶長伏見地震');
    expect(event?.year).toBe(1596);
    expect(event?.personId).toBe('p_hideyoshi');
    expectStoreIntegrity();
  });

  it('updateEvent は存在しない id・存在しない personId で失敗する', () => {
    expect(() => state().updateEvent('e_missing', eventInput('x', 1600))).toThrow(/存在しません/);
    expect(() => state().updateEvent('e_keicho', eventInput('x', 1600, { personId: 'p_missing' }))).toThrow(
      /E-STORE-EVENT-ORPHAN/,
    );
  });

  it('deleteEvent はイベントを削除し、存在しない id で失敗する', () => {
    state().deleteEvent('e_keicho');
    expect(activeTimeline().events.map((e) => e.id)).toEqual(['e_sekigahara', 'e_taiju', 'e_honnoji']);
    expect(() => state().deleteEvent('e_keicho')).toThrow(/存在しません/);
    expectStoreIntegrity();
  });
});

describe('reorderPerson / setSortMode（US-008）', () => {
  it('birthAsc からの reorderPerson は manual に切り替え、現在の生年順を基準に並べ替える', () => {
    state().reorderPerson('p_ieyasu', 0); // 生年順 [信長, 秀吉, 家康] の家康を先頭へ
    const t = activeTimeline();
    expect(t.sortMode).toBe('manual');
    expect(t.personOrder).toEqual(['p_ieyasu', 'p_nobunaga', 'p_hideyoshi']);
    expectStoreIntegrity();
  });

  it('toIndex が範囲外でも端へクランプされる', () => {
    state().reorderPerson('p_nobunaga', 99);
    expect(activeTimeline().personOrder).toEqual(['p_hideyoshi', 'p_ieyasu', 'p_nobunaga']);
    state().reorderPerson('p_ieyasu', -5);
    expect(activeTimeline().personOrder).toEqual(['p_ieyasu', 'p_hideyoshi', 'p_nobunaga']);
    expectStoreIntegrity();
  });

  it('存在しない id で失敗する', () => {
    expect(() => state().reorderPerson('p_missing', 0)).toThrow(/存在しません/);
  });

  it('setSortMode(manual) 初回は現在の生年順を初期の手動順にする（表示が入れ替わらない）', () => {
    state().setSortMode('manual');
    const t = activeTimeline();
    expect(t.sortMode).toBe('manual');
    expect(t.personOrder).toEqual(['p_nobunaga', 'p_hideyoshi', 'p_ieyasu']);
    expectStoreIntegrity();
  });

  it('birthAsc に戻しても personOrder は保持し、再度 manual で前回の手動順に復帰する', () => {
    state().reorderPerson('p_ieyasu', 0); // 手動順 [家康, 信長, 秀吉]
    state().setSortMode('birthAsc');
    expect(activeTimeline().sortMode).toBe('birthAsc');
    expect(activeTimeline().personOrder).toEqual(['p_ieyasu', 'p_nobunaga', 'p_hideyoshi']);
    state().setSortMode('manual');
    expect(activeTimeline().personOrder).toEqual(['p_ieyasu', 'p_nobunaga', 'p_hideyoshi']);
    expectStoreIntegrity();
  });

  it('birthAsc 中に追加された人物は、manual に戻したとき末尾に置かれる（US-008）', () => {
    state().reorderPerson('p_ieyasu', 0); // 手動順 [家康, 信長, 秀吉]
    state().setSortMode('birthAsc');
    const newId = state().addPerson(personInput('明智光秀', 1528)); // birthAsc 中の追加
    state().setSortMode('manual');
    expect(activeTimeline().personOrder).toEqual(['p_ieyasu', 'p_nobunaga', 'p_hideyoshi', newId]);
    expectStoreIntegrity(); // 過不足なし（E-STORE-ORDER-MISMATCH を作らない）
  });
});

describe('addTimeline / renameTimeline / deleteTimeline / switchTimeline（US-009）', () => {
  it('addTimeline は空の年表を作成して切り替える', () => {
    const id = state().addTimeline('江戸');
    expect(id).toMatch(/^tl_/);
    const store = currentStore();
    expect(store.activeTimelineId).toBe(id);
    expect(store.timelines).toHaveLength(3);
    const added = activeTimeline();
    expect(added.name).toBe('江戸');
    expect(added.persons).toEqual([]);
    expect(added.events).toEqual([]);
    expect(added.sortMode).toBe('birthAsc');
    expect(added.view).toEqual({ startYear: null, endYear: null, zoom: 'year' });
    expectStoreIntegrity();
  });

  it('renameTimeline は名前だけを変更する', () => {
    state().renameTimeline('tl_bakumatsu', '幕末維新');
    const renamed = currentStore().timelines.find((t) => t.id === 'tl_bakumatsu');
    expect(renamed?.name).toBe('幕末維新');
    expect(renamed?.persons).toHaveLength(1);
    expectStoreIntegrity();
  });

  it('表示中でない年表の削除では active は変わらない', () => {
    state().deleteTimeline('tl_bakumatsu');
    const store = currentStore();
    expect(store.activeTimelineId).toBe('tl_sengoku');
    expect(store.timelines).toHaveLength(1);
    expectStoreIntegrity();
  });

  it('表示中の年表を削除すると隣の年表へ切り替わる', () => {
    state().deleteTimeline('tl_sengoku');
    expect(currentStore().activeTimelineId).toBe('tl_bakumatsu');
    expectStoreIntegrity();
  });

  it('最後の年表を削除すると空の「年表1」が自動作成される（done契約・data-model.md 3章）', () => {
    state().deleteTimeline('tl_sengoku');
    state().deleteTimeline('tl_bakumatsu');
    const store = currentStore();
    expect(store.timelines).toHaveLength(1);
    const fresh = activeTimeline();
    expect(fresh.name).toBe('年表1');
    expect(fresh.persons).toEqual([]);
    expect(fresh.events).toEqual([]);
    expect(fresh.sortMode).toBe('birthAsc');
    expect(fresh.personOrder).toEqual([]);
    expect(fresh.view).toEqual({ startYear: null, endYear: null, zoom: 'year' });
    expectStoreIntegrity();
  });

  it('switchTimeline は表示中の年表を切り替える', () => {
    state().switchTimeline('tl_bakumatsu');
    expect(currentStore().activeTimelineId).toBe('tl_bakumatsu');
    expectStoreIntegrity();
  });

  it('deleteTimeline / renameTimeline / switchTimeline は存在しない id で失敗する', () => {
    expect(() => state().deleteTimeline('tl_missing')).toThrow(/存在しません/);
    expect(() => state().renameTimeline('tl_missing', 'x')).toThrow(/存在しません/);
    expect(() => state().switchTimeline('tl_missing')).toThrow(/存在しません/);
  });
});

describe('setViewRange / setZoom（US-006/007）', () => {
  it('表示中の年表の表示範囲だけを変更する（null = 自動指定も可）', () => {
    state().setViewRange(sy(1500), sy(1700));
    expect(activeTimeline().view).toEqual({ startYear: 1500, endYear: 1700, zoom: 'year' });
    const other = currentStore().timelines.find((t) => t.id === 'tl_bakumatsu');
    expect(other?.view.startYear).toBeNull();
    state().setViewRange(null, null);
    expect(activeTimeline().view.startYear).toBeNull();
    expect(activeTimeline().view.endYear).toBeNull();
    expectStoreIntegrity();
  });

  it('setZoom はズームだけを変更する（範囲は保持）', () => {
    state().setViewRange(sy(1500), sy(1700));
    state().setZoom('decade');
    expect(activeTimeline().view).toEqual({ startYear: 1500, endYear: 1700, zoom: 'decade' });
    expectStoreIntegrity();
  });
});

describe('replaceStore（US-011: すべて置き換え・リカバリ）', () => {
  it('ストア全体を置き換える', () => {
    const replacement = storeSchema.parse({
      schemaVersion: 1,
      activeTimelineId: 'tl_new',
      timelines: [
        {
          id: 'tl_new',
          name: '置き換え後',
          persons: [],
          events: [],
          sortMode: 'birthAsc',
          personOrder: [],
          view: { startYear: null, endYear: null, zoom: 'year' },
        },
      ],
    });
    state().replaceStore(replacement);
    expect(currentStore()).toBe(replacement);
    expectStoreIntegrity();
  });

  it('未初期化（リカバリ画面 = 初期ロード失敗）でも使える', () => {
    useAppStore.setState({ store: null });
    state().replaceStore(fixtureStore());
    expect(currentStore().activeTimelineId).toBe('tl_sengoku');
    expectStoreIntegrity();
  });
});

describe('appendTimelines（US-011: 年表として追加）', () => {
  // インポート元 = 自分自身のエクスポート（id が全部衝突する最悪ケース）
  const sourceTimelines = () => fixtureStore().timelines;

  it('timeline/person/event の id をすべて新規採番して追加する（既存とは衝突しない）', () => {
    state().appendTimelines(sourceTimelines());
    const store = currentStore();
    expect(store.timelines).toHaveLength(4);
    const appended = store.timelines.slice(2);
    const sourceIds = new Set([
      'tl_sengoku',
      'tl_bakumatsu',
      'p_ieyasu',
      'p_nobunaga',
      'p_hideyoshi',
      'p_ryoma',
      'e_sekigahara',
      'e_taiju',
      'e_honnoji',
      'e_keicho',
      'e_taisei',
    ]);
    for (const t of appended) {
      expect(sourceIds.has(t.id)).toBe(false);
      for (const p of t.persons) {
        expect(sourceIds.has(p.id)).toBe(false);
      }
      for (const e of t.events) {
        expect(sourceIds.has(e.id)).toBe(false);
      }
    }
    // parse が E-STORE-DUP-TIMELINE / E-STORE-DUP-ID / E-STORE-EVENT-ORPHAN の網になる
    expectStoreIntegrity();
  });

  it('event.personId は旧id→新idで再マップされ E-STORE-EVENT-ORPHAN を作らない（done契約）', () => {
    state().appendTimelines(sourceTimelines());
    const appendedSengoku = currentStore().timelines[2];
    expect(appendedSengoku).toBeDefined();
    const newIeyasu = appendedSengoku?.persons.find((p) => p.name === '徳川家康');
    const newSekigahara = appendedSengoku?.events.find((e) => e.name === '関ヶ原の戦い');
    expect(newIeyasu).toBeDefined();
    expect(newSekigahara?.personId).toBe(newIeyasu?.id);
    // 全体イベントは紐付けなしのまま
    expect(appendedSengoku?.events.find((e) => e.name === '慶長の大地震')?.personId).toBeUndefined();
    expectStoreIntegrity();
  });

  it('manual 年表の personOrder も再マップされる（E-STORE-ORDER-MISMATCH を作らない）', () => {
    const source = sourceTimelines();
    const manualSource: Timeline = {
      ...(source[0] as Timeline),
      sortMode: 'manual',
      personOrder: ['p_ieyasu', 'p_nobunaga', 'p_hideyoshi'],
    };
    state().appendTimelines([manualSource]);
    const appended = currentStore().timelines[2];
    expect(appended?.sortMode).toBe('manual');
    const names = appended?.personOrder.map(
      (pid) => appended.persons.find((p) => p.id === pid)?.name,
    );
    expect(names).toEqual(['徳川家康', '織田信長', '豊臣秀吉']); // 手動順が維持される
    expectStoreIntegrity();
  });

  it('同じファイルを2回追加しても id 衝突しない', () => {
    state().appendTimelines(sourceTimelines());
    state().appendTimelines(sourceTimelines());
    expect(currentStore().timelines).toHaveLength(6);
    expectStoreIntegrity();
  });

  it('表示中の年表・既存データは変わらない', () => {
    const before = activeTimeline();
    state().appendTimelines(sourceTimelines());
    expect(currentStore().activeTimelineId).toBe('tl_sengoku');
    expect(activeTimeline()).toBe(before); // 参照ごと不変（イミュータブル更新）
  });
});

describe('ミューテーション連続適用後の参照整合性（総合）', () => {
  it('一連の操作後も storeSchema を通る', () => {
    const pid = state().addPerson(personInput('明智光秀', 1528, { deathYear: 1582, tags: ['戦国'] }));
    state().addEvent(eventInput('山崎の戦い', 1582, { personId: pid }));
    state().reorderPerson(pid, 0);
    state().deletePerson('p_hideyoshi', 'unlink');
    state().addTimeline('江戸');
    state().switchTimeline('tl_sengoku');
    state().setViewRange(sy(-100), sy(1700));
    state().setZoom('decade');
    state().appendTimelines(fixtureStore().timelines);
    state().deleteTimeline('tl_bakumatsu');
    expectStoreIntegrity();
  });
});
