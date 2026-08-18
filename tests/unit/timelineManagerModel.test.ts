// 年表管理の表示用導出・名前検証（timelineManagerModel.ts）の単体テスト（TASK-113 /
// ui-forms-dialogs.md 3章 / US-009）。一覧（名前・人物数・イベント数・表示中）・
// 名前検証（E-T-NAME-EMPTY）・削除確認の件数（人物n人・イベントm件）を検証する。
// 実際の追加・名前変更・削除・切替（最後の1つ削除→「年表1」自動作成を含む）の正は
// appStore.test.ts（addTimeline / renameTimeline / deleteTimeline / switchTimeline）。
import { describe, expect, it } from 'vitest';

import {
  deleteImpact,
  MANAGE_TIMELINES_VALUE,
  TIMELINE_NAME_MESSAGES,
  timelineListItems,
  validateTimelineName,
} from '../../src/client/components/timelineManagerModel';
import type { Person, Store, Timeline, TimelineEvent } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';

const sy = (n: number) => n as StoredYear;

const person = (id: string, name: string, birthYear: number): Person => ({
  id,
  name,
  birth: { year: sy(birthYear) },
  tags: [],
});

const event = (id: string, name: string, year: number): TimelineEvent => ({
  id,
  name,
  year: sy(year),
  tags: [],
});

const timeline = (
  id: string,
  name: string,
  persons: Person[],
  events: TimelineEvent[],
): Timeline => ({
  id,
  name,
  persons,
  events,
  sortMode: 'birthAsc',
  personOrder: [],
  view: { startYear: null, endYear: null, zoom: 'year' },
});

const sengoku = timeline(
  'tl_sengoku',
  '戦国',
  [person('p_ieyasu', '徳川家康', 1543), person('p_masamune', '伊達政宗', 1567)],
  [event('e_sekigahara', '関ヶ原の戦い', 1600)],
);
const bakumatsu = timeline(
  'tl_bakumatsu',
  '幕末',
  [person('p_ryoma', '坂本龍馬', 1836)],
  [event('e_taisei', '大政奉還', 1867), event('e_boshin', '戊辰戦争', 1868)],
);
const emptyTimeline = timeline('tl_empty', '年表1', [], []);

const store: Store = {
  schemaVersion: 1,
  activeTimelineId: 'tl_bakumatsu',
  timelines: [sengoku, bakumatsu, emptyTimeline],
};

describe('timelineListItems（管理ダイアログの一覧: 名前・人物数・イベント数・表示中）', () => {
  it('年表ごとの名前と人物数・イベント数を返す', () => {
    const items = timelineListItems(store);
    expect(items[0]).toEqual({
      id: 'tl_sengoku',
      name: '戦国',
      personCount: 2,
      eventCount: 1,
      isActive: false,
    });
    expect(items[1]).toEqual({
      id: 'tl_bakumatsu',
      name: '幕末',
      personCount: 1,
      eventCount: 2,
      isActive: true,
    });
  });

  it('isActive は activeTimelineId の年表だけ true になる', () => {
    const items = timelineListItems(store);
    expect(items.map((i) => i.isActive)).toEqual([false, true, false]);
  });

  it('並び順は timelines の保存順を保つ', () => {
    expect(timelineListItems(store).map((i) => i.name)).toEqual(['戦国', '幕末', '年表1']);
  });

  it('空の年表は 人物0・イベント0 になる', () => {
    const items = timelineListItems(store);
    expect(items[2]).toEqual({
      id: 'tl_empty',
      name: '年表1',
      personCount: 0,
      eventCount: 0,
      isActive: false,
    });
  });
});

describe('validateTimelineName（新規作成・名前変更の共通検証。E-T-NAME-EMPTY）', () => {
  it('通常の名前を受理する', () => {
    expect(validateTimelineName('三国志')).toEqual({ ok: true, name: '三国志' });
  });

  it('前後の空白は trim して受理する（timelineSchema の trim().min(1) と整合）', () => {
    expect(validateTimelineName('  三国志  ')).toEqual({ ok: true, name: '三国志' });
  });

  it('空文字は E-T-NAME-EMPTY で拒否する', () => {
    expect(validateTimelineName('')).toEqual({ ok: false, code: 'E-T-NAME-EMPTY' });
  });

  it('半角スペースのみは E-T-NAME-EMPTY で拒否する', () => {
    expect(validateTimelineName('   ')).toEqual({ ok: false, code: 'E-T-NAME-EMPTY' });
  });

  it('全角スペースのみは E-T-NAME-EMPTY で拒否する', () => {
    expect(validateTimelineName('　　')).toEqual({ ok: false, code: 'E-T-NAME-EMPTY' });
  });

  it('タブ・改行のみは E-T-NAME-EMPTY で拒否する', () => {
    expect(validateTimelineName('\t\n')).toEqual({ ok: false, code: 'E-T-NAME-EMPTY' });
  });

  it('50文字ちょうどを受理する（timelineSchema の max(50) と整合。超過は入力側 maxLength）', () => {
    const name = 'あ'.repeat(50);
    expect(validateTimelineName(name)).toEqual({ ok: true, name });
  });

  it('エラーメッセージは設計のカタログ文言「年表名は必須です」', () => {
    expect(TIMELINE_NAME_MESSAGES['E-T-NAME-EMPTY']).toBe('年表名は必須です');
  });
});

describe('deleteImpact（削除確認の「人物n人・イベントm件も削除される」の材料）', () => {
  it('人物数・イベント数を返す', () => {
    expect(deleteImpact(sengoku)).toEqual({ personCount: 2, eventCount: 1 });
    expect(deleteImpact(bakumatsu)).toEqual({ personCount: 1, eventCount: 2 });
  });

  it('空の年表は 0人・0件', () => {
    expect(deleteImpact(emptyTimeline)).toEqual({ personCount: 0, eventCount: 0 });
  });
});

describe('MANAGE_TIMELINES_VALUE（ドロップダウンの〔年表の管理...〕特殊値）', () => {
  it('年表 id の形式（tl_ プレフィックス）と衝突しない', () => {
    expect(MANAGE_TIMELINES_VALUE.startsWith('tl_')).toBe(false);
    expect(MANAGE_TIMELINES_VALUE.length).toBeGreaterThan(0);
  });
});
