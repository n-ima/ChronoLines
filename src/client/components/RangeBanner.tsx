// 「範囲内に該当なし」の情報バナー（TASK-112 / ui-timeline-grid.md 7章 /
// screen-01 .banner.info）。指定範囲に生存期間もイベントも重ならない場合、グリッドは
// 空欄のまま描画しつつ上部全幅にこのバナーを出す（エラーにしない = role は status）
import type { Timeline } from '../../domain/schema';
import type { StoredYear } from '../../domain/year';
import styles from './RangeBanner.module.css';
import { hasNoMatchInRange, noMatchBannerText } from './rangeModel';

export function RangeBanner({
  timeline,
  currentYear,
}: {
  timeline: Timeline;
  currentYear: StoredYear;
}) {
  if (!hasNoMatchInRange(timeline, currentYear)) {
    return null;
  }
  return (
    <div className={styles.banner} role="status" data-testid="range-banner">
      {noMatchBannerText(timeline, currentYear)}
    </div>
  );
}
