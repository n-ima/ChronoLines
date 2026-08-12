import { describe, expect, it } from 'vitest';

import { exportFileName, formatExportedAt } from '../../src/client/exportDownload';
import { buildExportPayload, EXPORT_FORMAT } from '../../src/domain/export';
import { storeSchema, type Store } from '../../src/domain/schema';

// エクスポート形式（data-model.md 6章）の生成関数のテスト（TASK-101 の done 契約）。
// エクスポートファイル = Store + 識別用メタデータ（format / exportedAt / appVersion）

function fixtureStore(): Store {
  return storeSchema.parse({
    schemaVersion: 1,
    activeTimelineId: 'tl_1',
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
    ],
  });
}

describe('buildExportPayload（data-model.md 6章のエクスポート形式）', () => {
  const store = fixtureStore();
  const payload = buildExportPayload(store, {
    exportedAt: '2026-08-12T10:00:00+09:00',
    appVersion: '1.0.0',
  });

  it('format はインポート時の形式判別キー chronolines-export', () => {
    expect(payload.format).toBe('chronolines-export');
    expect(EXPORT_FORMAT).toBe('chronolines-export');
  });

  it('exportedAt は渡した日時文字列がそのまま入る', () => {
    expect(payload.exportedAt).toBe('2026-08-12T10:00:00+09:00');
  });

  it('appVersion は渡した版数がそのまま入る', () => {
    expect(payload.appVersion).toBe('1.0.0');
  });

  it('store は保存データがそのまま入る（加工・欠落なし）', () => {
    expect(payload.store).toBe(store);
  });

  it('キー順は data-model.md 6章の例のとおり（format が先頭）', () => {
    expect(Object.keys(payload)).toEqual(['format', 'exportedAt', 'appVersion', 'store']);
  });

  it('JSON 往復後も store が storeSchema 検証を通る（再インポート可能な形）', () => {
    const roundTrip = JSON.parse(JSON.stringify(payload)) as { store: unknown };
    expect(storeSchema.safeParse(roundTrip.store).success).toBe(true);
  });
});

describe('formatExportedAt / exportFileName（エクスポートのメタデータ表記）', () => {
  it('exportedAt はローカル時刻 + タイムゾーンオフセット表記（例 2026-08-12T10:00:00+09:00）', () => {
    const formatted = formatExportedAt(new Date(2026, 7, 12, 10, 0, 0));
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('表記を Date に戻すと同時刻になる（オフセット計算が正しい）', () => {
    const original = new Date(2026, 7, 12, 10, 0, 0);
    expect(new Date(formatExportedAt(original)).getTime()).toBe(original.getTime());
  });

  it('ファイル名は chronolines-export-YYYYMMDD-HHmm.json（data-model.md 6章）', () => {
    expect(exportFileName(new Date(2026, 7, 12, 10, 5, 0))).toBe(
      'chronolines-export-20260812-1005.json',
    );
  });

  it('月日・時分は2桁ゼロ埋めされる', () => {
    expect(exportFileName(new Date(2026, 0, 3, 4, 5, 0))).toBe(
      'chronolines-export-20260103-0405.json',
    );
  });
});
