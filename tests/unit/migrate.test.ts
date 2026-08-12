import { describe, expect, it } from 'vitest';

import { loadStore, type LoadResult } from '../../src/domain/migrate';
import { CURRENT_SCHEMA_VERSION, storeSchema } from '../../src/domain/schema';

// ---- ヘルパー: テストデータビルダー（schema.test.ts と同型。上書きで違反ケースを作る） ----

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
  persons: [],
  events: [],
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

// ---- ヘルパー: 結果の絞り込みアサーション ----

function expectCorrupt(raw: string): string {
  const result: LoadResult = loadStore(raw);
  expect(result.ok).toBe(false);
  if (result.ok || result.code !== 'CORRUPT') {
    throw new Error(`CORRUPT を期待したが: ${JSON.stringify(result)}`);
  }
  return result.detail;
}

function expectNewerSchema(raw: string): number {
  const result: LoadResult = loadStore(raw);
  expect(result.ok).toBe(false);
  if (result.ok || result.code !== 'NEWER_SCHEMA') {
    throw new Error(`NEWER_SCHEMA を期待したが: ${JSON.stringify(result)}`);
  }
  return result.fileVersion;
}

// ---- 正常系 ----

describe('loadStore: 正常な v1 データ', () => {
  it('schemaVersion=1 の正常データ → ok:true・store は storeSchema.parse と同値', () => {
    const raw = JSON.stringify(validStore());
    const result = loadStore(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.store).toEqual(storeSchema.parse(validStore()));
    expect(result.store.activeTimelineId).toBe('tl_1');
  });

  it('検証済みの値を返す（tags 省略は既定値 [] が補完される。raw のままではない）', () => {
    const raw = JSON.stringify(
      validStore({ timelines: [validTimeline({ persons: [validPerson()] })] }),
    );
    const result = loadStore(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.store.timelines[0]?.persons[0]?.tags).toEqual([]);
  });

  it('移行なし（現行版）のとき migratedFrom は付かない', () => {
    const result = loadStore(JSON.stringify(validStore()));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.migratedFrom).toBeUndefined();
  });
});

// ---- 手順1: JSON.parse 失敗 → CORRUPT ----

describe('loadStore 手順1: JSONとして解釈できない → CORRUPT', () => {
  it('壊れたJSON文字列 → CORRUPT（detail にパースエラー概要）', () => {
    const detail = expectCorrupt('{ これはJSONではない');
    expect(detail).toContain('JSONとして解釈できません');
  });

  it('空文字列 → CORRUPT', () => {
    expectCorrupt('');
  });

  it('途中で切れたJSON → CORRUPT', () => {
    expectCorrupt('{"schemaVersion": 1, "activeTimelineId": "tl_1", "timelines": [');
  });
});

// ---- 手順2: schemaVersion が整数で取れない → CORRUPT ----

describe('loadStore 手順2: schemaVersion が整数で取れない → CORRUPT', () => {
  it('schemaVersion 欠落 → CORRUPT（detail に schemaVersion への言及）', () => {
    const { schemaVersion: _omitted, ...withoutVersion } = validStore();
    const detail = expectCorrupt(JSON.stringify(withoutVersion));
    expect(detail).toContain('schemaVersion');
  });

  it('文字列 "1" は整数で取れない → CORRUPT', () => {
    expectCorrupt(JSON.stringify(validStore({ schemaVersion: '1' })));
  });

  it('小数 1.5 → CORRUPT', () => {
    expectCorrupt(JSON.stringify(validStore({ schemaVersion: 1.5 })));
  });

  it('null → CORRUPT', () => {
    expectCorrupt(JSON.stringify(validStore({ schemaVersion: null })));
  });

  it('トップレベルがオブジェクトでない（配列・数値・null）→ CORRUPT', () => {
    expectCorrupt('[]');
    expectCorrupt('42');
    expectCorrupt('null');
  });
});

// ---- 手順3: 新版 → NEWER_SCHEMA ----

describe('loadStore 手順3: schemaVersion > 現行 → NEWER_SCHEMA', () => {
  it('現行+1 の正常形 → NEWER_SCHEMA・fileVersion を返す', () => {
    const fileVersion = expectNewerSchema(
      JSON.stringify(validStore({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })),
    );
    expect(fileVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
  });

  it('版判定は内容検証より先（中身が不正でも NEWER_SCHEMA を返す）', () => {
    const fileVersion = expectNewerSchema(
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, unknownShape: true }),
    );
    expect(fileVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
  });

  it('大きく離れた新版でも fileVersion をそのまま返す', () => {
    expect(expectNewerSchema(JSON.stringify(validStore({ schemaVersion: 999 })))).toBe(999);
  });
});

// ---- 手順4: 旧版の移行チェーン（現行 v1 のため登録簿は空 = 欠番は CORRUPT） ----

describe('loadStore 手順4: 旧版は移行チェーン適用（欠番があれば CORRUPT 扱い）', () => {
  it('schemaVersion=0 → CORRUPT（v0→v1 の移行関数が未登録）', () => {
    const detail = expectCorrupt(JSON.stringify(validStore({ schemaVersion: 0 })));
    expect(detail).toContain('移行');
  });

  it('負の版も同様に CORRUPT（欠番扱い）', () => {
    expectCorrupt(JSON.stringify(validStore({ schemaVersion: -3 })));
  });
});

// ---- 手順5: storeSchema 検証失敗 → CORRUPT（detail に Zod issue） ----

describe('loadStore 手順5: storeSchema 検証失敗 → CORRUPT（detail に Zod issue）', () => {
  it('0年の人物 → CORRUPT（detail に issue のメッセージとパス）', () => {
    const detail = expectCorrupt(
      JSON.stringify(
        validStore({
          timelines: [validTimeline({ persons: [validPerson({ birth: { year: 0 } })] })],
        }),
      ),
    );
    expect(detail).toContain('0年は存在しません（前1年の翌年は西暦1年です）');
    expect(detail).toContain('timelines.0.persons.0.birth.year');
  });

  it('参照整合性違反 → CORRUPT（detail にエラーID）', () => {
    const detail = expectCorrupt(
      JSON.stringify(validStore({ activeTimelineId: 'tl_missing' })),
    );
    expect(detail).toContain('E-STORE-ACTIVE-MISSING');
  });

  it('未知フィールド → CORRUPT（strictObject の拒否も CORRUPT に集約される）', () => {
    expectCorrupt(JSON.stringify(validStore({ unknownKey: 1 })));
  });

  it('issue が多数でも detail は先頭5件+残り件数に絞る', () => {
    // 名前空の人物7人 = issue 7件（先頭5件を表示し「ほか2件」）
    const persons = Array.from({ length: 7 }, (_, i) =>
      validPerson({ id: `p_${i + 1}`, name: '' }),
    );
    const detail = expectCorrupt(
      JSON.stringify(validStore({ timelines: [validTimeline({ persons })] })),
    );
    expect(detail).toContain('名前は必須です');
    expect(detail).toContain('ほか2件');
  });
});
