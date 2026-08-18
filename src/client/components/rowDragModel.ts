// 行ドラッグ&ドロップの純粋ロジック（TASK-111 / ui-timeline-grid.md 6章 / US-008）。
// 行高は固定（CELL_H）なので、ドロップ位置はポインタのオフセット/行高の算術だけで決まる
// （設計の明示要求。DOM 計測やヒットテストはしない）。外部D&Dライブラリは使わず、
// Pointer Events への配線は TimelineGrid が担い、本モジュールは React・DOM から独立させて
// 単体テスト可能にする（timelineGridModel と同じ流儀）。

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ポインタの本体領域内 Y オフセット → 挿入ギャップ（行と行の間。0 = 先頭の前、
// rowCount = 末尾の後）。行の中央を跨いだら次のギャップへ切り替わる（round）。
// 領域外（負・全行より下）はドラッグを継続したまま端のギャップへクランプする
export function gapFromOffset(offsetY: number, rowCount: number, rowHeight: number): number {
  if (rowCount <= 0) {
    return 0;
  }
  return clamp(Math.round(offsetY / rowHeight), 0, rowCount);
}

// ドロップの確定: 挿入ギャップ → reorderPerson(personId, toIndex) に渡す toIndex。
// toIndex は「全体順（手動順）から自分を除いた列」への挿入位置（appStore.reorderPerson の
// 契約と同一）。並びが変わらないドロップ（同位置・自分しか可視でない等）は null = no-op
// （無変更の reorderPerson で自動保存のデバウンスを起こさないため。Toolbar のズームと同じ規則）。
//
// タグ絞り込み中は可視行が全体順の部分列になるため、「可視行の中での挿入位置」を
// 「全体順の中での挿入位置」へ写像する: ギャップ直後に見えている行の直前
// （可視の末尾より下なら、可視の最終行の直後）に入れる。絞り込みなしのときは
// 可視行 = 全体順なので、この写像は恒等になる
export function planReorder(
  personId: string,
  gap: number,
  visibleIds: readonly string[],
  fullOrderIds: readonly string[],
): number | null {
  const sourceVisible = visibleIds.indexOf(personId);
  const sourceFull = fullOrderIds.indexOf(personId);
  if (sourceVisible === -1 || sourceFull === -1) {
    return null; // ドラッグ中にデータ変化で行が消えた等。確定せず捨てる
  }
  const visibleRest = visibleIds.filter((id) => id !== personId);
  if (visibleRest.length === 0) {
    return null; // 自分しか見えていない → 並び替えの意味を持たない
  }
  // ギャップ（自分を含む可視行基準）→ 可視行から自分を除いた列での挿入位置
  const clampedGap = clamp(Math.trunc(gap), 0, visibleIds.length);
  const insertVisible = clampedGap <= sourceVisible ? clampedGap : clampedGap - 1;
  if (insertVisible === sourceVisible) {
    // 可視の並びが変わらないドロップ（自分の位置の直前後のギャップ）= no-op。
    // 絞り込み中に「見た目は不変なのに隠れた行との相対順だけが動く」ことも起こさない
    return null;
  }
  const fullRest = fullOrderIds.filter((id) => id !== personId);
  const anchor = visibleRest[insertVisible];
  return anchor !== undefined
    ? fullRest.indexOf(anchor) // その行の直前へ
    : fullRest.indexOf(visibleRest[visibleRest.length - 1] as string) + 1; // 可視の最終行の直後へ
}
