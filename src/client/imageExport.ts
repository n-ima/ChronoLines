// 画像出力の DOM キャプチャ本体（TASK-204 / US-012 / ui-timeline-grid.md 8章）。
// html-to-image の toPng をグリッドコンテナへ適用する。仮想化で実際に描画されている
// DOM をそのまま撮る = 可視範囲のみが対象（ADR 0003「画面に見えているものが正」と整合）。
//
// なぜライブの要素を直接 toPng しないか: html-to-image のクローンにはスクロール位置と
// position:sticky の追従が引き継がれないため、スクロール中に撮ると年ヘッダー・人物列が
// 欠けた画像になる。そこで (1) スクロールコンテナを画面外に複製し、(2) 内容全体を
// translate(-scrollLeft, -scrollTop) で可視域へ寄せ、(3) sticky 要素（CAPTURE_STICKY_ATTR）を
// 見えていた位置へ寄せ直してから撮る。ライブ DOM には一切触れない
// （キャプチャ中のちらつき・アプリ状態の破壊を起こさない）。
import { toPng } from 'html-to-image';

import {
  CAPTURE_CONTENT_ATTR,
  CAPTURE_ROOT_ATTR,
  CAPTURE_STICKY_ATTR,
  stickyTransform,
} from './imageExportModel';

// 表示中のグリッド（root = CAPTURE_ROOT_ATTR の要素）の可視範囲を PNG の data URL にする
export async function captureGridPng(root: HTMLElement): Promise<string> {
  const { scrollLeft, scrollTop, clientWidth, clientHeight } = root;
  if (clientWidth === 0 || clientHeight === 0) {
    throw new Error('グリッドの可視領域がありません');
  }

  const clone = root.cloneNode(true) as HTMLElement;
  // 検証や再キャプチャの属性検索がライブ側と取り違えないよう、識別属性はクローンから外す
  clone.removeAttribute(CAPTURE_ROOT_ATTR);
  clone.removeAttribute('data-testid');
  // 可視ビューポートと同寸に固定（clientWidth/Height はスクロールバーを含まない）
  clone.style.width = `${clientWidth}px`;
  clone.style.height = `${clientHeight}px`;
  clone.style.overflow = 'hidden';

  const content = clone.querySelector(`[${CAPTURE_CONTENT_ATTR}]`);
  if (!(content instanceof HTMLElement)) {
    throw new Error('グリッドの内容要素が見つかりません');
  }
  content.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
  for (const el of clone.querySelectorAll(`[${CAPTURE_STICKY_ATTR}]`)) {
    if (el instanceof HTMLElement) {
      const transform = stickyTransform(
        el.getAttribute(CAPTURE_STICKY_ATTR),
        scrollLeft,
        scrollTop,
      );
      if (transform !== null) {
        el.style.transform = transform;
      }
    }
  }

  // 画面外（左 -100000px）に実体化してから撮る。document 内に無いと computed style が
  // 解決されず、html-to-image が空の画像を生成するため
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.position = 'fixed';
  holder.style.left = '-100000px';
  holder.style.top = '0';
  holder.style.width = `${clientWidth}px`;
  holder.style.height = `${clientHeight}px`;
  holder.style.overflow = 'hidden';
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    return await toPng(clone, { width: clientWidth, height: clientHeight });
  } finally {
    holder.remove();
  }
}

// toPng の data URL をアンカークリックでダウンロードさせる（exportDownload.downloadJson と
// 同じ流儀。PNG は data URL のまま href に渡せるため Blob 化しない）
export function downloadDataUrl(fileName: string, dataUrl: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.click();
}
