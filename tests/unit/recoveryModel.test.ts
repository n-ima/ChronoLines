import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bakPathOf,
  createRecoveryInitialStore,
  interpretRecoveryPutResponse,
  putRecoveryStore,
} from '../../src/client/components/recoveryModel';
import { CURRENT_SCHEMA_VERSION, storeSchema, type Store } from '../../src/domain/schema';

// リカバリ画面の分離可能ロジック（TASK-203 / ui-forms-dialogs.md 6章 / server-api.md 3章）。
// 〔空のデータで開始〕の初期ストア・.bak パスの提示・recovery:true PUT の送信内容と
// 応答の読み替え（成功 / エラーIDカタログ / 解釈不能応答 / 接続不可）を網羅する。

describe('createRecoveryInitialStore', () => {
  it('data-model.md 3章の初期ストア（空の「年表1」のみ）を返し、storeSchema を満たす', () => {
    const store = createRecoveryInitialStore();
    expect(() => storeSchema.parse(store)).not.toThrow();
    expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(store.timelines).toHaveLength(1);
    const timeline = store.timelines[0]!;
    expect(store.activeTimelineId).toBe(timeline.id);
    expect(timeline.name).toBe('年表1');
    expect(timeline.persons).toEqual([]);
    expect(timeline.events).toEqual([]);
    expect(timeline.sortMode).toBe('birthAsc');
    expect(timeline.personOrder).toEqual([]);
    expect(timeline.view).toEqual({ startYear: null, endYear: null, zoom: 'year' });
  });

  it('呼び出しごとに新しい年表 id を採番する（tl_ 接頭辞）', () => {
    const first = createRecoveryInitialStore();
    const second = createRecoveryInitialStore();
    expect(first.timelines[0]!.id).toMatch(/^tl_/);
    expect(first.timelines[0]!.id).not.toBe(second.timelines[0]!.id);
  });
});

describe('bakPathOf', () => {
  it('データファイルパス + ".bak"（storage.ts の BAK_FILE と同じ命名）', () => {
    expect(bakPathOf(String.raw`C:\Users\a\AppData\Local\ChronoLines\chronolines.json`)).toBe(
      String.raw`C:\Users\a\AppData\Local\ChronoLines\chronolines.json.bak`,
    );
  });

  it('dataPath 不明時はファイル名だけで案内する', () => {
    expect(bakPathOf(undefined)).toBe('chronolines.json.bak');
  });
});

describe('interpretRecoveryPutResponse', () => {
  it('2xx は本文の形に関わらず成功（書き込みはサーバーで完了している）', () => {
    expect(interpretRecoveryPutResponse(true, { rev: 2 })).toEqual({ ok: true });
    expect(interpretRecoveryPutResponse(true, undefined)).toEqual({ ok: true });
  });

  it('エラー応答は message + code を表示文にし、string の detail を添える', () => {
    const outcome = interpretRecoveryPutResponse(false, {
      error: { code: 'E-SAVE-FAILED', message: '保存に失敗しました', detail: 'EACCES: ...' },
    });
    expect(outcome).toEqual({
      ok: false,
      message: '保存に失敗しました（E-SAVE-FAILED）',
      detail: 'EACCES: ...',
    });
  });

  it('E-VALIDATION の string[] detail は " / " 連結で1つの折りたたみにする', () => {
    const outcome = interpretRecoveryPutResponse(false, {
      error: {
        code: 'E-VALIDATION',
        message: 'スキーマ検証失敗',
        detail: ['timelines.0.persons.0.id: 必須', 'ほか1件'],
      },
    });
    expect(outcome).toEqual({
      ok: false,
      message: 'スキーマ検証失敗（E-VALIDATION）',
      detail: 'timelines.0.persons.0.id: 必須 / ほか1件',
    });
  });

  it('detail が無い・解釈できない形のときは detail を付けない', () => {
    expect(
      interpretRecoveryPutResponse(false, { error: { code: 'E-STORE-NEWER', message: 'x' } }),
    ).toEqual({ ok: false, message: 'x（E-STORE-NEWER）' });
    expect(
      interpretRecoveryPutResponse(false, {
        error: { code: 'E-X', message: 'x', detail: { nested: true } },
      }),
    ).toEqual({ ok: false, message: 'x（E-X）' });
  });

  it('エラー応答が解釈できない形でも「データファイルは変更されていません」を伝えて失敗にする', () => {
    const outcome = interpretRecoveryPutResponse(false, 'Bad Gateway');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('データファイルは変更されていません');
    }
  });
});

describe('putRecoveryStore', () => {
  const fetchMock =
    vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
  let store: Store;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    store = createRecoveryInitialStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PUT /api/store に store と recovery:true を送る（rev 照合はサーバー側でスキップされる）', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ rev: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const outcome = await putRecoveryStore(store);
    expect(outcome).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/store');
    expect(init?.method).toBe('PUT');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body['recovery']).toBe(true);
    expect(body['store']).toEqual(store);
  });

  it('409（E-STORE-NEWER 等）はエラー表示に読み替える', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'E-STORE-NEWER', message: 'より新しいバージョンのアプリで保存されたデータです' },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const outcome = await putRecoveryStore(store);
    expect(outcome).toEqual({
      ok: false,
      message: 'より新しいバージョンのアプリで保存されたデータです（E-STORE-NEWER）',
    });
  });

  it('JSON でない応答（プロキシのエラーページ等）も握りつぶさず失敗にする', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>502</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    );
    const outcome = await putRecoveryStore(store);
    expect(outcome.ok).toBe(false);
  });

  it('ネットワークエラー（サーバー停止）は接続確認を促す失敗にする', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const outcome = await putRecoveryStore(store);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('サーバーに接続できませんでした');
      expect(outcome.message).toContain('データファイルは変更されていません');
    }
  });
});
