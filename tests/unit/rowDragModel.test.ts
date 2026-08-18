// 行ドラッグ&ドロップの純粋ロジック（rowDragModel.ts）の単体テスト（TASK-111 /
// ui-timeline-grid.md 6章 / US-008）。ドロップ位置の算出（オフセット/行高 → 挿入ギャップ）と
// 並び替えの適用計画（ギャップ → reorderPerson の toIndex。絞り込み中の写像・no-op 判定）を
// 検証する。reorderPerson 自体（personOrder の更新・manual への切替）の正は appStore.test.ts。
import { describe, expect, it } from 'vitest';

import { gapFromOffset, planReorder } from '../../src/client/components/rowDragModel';

// 行高は実装と同じ 28px（timelineGridModel.CELL_H / --cell-h）で検算する
const ROW_H = 28;

// reorderPerson(id, toIndex) と同じ適用規則（自分を除いた列の toIndex へ挿入。
// appStore の実装と同一のクランプ）で最終順を再現し、計画との契約を検算する
function applyReorder(order: readonly string[], id: string, toIndex: number): string[] {
  const rest = order.filter((x) => x !== id);
  const insertAt = Math.max(0, Math.min(Math.trunc(toIndex), rest.length));
  return [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)];
}

describe('gapFromOffset（ポインタのオフセット → 挿入ギャップ）', () => {
  it('行の上半分はその行の前のギャップ、下半分は次のギャップ（中央で切り替え）', () => {
    // 行1（y=28〜56）の上半分 → ギャップ1、下半分 → ギャップ2
    expect(gapFromOffset(ROW_H + 13, 5, ROW_H)).toBe(1);
    expect(gapFromOffset(ROW_H + 15, 5, ROW_H)).toBe(2);
  });

  it('先頭行の上端（オフセット0）はギャップ0', () => {
    expect(gapFromOffset(0, 5, ROW_H)).toBe(0);
  });

  it('本体領域より上（負のオフセット）は先頭のギャップ0へクランプ', () => {
    expect(gapFromOffset(-100, 5, ROW_H)).toBe(0);
  });

  it('最終行より下は末尾のギャップ（= 行数）へクランプ', () => {
    expect(gapFromOffset(5 * ROW_H + 500, 5, ROW_H)).toBe(5);
  });

  it('行0件のときは常にギャップ0', () => {
    expect(gapFromOffset(100, 0, ROW_H)).toBe(0);
  });
});

describe('planReorder（絞り込みなし: 可視行 = 全体順）', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('末尾のギャップへのドロップで最後尾へ移動する', () => {
    const toIndex = planReorder('b', 4, order, order);
    expect(toIndex).toBe(3);
    expect(applyReorder(order, 'b', 3)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('先頭のギャップへのドロップで先頭へ移動する', () => {
    const toIndex = planReorder('c', 0, order, order);
    expect(toIndex).toBe(0);
    expect(applyReorder(order, 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('1つ下の行の下側ギャップへのドロップで隣と入れ替わる', () => {
    // b（index 1）をギャップ3（cの下）へ → a, c, b, d
    const toIndex = planReorder('b', 3, order, order);
    expect(toIndex).toBe(2);
    expect(applyReorder(order, 'b', 2)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('自分の位置の直前のギャップへのドロップは並び不変 = null（no-op）', () => {
    expect(planReorder('b', 1, order, order)).toBeNull();
  });

  it('自分の位置の直後のギャップへのドロップも並び不変 = null（no-op）', () => {
    expect(planReorder('b', 2, order, order)).toBeNull();
  });

  it('範囲外のギャップは端へクランプされる（負 → 先頭、行数超 → 末尾）', () => {
    expect(planReorder('c', -5, order, order)).toBe(0);
    expect(planReorder('b', 99, order, order)).toBe(3);
  });
});

describe('planReorder（タグ絞り込み中: 可視行が全体順の部分列）', () => {
  // 全体順（手動順）: a, b, c, d, e のうち b, d だけが可視
  const full = ['a', 'b', 'c', 'd', 'e'];
  const visible = ['b', 'd'];

  it('可視の前の行の上へのドロップは「その行の直前」へ写像される', () => {
    // d をギャップ0（b の上）へ → 全体では b の直前 = [a, d, b, c, e]
    const toIndex = planReorder('d', 0, visible, full);
    expect(toIndex).toBe(1);
    expect(applyReorder(full, 'd', 1)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('可視の末尾より下へのドロップは「可視の最終行の直後」へ写像される（絶対末尾ではない）', () => {
    // b をギャップ2（d の下）へ → 全体では d の直後 = [a, c, d, b, e]（e より前に留まる）
    const toIndex = planReorder('b', 2, visible, full);
    expect(toIndex).toBe(3);
    expect(applyReorder(full, 'b', 3)).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('可視の並びが変わらないドロップは null（隠れた行との相対順だけを動かさない）', () => {
    // b（可視 index 0）をギャップ1（b と d の間）へ = 可視の並びは b, d のまま
    expect(planReorder('b', 1, visible, full)).toBeNull();
    expect(planReorder('d', 1, visible, full)).toBeNull();
    expect(planReorder('d', 2, visible, full)).toBeNull();
  });

  it('可視行が自分だけのときは null（並び替えの意味を持たない）', () => {
    expect(planReorder('b', 0, ['b'], full)).toBeNull();
    expect(planReorder('b', 1, ['b'], full)).toBeNull();
  });
});

describe('planReorder（防御: ドラッグ中のデータ変化）', () => {
  it('対象が可視行から消えていたら null（確定せず捨てる）', () => {
    expect(planReorder('x', 0, ['a', 'b'], ['a', 'b', 'x'])).toBeNull();
  });

  it('対象が全体順から消えていたら null', () => {
    expect(planReorder('x', 0, ['x', 'a'], ['a', 'b'])).toBeNull();
  });
});

describe('gapFromOffset + planReorder の結合（オフセットからの一気通貫の検算）', () => {
  const order = ['p1', 'p2', 'p3', 'p4', 'p5'];

  it('行0の p1 を行3（y=3.5行分 = 行3の中央）へドラッグ → p2, p3, p4, p1, p5', () => {
    const gap = gapFromOffset(3.5 * ROW_H, order.length, ROW_H); // 行3の中央 → round(3.5)=4
    expect(gap).toBe(4);
    const toIndex = planReorder('p1', gap, order, order);
    expect(toIndex).toBe(3);
    expect(applyReorder(order, 'p1', 3)).toEqual(['p2', 'p3', 'p4', 'p1', 'p5']);
  });

  it('最終行の p5 をはるか上（負のオフセット）へドラッグ → 先頭へ', () => {
    const gap = gapFromOffset(-9999, order.length, ROW_H);
    const toIndex = planReorder('p5', gap, order, order);
    expect(toIndex).toBe(0);
    expect(applyReorder(order, 'p5', 0)).toEqual(['p5', 'p1', 'p2', 'p3', 'p4']);
  });

  it('その場（自分の行の上半分）で離す → null（reorderPerson を呼ばない）', () => {
    const gap = gapFromOffset(2 * ROW_H + 5, order.length, ROW_H); // 行2の上半分 → ギャップ2
    expect(gap).toBe(2);
    expect(planReorder('p3', gap, order, order)).toBeNull();
  });
});
