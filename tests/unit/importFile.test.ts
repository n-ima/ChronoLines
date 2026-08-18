import { describe, expect, it } from 'vitest';

import { buildExportPayload, storeForExportScope } from '../../src/domain/export';
import {
  formatExportedAtDisplay,
  parseImportFile,
  storeSummary,
  type ImportParseResult,
} from '../../src/domain/import';
import { CURRENT_SCHEMA_VERSION, storeSchema } from '../../src/domain/schema';

// インポートファイルの判別・検証（TASK-202 / data-model.md 6章 / ui-forms-dialogs.md 5章）。
// 受理2形式（エクスポート形式 / 保存形式）・壊れたJSON拒否（E-IMPORT-INVALID）・
// 新版拒否（E-IMPORT-NEWER）を網羅する（done 契約の機械的検証）。

// ---- ヘルパー: テストデータビルダー（migrate.test.ts と同型。上書きで違反ケースを作る） ----

const validPerson = (overrides: Record<string, unknown> = {}) => ({
  id: 'p_1',
  name: '徳川家康',
  birth: { year: 1543 },
  death: { year: 1616 },
  ...overrides,
});

const validTimeline = (overrides: Record<string, unknown> = {}) => ({
  id: 'tl_1',
  name: '戦国',
  persons: [validPerson()],
  events: [{ id: 'e_1', name: '関ヶ原の戦い', year: 1600, personId: 'p_1' }],
  sortMode: 'birthAsc',
  personOrder: [],
  view: { startYear: null, endYear: null, zoom: 'year' },
  ...overrides,
});

const validStore = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  activeTimelineId: 'tl_1',
  timelines: [validTimeline()],
  ...overrides,
});

const validWrapper = (overrides: Record<string, unknown> = {}) => ({
  format: 'chronolines-export',
  exportedAt: '2026-08-10T21:30:00+09:00',
  appVersion: '0.1.0',
  store: validStore(),
  ...overrides,
});

// ---- ヘルパー: 結果の絞り込みアサーション ----

function expectOk(raw: string): ImportParseResult & { ok: true } {
  const result = parseImportFile(raw);
  if (!result.ok) {
    throw new Error(`ok を期待したが: ${JSON.stringify(result)}`);
  }
  return result;
}

function expectInvalid(raw: string): string {
  const result = parseImportFile(raw);
  if (result.ok || result.code !== 'E-IMPORT-INVALID') {
    throw new Error(`E-IMPORT-INVALID を期待したが: ${JSON.stringify(result)}`);
  }
  return result.detail;
}

function expectNewer(raw: string): number {
  const result = parseImportFile(raw);
  if (result.ok || result.code !== 'E-IMPORT-NEWER') {
    throw new Error(`E-IMPORT-NEWER を期待したが: ${JSON.stringify(result)}`);
  }
  return result.fileVersion;
}

// ---- 受理: エクスポート形式（format キーで判別するラッパー） ----

describe('parseImportFile: エクスポート形式の受理', () => {
  it('正常なラッパー → ok・source=export・exportedAt を保持・store は厳密検証済み', () => {
    const result = expectOk(JSON.stringify(validWrapper()));
    expect(result.source).toBe('export');
    expect(result.exportedAt).toBe('2026-08-10T21:30:00+09:00');
    expect(result.store).toEqual(storeSchema.parse(validStore()));
  });

  it('検証済みの値を返す（tags 省略は既定値 [] が補完される）', () => {
    const result = expectOk(JSON.stringify(validWrapper()));
    expect(result.store.timelines[0]?.persons[0]?.tags).toEqual([]);
  });

  it('exportedAt が文字列でない場合は日時なし扱い（取り込みは成功する）', () => {
    const result = expectOk(JSON.stringify(validWrapper({ exportedAt: 12345 })));
    expect(result.exportedAt).toBeUndefined();
  });

  it('ラッパーの未知メタデータは取り込みの成否に関与しない（store の検証が正）', () => {
    const result = expectOk(JSON.stringify(validWrapper({ extraMeta: 'x' })));
    expect(result.ok).toBe(true);
  });

  it('エクスポートの実経路（buildExportPayload → JSON 往復）が受理される', () => {
    const store = storeSchema.parse(validStore());
    const payload = buildExportPayload(storeForExportScope(store, 'current'), {
      exportedAt: '2026-08-18T10:00:00+09:00',
      appVersion: '0.1.0',
    });
    const result = expectOk(JSON.stringify(payload));
    expect(result.source).toBe('export');
    expect(result.store).toEqual(storeForExportScope(store, 'current'));
  });
});

// ---- 受理: 保存形式（Store そのもの。手動復旧経路） ----

describe('parseImportFile: 保存形式の受理', () => {
  it('保存ファイルそのもの → ok・source=store・exportedAt なし', () => {
    const result = expectOk(JSON.stringify(validStore()));
    expect(result.source).toBe('store');
    expect(result.exportedAt).toBeUndefined();
    expect(result.store).toEqual(storeSchema.parse(validStore()));
  });
});

// ---- 拒否: 壊れた JSON・形式不正 → E-IMPORT-INVALID ----

describe('parseImportFile: E-IMPORT-INVALID（既存データは呼び出し側で無変更）', () => {
  it('壊れた JSON 文字列 → E-IMPORT-INVALID（detail にパースエラー概要）', () => {
    expect(expectInvalid('{ これはJSONではない')).toContain('JSONとして解釈できません');
  });

  it('空文字列・途中で切れた JSON → E-IMPORT-INVALID', () => {
    expectInvalid('');
    expectInvalid('{"format": "chronolines-export", "store": {');
  });

  it('format 値が別物のラッパー → E-IMPORT-INVALID', () => {
    expect(expectInvalid(JSON.stringify(validWrapper({ format: 'other-app' })))).toContain(
      'chronolines-export',
    );
  });

  it('store が欠落したラッパー → E-IMPORT-INVALID', () => {
    const { store: _omitted, ...wrapper } = validWrapper();
    expect(expectInvalid(JSON.stringify(wrapper))).toContain('store');
  });

  it('store の内容が不正（0年）→ E-IMPORT-INVALID（detail に Zod issue）', () => {
    const detail = expectInvalid(
      JSON.stringify(
        validWrapper({
          store: validStore({
            timelines: [validTimeline({ persons: [validPerson({ birth: { year: 0 } })], events: [] })],
          }),
        }),
      ),
    );
    expect(detail).toContain('0年は存在しません');
  });

  it('参照整合性違反（activeTimelineId 不在）→ E-IMPORT-INVALID', () => {
    expect(expectInvalid(JSON.stringify(validStore({ activeTimelineId: 'tl_missing' })))).toContain(
      'E-STORE-ACTIVE-MISSING',
    );
  });

  it('schemaVersion が整数で取れない → E-IMPORT-INVALID', () => {
    expectInvalid(JSON.stringify(validStore({ schemaVersion: '1' })));
    const { schemaVersion: _omitted, ...withoutVersion } = validStore();
    expectInvalid(JSON.stringify(withoutVersion));
  });

  it('トップレベルが配列・数値 → E-IMPORT-INVALID', () => {
    expectInvalid('[]');
    expectInvalid('42');
  });

  it('旧版は移行チェーンを通す（v0 は移行関数未登録のため E-IMPORT-INVALID）', () => {
    // 現行 v1 で登録簿は空。移行を追加したらこのテストを旧形式サンプルの受理に差し替える
    // （data-model.md 5章の契約）。ここでは「旧版が移行チェーン経路に入る」ことを検証する
    expect(expectInvalid(JSON.stringify(validStore({ schemaVersion: 0 })))).toContain('移行');
  });
});

// ---- 拒否: 新版 → E-IMPORT-NEWER ----

describe('parseImportFile: E-IMPORT-NEWER（新版の拒否）', () => {
  it('保存形式で schemaVersion が現行+1 → E-IMPORT-NEWER・fileVersion を返す', () => {
    expect(
      expectNewer(JSON.stringify(validStore({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }))),
    ).toBe(CURRENT_SCHEMA_VERSION + 1);
  });

  it('ラッパー内の store が新版 → E-IMPORT-NEWER', () => {
    expect(
      expectNewer(
        JSON.stringify(
          validWrapper({ store: validStore({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }) }),
        ),
      ),
    ).toBe(CURRENT_SCHEMA_VERSION + 1);
  });

  it('版判定は内容検証より先（中身が不正でも E-IMPORT-NEWER）', () => {
    expect(
      expectNewer(
        JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, unknownShape: true }),
      ),
    ).toBe(CURRENT_SCHEMA_VERSION + 1);
  });
});

// ---- プレビュー導出 ----

describe('storeSummary（内容プレビューの集計）', () => {
  it('複数年表の人物・イベントを合算する', () => {
    const store = storeSchema.parse(
      validStore({
        activeTimelineId: 'tl_1',
        timelines: [
          validTimeline(),
          validTimeline({
            id: 'tl_2',
            name: '幕末',
            persons: [validPerson({ id: 'p_2', name: '坂本龍馬', birth: { year: 1836 }, death: undefined })],
            events: [
              { id: 'e_2', name: '大政奉還', year: 1867 },
              { id: 'e_3', name: '薩長同盟', year: 1866 },
            ],
          }),
        ],
      }),
    );
    expect(storeSummary(store)).toEqual({ timelineCount: 2, personCount: 2, eventCount: 3 });
  });

  it('空の年表は 0 で数える', () => {
    const store = storeSchema.parse(
      validStore({ timelines: [validTimeline({ persons: [], events: [] })] }),
    );
    expect(storeSummary(store)).toEqual({ timelineCount: 1, personCount: 0, eventCount: 0 });
  });
});

describe('formatExportedAtDisplay（プレビューの日時表記）', () => {
  it('ローカル時刻+オフセット表記 → "YYYY-MM-DD HH:mm"', () => {
    expect(formatExportedAtDisplay('2026-08-10T21:30:00+09:00')).toBe('2026-08-10 21:30');
  });

  it('想定形式でない文字列はそのまま返す（表示のために失敗させない）', () => {
    expect(formatExportedAtDisplay('unknown-date')).toBe('unknown-date');
  });
});
