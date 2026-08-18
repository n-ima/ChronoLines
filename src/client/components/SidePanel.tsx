// 選択列のイベント・年齢比較サイドパネル（US-004 = コアバリュー / ui-timeline-grid.md 4章 /
// screen-01 .side-panel）。内容は上から (1) 年見出し + ✕ (2) イベント全件リスト
// （行クリックで展開してメモ全文 + 編集/削除） (3) 年齢比較リスト（グリッドの行順・
// セルと同じ色書式・行クリックでその人物の行へスクロール）。
// 1年に最大100件（保証範囲）でもパネル全体のスクロールで全件に到達できる（screen-01 と同じ
// overflow: auto。件数の要約 = レーンの +N バッジ、展開手段 = このパネル）。
// 導出ロジックは selectionModel.ts（単体テスト対象）。編集・削除はダイアログを持つ
// AppShell 側のコールバックへ委譲する。
import { useState, type KeyboardEvent, type MouseEvent } from 'react';

import type { Person, TimelineEvent } from '../../domain/schema';
import { formatYear, type StoredYear } from '../../domain/year';
import { tagDotColor, tagPillColors } from '../tagColor';
import controls from './controls.module.css';
import {
  ageRows,
  ageRowText,
  decadeAgeRows,
  eventDateLabel,
  groupEventsByYear,
  panelColumnLabel,
} from './selectionModel';
import styles from './SidePanel.module.css';
import type { ZoomLevel } from './timelineGridModel';

// div をクリック可能にする行（イベント行・年齢行）の共通キーボード対応
function activateOnEnterOrSpace(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };
}

function EventRow({
  event,
  personName,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  event: TimelineEvent;
  // 個人イベントの人物名（personId から引き当て済み。undefined = 世の中の出来事）
  personName: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dateLabel = eventDateLabel(event);
  // 展開中はメモ全文を出すため、メモ有無アイコン（📝）は畳んでいる間だけ表示する
  const showNoteIcon = event.note !== undefined && event.note !== '' && !expanded;
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div
      className={styles.event}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      data-event-id={event.id}
      onClick={onToggle}
      onKeyDown={activateOnEnterOrSpace(onToggle)}
    >
      {event.name}
      <div className={styles.meta}>
        {dateLabel !== null && <span>{dateLabel}</span>}
        {personName !== undefined && <span className={styles.pBadge}>👤 {personName}</span>}
        {event.tags.map((tag) => (
          <span key={tag} className={styles.tagPill} style={tagPillColors(tag)}>
            <span className={styles.tagDot} style={{ background: tagDotColor(tag) }} />
            {tag}
          </span>
        ))}
        {showNoteIcon && <span title="メモあり">📝</span>}
      </div>
      {expanded && (
        <>
          {event.note !== undefined && event.note !== '' && (
            <div className={styles.note}>{event.note}</div>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${controls.btn} ${styles.btnSmall}`}
              onClick={(e) => {
                stop(e);
                onEdit();
              }}
            >
              編集
            </button>
            <button
              type="button"
              className={`${controls.btn} ${styles.btnSmall} ${styles.btnDangerText}`}
              onClick={(e) => {
                stop(e);
                onDelete();
              }}
            >
              削除
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function SidePanel({
  zoom,
  year,
  events,
  persons,
  currentYear,
  onClose,
  onEditEvent,
  onDeleteEvent,
  onPersonClick,
}: {
  // 選択列のズーム。10年ズームでは見出しが範囲表記になり、イベントは年別グループ、
  // 年齢比較はセルと同じ集約判定（区間開始年時点）になる（ui-timeline-grid.md 4〜5章）
  zoom: ZoomLevel;
  // 選択列の年（10年ズームでは区間の開始年）
  year: StoredYear;
  // 選択列のイベント全件（eventsAtYear の結果。列内ソート済み）
  events: TimelineEvent[];
  // 現在表示中の人物（グリッドの行順。絞り込みは TASK-110 でこの入力に反映される）
  persons: Person[];
  currentYear: StoredYear;
  onClose: () => void;
  onEditEvent: (eventId: string) => void;
  onDeleteEvent: (eventId: string) => void;
  // 年齢比較行クリック → その人物の行へスクロール（TimelineGrid の scrollToIndex）
  onPersonClick: (personId: string) => void;
}) {
  // 展開中のイベント行（年の切り替え時は親が key で作り直すため自然にリセットされる）
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const personNameById = new Map(persons.map((p) => [p.id, p.name]));
  const isDecade = zoom === 'decade';
  const renderEventRow = (event: TimelineEvent) => (
    <EventRow
      key={event.id}
      event={event}
      personName={event.personId === undefined ? undefined : personNameById.get(event.personId)}
      expanded={expandedId === event.id}
      onToggle={() => setExpandedId((id) => (id === event.id ? null : event.id))}
      onEdit={() => onEditEvent(event.id)}
      onDelete={() => onDeleteEvent(event.id)}
    />
  );
  const rows = isDecade
    ? decadeAgeRows(persons, year, currentYear)
    : ageRows(persons, year, currentYear);

  return (
    <aside
      className={styles.panel}
      data-testid="side-panel"
      aria-label={panelColumnLabel(zoom, year)}
    >
      <div className={styles.head}>
        <h2 className={styles.title} data-testid="sp-year">
          {panelColumnLabel(zoom, year)}
        </h2>
        <button type="button" className={styles.close} aria-label="選択を解除" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className={styles.sec}>
        <h3 className={styles.secTitle}>イベント（{events.length}件）</h3>
        <div data-testid="sp-events">
          {events.length === 0 ? (
            <div className={styles.empty}>
              {isDecade ? 'この期間のイベントはありません' : 'この年のイベントはありません'}
            </div>
          ) : isDecade ? (
            // 10年区間の全件を年別グループで表示（ui-timeline-grid.md 5章）
            groupEventsByYear(events).map((group) => (
              <div key={group.year} data-testid="sp-year-group">
                <h4 className={styles.yearGroup}>{formatYear(group.year)}年</h4>
                {group.events.map(renderEventRow)}
              </div>
            ))
          ) : (
            events.map(renderEventRow)
          )}
        </div>
      </div>
      <div className={styles.sec}>
        <h3 className={styles.secTitle}>
          {isDecade ? 'この期間の年齢（区間開始年時点）' : 'この年の年齢（表示中の人物）'}
        </h3>
        <div data-testid="sp-ages">
          {rows.map(({ person, value }) => (
            <div
              key={person.id}
              className={styles.ageRow}
              role="button"
              tabIndex={0}
              data-person-id={person.id}
              data-kind={value.kind}
              onClick={() => onPersonClick(person.id)}
              onKeyDown={activateOnEnterOrSpace(() => onPersonClick(person.id))}
            >
              <span>{person.name}</span>
              <span
                className={
                  value.kind === 'alive'
                    ? styles.ageAlive
                    : value.kind === 'virtual'
                      ? styles.ageVirtual
                      : styles.ageBlank
                }
              >
                {ageRowText(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
