// 選択列まわりの純粋導出（selectionModel.ts）の単体テスト（TASK-107 /
// ui-timeline-grid.md 3〜4章 / US-003・US-004）。レーンのチップ集約・チップ配色・
// パネルの年齢比較リスト導出を検証する。セル値の検算表そのものは year.test.ts が正。
import { describe, expect, it } from 'vitest';

import {
  ageRows,
  ageRowText,
  chipColors,
  chipTooltip,
  eventDateLabel,
  eventsAtYear,
  laneColumn,
  MAX_LANE_CHIPS,
  panelYearLabel,
} from '../../src/client/components/selectionModel';
import { eventsByColumn } from '../../src/domain/query';
import type { Person, TimelineEvent } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';

const sy = (n: number) => n as StoredYear;

const event = (
  id: string,
  name: string,
  year: number,
  opts: { month?: number; day?: number; note?: string; personId?: string; tags?: string[] } = {},
): TimelineEvent => ({
  id,
  name,
  year: sy(year),
  month: opts.month,
  day: opts.day,
  note: opts.note,
  personId: opts.personId,
  tags: opts.tags ?? [],
});

const person = (
  id: string,
  name: string,
  birthYear: number,
  deathYear?: number,
): Person => ({
  id,
  name,
  birth: { year: sy(birthYear) },
  death: deathYear === undefined ? undefined : { year: sy(deathYear) },
  tags: [],
});

const CUR = sy(2026);

describe('laneColumn（列ごと最大2チップ + +N バッジの集約。ui-timeline-grid.md 3章）', () => {
  it('イベントなし（undefined）は チップ0・バッジなし', () => {
    expect(laneColumn(undefined)).toEqual({ chips: [], moreCount: 0 });
  });

  it('2件以下は全件チップ・バッジなし', () => {
    const one = [event('e1', 'a', 1600)];
    expect(laneColumn(one).chips).toHaveLength(1);
    expect(laneColumn(one).moreCount).toBe(0);
    const two = [event('e1', 'a', 1600), event('e2', 'b', 1600)];
    expect(laneColumn(two).chips).toHaveLength(2);
    expect(laneColumn(two).moreCount).toBe(0);
  });

  it('3件以上は先頭2件のみチップ + 残り件数のバッジ', () => {
    const three = [event('e1', 'a', 1600), event('e2', 'b', 1600), event('e3', 'c', 1600)];
    const lane = laneColumn(three);
    expect(lane.chips.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(lane.moreCount).toBe(1);
  });

  it('1年に100件（保証範囲）は チップ2 + 「+98」（US-003 受け入れ条件の要約側）', () => {
    const many = Array.from({ length: 100 }, (_, i) => event(`e${i}`, `イベント${i}`, 1600));
    const lane = laneColumn(many);
    expect(lane.chips).toHaveLength(MAX_LANE_CHIPS);
    expect(lane.moreCount).toBe(98);
  });

  it('eventsByColumn の列内ソート（月日→名前順）の先頭からチップにする', () => {
    const columns = eventsByColumn(
      [
        event('e_later', '大坂の陣', 1600, { month: 11 }),
        event('e_first', '関ヶ原の戦い', 1600, { month: 9, day: 15 }),
        event('e_mid', '会津征伐', 1600, { month: 9, day: 20 }),
      ],
      'year',
    );
    const lane = laneColumn(columns.get(1600));
    expect(lane.chips.map((e) => e.id)).toEqual(['e_first', 'e_mid']);
    expect(lane.moreCount).toBe(1);
  });
});

describe('chipColors / chipTooltip（タグ配色 / 既定アンバー。design-tokens.md）', () => {
  it('タグなしは既定のアンバー（--color-chip-bg/-text）', () => {
    expect(chipColors(event('e1', '関ヶ原の戦い', 1600))).toEqual({
      background: 'var(--color-chip-bg)',
      color: 'var(--color-chip-text)',
    });
  });

  it('タグありは先頭タグのタグ配色（「合戦」= (21512+25126) % 8 = 6）', () => {
    expect(chipColors(event('e1', '関ヶ原の戦い', 1600, { tags: ['合戦', '政治'] }))).toEqual({
      background: 'var(--tag-6-bg)',
      color: 'var(--tag-6-text)',
    });
  });

  it('ツールチップはタグ列挙つき・タグなしは名前のみ（screen-01 の title）', () => {
    expect(chipTooltip(event('e1', '関ヶ原の戦い', 1600, { tags: ['合戦', '天下分け目'] }))).toBe(
      '関ヶ原の戦い（合戦、天下分け目）',
    );
    expect(chipTooltip(event('e2', '会津征伐', 1600))).toBe('会津征伐');
  });
});

describe('panelYearLabel / eventDateLabel（パネルの見出しとイベント行の月日）', () => {
  it('見出しは「1600年」・紀元前は「前100年」（formatYear と同じ表記）', () => {
    expect(panelYearLabel(sy(1600))).toBe('1600年');
    expect(panelYearLabel(sy(-100))).toBe('前100年');
  });

  it('月日は「9月15日」・月のみ「9月」・無指定は null（非表示）', () => {
    expect(eventDateLabel(event('e1', 'a', 1600, { month: 9, day: 15 }))).toBe('9月15日');
    expect(eventDateLabel(event('e2', 'b', 1600, { month: 9 }))).toBe('9月');
    expect(eventDateLabel(event('e3', 'c', 1600))).toBeNull();
  });
});

describe('eventsAtYear（選択列のイベント全件。列キー = astro 年）', () => {
  it('選択年のイベント全件を列内ソート順で返す', () => {
    const columns = eventsByColumn(
      [event('e2', 'b', 1600, { month: 10 }), event('e1', 'a', 1600, { month: 9 })],
      'year',
    );
    expect(eventsAtYear(columns, sy(1600)).map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('紀元前の年も正しく引ける（前100 = astro -99 のキー変換を隠蔽。ADR 0004）', () => {
    const columns = eventsByColumn([event('e1', 'カエサル誕生', -100)], 'year');
    expect(eventsAtYear(columns, sy(-100)).map((e) => e.id)).toEqual(['e1']);
  });

  it('イベントのない年は空配列（パネルは「この年のイベントはありません」表示）', () => {
    const columns = eventsByColumn([event('e1', 'a', 1600)], 'year');
    expect(eventsAtYear(columns, sy(1601))).toEqual([]);
  });
});

describe('ageRows / ageRowText（年齢比較リスト。US-004 = コアバリュー）', () => {
  const ieyasu = person('p_ieyasu', '徳川家康', 1543, 1616);
  const masamune = person('p_masamune', '伊達政宗', 1567, 1636);

  it('成功指標シナリオ: 1600年で家康57・政宗33 が行順どおり並ぶ', () => {
    const rows = ageRows([ieyasu, masamune], sy(1600), CUR);
    expect(rows.map((r) => r.person.name)).toEqual(['徳川家康', '伊達政宗']);
    expect(rows[0]?.value).toEqual({ kind: 'alive', age: 57 });
    expect(rows[1]?.value).toEqual({ kind: 'alive', age: 33 });
  });

  it('没後の人物は virtual（セルと同じ cellValue 判定 = 同じ色書式の根拠）', () => {
    const nobunaga = person('p_nobunaga', '織田信長', 1534, 1582);
    const rows = ageRows([nobunaga], sy(1600), CUR);
    expect(rows[0]?.value).toEqual({ kind: 'virtual', age: 66 });
  });

  it('生前は blank・没年ちょうどは alive（境界はセルと同一）', () => {
    const rows1600 = ageRows([person('p_musashi', '宮本武蔵', 1584, 1645)], sy(1550), CUR);
    expect(rows1600[0]?.value).toEqual({ kind: 'blank' });
    const atDeath = ageRows([ieyasu], sy(1616), CUR);
    expect(atDeath[0]?.value).toEqual({ kind: 'alive', age: 73 });
  });

  it('入力の行順（グリッドの表示順）を並べ替えない', () => {
    const rows = ageRows([masamune, ieyasu], sy(1600), CUR);
    expect(rows.map((r) => r.person.id)).toEqual(['p_masamune', 'p_ieyasu']);
  });

  it('表示文字列: alive=数値・virtual=括弧付き・blank=「—（生前）」（screen-01 renderPanel）', () => {
    expect(ageRowText({ kind: 'alive', age: 57 })).toBe('57');
    expect(ageRowText({ kind: 'virtual', age: 63 })).toBe('(63)');
    expect(ageRowText({ kind: 'blank' })).toBe('—（生前）');
  });
});
