import { describe, expect, it } from 'vitest';

import { exportFileName } from '../../src/client/exportDownload';
import { buildExportPayload, storeForExportScope } from '../../src/domain/export';
import { storeSchema, type Store } from '../../src/domain/schema';

// エクスポート範囲の絞り込み（TASK-201 / ui-forms-dialogs.md 4章 / data-model.md 6章）。
// 「現在の年表のみ」= timelines を表示中の1件に絞り activeTimelineId をその年表の id に
// 差し替える（E-STORE-ACTIVE-MISSING になる自己矛盾ファイルを生成しない）。

// 表示中（active）が先頭でない2年表構成にして「先頭でなく active を選ぶ」ことを検証できる形にする
function fixtureStore(): Store {
  return storeSchema.parse({
    schemaVersion: 1,
    activeTimelineId: 'tl_2',
    timelines: [
      {
        id: 'tl_1',
        name: '戦国',
        persons: [
          {
            id: 'p_1',
            name: '徳川家康',
            birth: { year: 1543 },
            death: { year: 1616 },
            tags: ['戦国'],
          },
        ],
        events: [{ id: 'e_1', name: '関ヶ原の戦い', year: 1600, tags: ['合戦'] }],
        sortMode: 'birthAsc',
        personOrder: [],
        view: { startYear: null, endYear: null, zoom: 'year' },
      },
      {
        id: 'tl_2',
        name: '幕末',
        persons: [{ id: 'p_1', name: '坂本龍馬', birth: { year: 1836 }, tags: [] }],
        events: [{ id: 'e_1', name: '大政奉還', year: 1867, personId: undefined, tags: [] }],
        sortMode: 'birthAsc',
        personOrder: [],
        view: { startYear: null, endYear: null, zoom: 'year' },
      },
    ],
  });
}

describe('storeForExportScope（エクスポート範囲の絞り込み）', () => {
  it('current: timelines が表示中の1件だけに絞られる（先頭でなく active を選ぶ）', () => {
    const store = fixtureStore();
    const narrowed = storeForExportScope(store, 'current');
    expect(narrowed.timelines).toHaveLength(1);
    expect(narrowed.timelines[0]?.id).toBe('tl_2');
    expect(narrowed.timelines[0]?.name).toBe('幕末');
  });

  it('current: activeTimelineId が絞った年表の id を指す（自己矛盾ファイルを作らない）', () => {
    const narrowed = storeForExportScope(fixtureStore(), 'current');
    expect(narrowed.activeTimelineId).toBe(narrowed.timelines[0]?.id);
  });

  it('current: 絞った結果も storeSchema の検証（参照整合性含む）を通る', () => {
    const narrowed = storeForExportScope(fixtureStore(), 'current');
    // JSON 往復 = 実際にダウンロードされるファイルと同じ形で検証する
    const roundTrip = JSON.parse(JSON.stringify(narrowed)) as unknown;
    expect(storeSchema.safeParse(roundTrip).success).toBe(true);
  });

  it('current: 元のストアは変更されない（2年表のまま）', () => {
    const store = fixtureStore();
    storeForExportScope(store, 'current');
    expect(store.timelines).toHaveLength(2);
    expect(store.activeTimelineId).toBe('tl_2');
  });

  it('current: schemaVersion など他のフィールドは保たれる', () => {
    const narrowed = storeForExportScope(fixtureStore(), 'current');
    expect(narrowed.schemaVersion).toBe(1);
  });

  it('all: ストア全体がそのまま返る（全年表・activeTimelineId 不変）', () => {
    const store = fixtureStore();
    const result = storeForExportScope(store, 'all');
    expect(result).toBe(store);
    expect(result.timelines).toHaveLength(2);
  });

  it('active が timelines に無い不整合は黙って壊れたファイルを吐かず throw する', () => {
    const store = fixtureStore();
    const broken = { ...store, activeTimelineId: 'tl_missing' };
    expect(() => storeForExportScope(broken, 'current')).toThrow(/E-STORE-ACTIVE-MISSING/);
  });

  it('current の結果を buildExportPayload に包んでも store が検証を通る（ダイアログの実経路）', () => {
    const payload = buildExportPayload(storeForExportScope(fixtureStore(), 'current'), {
      exportedAt: '2026-08-18T10:00:00+09:00',
      appVersion: '0.1.0',
    });
    const roundTrip = JSON.parse(JSON.stringify(payload)) as { format: string; store: unknown };
    expect(roundTrip.format).toBe('chronolines-export');
    expect(storeSchema.safeParse(roundTrip.store).success).toBe(true);
  });
});

describe('exportFileName（TASK-201 のファイル名生成）', () => {
  it('形式は chronolines-export-YYYYMMDD-HHmm.json', () => {
    expect(exportFileName(new Date(2026, 7, 18, 14, 30, 0))).toBe(
      'chronolines-export-20260818-1430.json',
    );
  });

  it('年末・分の境界値もゼロ埋めで崩れない', () => {
    expect(exportFileName(new Date(2026, 11, 31, 23, 59, 59))).toBe(
      'chronolines-export-20261231-2359.json',
    );
    expect(exportFileName(new Date(2027, 0, 1, 0, 0, 0))).toBe(
      'chronolines-export-20270101-0000.json',
    );
  });
});
