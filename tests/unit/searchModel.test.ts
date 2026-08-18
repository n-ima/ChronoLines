// 人物検索の状態モデル（searchModel.ts）の単体テスト（TASK-109 / ui-timeline-grid.md 6章 /
// US-008）。デバウンス後のヒット集合・「k/n件」の巡回・0件時の扱い・データ変化への追従を
// 検証する。名前照合そのもの（NFKC・部分一致）の検算の正は query.test.ts の searchPersons。
import { describe, expect, it } from 'vitest';

import {
  applyQuery,
  currentHit,
  emptySearchState,
  hitCountLabel,
  isNoHit,
  refreshHits,
  SEARCH_DEBOUNCE_MS,
  stepCursor,
} from '../../src/client/components/searchModel';
import type { Person } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';

const sy = (n: number) => n as StoredYear;

const person = (id: string, name: string): Person => ({
  id,
  name,
  birth: { year: sy(1500) },
  tags: [],
});

// 表示行順（rowIds）は persons の配列順とあえて変えて「行順が正」を検証する
const persons = [
  person('p_hideyoshi', '豊臣秀吉'),
  person('p_ieyasu', '徳川家康'),
  person('p_matsudaira', '松平家康'),
  person('p_kagemusha', '家康の影武者'),
];
const rowIds = ['p_ieyasu', 'p_matsudaira', 'p_kagemusha', 'p_hideyoshi'];

describe('applyQuery（クエリ確定: ヒット集合とカーソル初期化）', () => {
  it('ヒットは表示行順（rowIds の順）で返り、カーソルは先頭ヒットを指す', () => {
    const state = applyQuery(rowIds, persons, '家康');
    expect(state.hits).toEqual(['p_ieyasu', 'p_matsudaira', 'p_kagemusha']);
    expect(state.cursor).toBe(0);
    expect(currentHit(state)).toBe('p_ieyasu');
    expect(hitCountLabel(state)).toBe('1/3件');
    expect(isNoHit(state)).toBe(false);
  });

  it('部分一致で照合する（「秀吉」→ 豊臣秀吉）', () => {
    const state = applyQuery(rowIds, persons, '秀吉');
    expect(state.hits).toEqual(['p_hideyoshi']);
    expect(hitCountLabel(state)).toBe('1/1件');
  });

  it('空クエリは未検索扱い（ヒットなし・ラベルなし・「該当なし」も出さない）', () => {
    const state = applyQuery(rowIds, persons, '');
    expect(state.hits).toEqual([]);
    expect(currentHit(state)).toBeNull();
    expect(hitCountLabel(state)).toBeNull();
    expect(isNoHit(state)).toBe(false);
  });

  it('空白のみ（半角・全角）のクエリも未検索扱い（「該当なし」を出さない）', () => {
    for (const query of ['   ', '　　']) {
      const state = applyQuery(rowIds, persons, query);
      expect(state.hits).toEqual([]);
      expect(isNoHit(state)).toBe(false);
    }
  });

  it('一致なしは「該当なし」（isNoHit true・ラベルなし・スクロール先なし）', () => {
    const state = applyQuery(rowIds, persons, '信長');
    expect(state.hits).toEqual([]);
    expect(isNoHit(state)).toBe(true);
    expect(hitCountLabel(state)).toBeNull();
    expect(currentHit(state)).toBeNull();
  });

  it('照合は NFKC 正規化 + 大小無視（searchPersons と同一規則。全角英字 → 半角小文字）', () => {
    const roman = [person('p_r', 'Tokugawa Ieyasu')];
    const state = applyQuery(['p_r'], roman, 'ＩＥＹＡＳＵ'); // ＩＥＹＡＳＵ
    expect(state.hits).toEqual(['p_r']);
  });

  it('emptySearchState は未検索状態（ラベル・該当なし・スクロール先すべてなし）', () => {
    expect(hitCountLabel(emptySearchState)).toBeNull();
    expect(isNoHit(emptySearchState)).toBe(false);
    expect(currentHit(emptySearchState)).toBeNull();
  });
});

describe('stepCursor（〔前へ/次へ〕の k/n 巡回）', () => {
  const base = applyQuery(rowIds, persons, '家康'); // 3件: ieyasu → matsudaira → kagemusha

  it('〔次へ〕で 1/3 → 2/3 → 3/3 と進み、末尾の次は先頭へ巡回する', () => {
    const s2 = stepCursor(base, 1);
    expect(hitCountLabel(s2)).toBe('2/3件');
    expect(currentHit(s2)).toBe('p_matsudaira');
    const s3 = stepCursor(s2, 1);
    expect(hitCountLabel(s3)).toBe('3/3件');
    expect(currentHit(s3)).toBe('p_kagemusha');
    const wrapped = stepCursor(s3, 1);
    expect(hitCountLabel(wrapped)).toBe('1/3件');
    expect(currentHit(wrapped)).toBe('p_ieyasu');
  });

  it('〔前へ〕は逆順に巡回する（先頭の前は末尾）', () => {
    const back = stepCursor(base, -1);
    expect(hitCountLabel(back)).toBe('3/3件');
    expect(currentHit(back)).toBe('p_kagemusha');
    expect(hitCountLabel(stepCursor(back, -1))).toBe('2/3件');
  });

  it('ヒット1件では前へ/次へとも同じヒットを指し続ける（1/1件のまま）', () => {
    const one = applyQuery(rowIds, persons, '秀吉');
    expect(currentHit(stepCursor(one, 1))).toBe('p_hideyoshi');
    expect(currentHit(stepCursor(one, -1))).toBe('p_hideyoshi');
    expect(hitCountLabel(stepCursor(one, 1))).toBe('1/1件');
  });

  it('ヒット0件では状態を変えない（クエリ・カーソルとも不変）', () => {
    const none = applyQuery(rowIds, persons, '信長');
    expect(stepCursor(none, 1)).toBe(none);
    expect(stepCursor(none, -1)).toBe(none);
  });
});

describe('refreshHits（データ・並び順の変化への追従）', () => {
  const base = applyQuery(rowIds, persons, '家康');

  it('カーソルが指す人物が残っていれば、前方のヒットが消えても同じ人物を指し続ける', () => {
    const at2 = stepCursor(base, 1); // p_matsudaira（2/3件）
    // 先頭ヒット（p_ieyasu）が改名でヒットから外れる
    const renamed = persons.map((p) => (p.id === 'p_ieyasu' ? { ...p, name: '東照大権現' } : p));
    const refreshed = refreshHits(at2, rowIds, renamed);
    expect(refreshed.hits).toEqual(['p_matsudaira', 'p_kagemusha']);
    expect(currentHit(refreshed)).toBe('p_matsudaira');
    expect(hitCountLabel(refreshed)).toBe('1/2件');
  });

  it('カーソルが指す人物が消えたら先頭ヒットへ戻る', () => {
    const at2 = stepCursor(base, 1); // p_matsudaira
    const removedIds = rowIds.filter((id) => id !== 'p_matsudaira');
    const removed = persons.filter((p) => p.id !== 'p_matsudaira');
    const refreshed = refreshHits(at2, removedIds, removed);
    expect(refreshed.hits).toEqual(['p_ieyasu', 'p_kagemusha']);
    expect(currentHit(refreshed)).toBe('p_ieyasu');
    expect(hitCountLabel(refreshed)).toBe('1/2件');
  });

  it('並び順の変化にはヒットの順序が追従する（クエリは維持）', () => {
    const reordered = ['p_kagemusha', 'p_hideyoshi', 'p_matsudaira', 'p_ieyasu'];
    const refreshed = refreshHits(base, reordered, persons);
    expect(refreshed.query).toBe('家康');
    expect(refreshed.hits).toEqual(['p_kagemusha', 'p_matsudaira', 'p_ieyasu']);
  });

  it('全ヒットが消えたら「該当なし」状態になる（クエリは残る）', () => {
    const others = [person('p_a', '織田信長')];
    const refreshed = refreshHits(base, ['p_a'], others);
    expect(refreshed.hits).toEqual([]);
    expect(refreshed.query).toBe('家康');
    expect(isNoHit(refreshed)).toBe(true);
    expect(currentHit(refreshed)).toBeNull();
  });
});

describe('定数', () => {
  it('検索デバウンスは 150ms（ui-timeline-grid.md 6章）', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
  });
});
