// タグ絞り込みの状態モデル（tagFilterModel.ts）の単体テスト（TASK-110 /
// ui-timeline-grid.md 6章 / US-008）。選択集合（選択順・トグル・個別解除・データ追従）・
// 件数表示（人物n・イベントm）・適用結果（行とイベントレーンの OR 条件・選択0個=全件）を
// 検証する。OR照合そのものの検算の正は query.test.ts（filterByTags / filterEventsByTags）。
import { describe, expect, it } from 'vitest';

import {
  removeTag,
  retainKnownTags,
  tagButtonLabel,
  tagFilterOptions,
  toggleTag,
  visibleEvents,
  visibleRowIds,
} from '../../src/client/components/tagFilterModel';
import type { Person, Timeline, TimelineEvent } from '../../src/domain/schema';
import type { StoredYear } from '../../src/domain/year';

const sy = (n: number) => n as StoredYear;

const person = (id: string, name: string, birthYear: number, tags: string[]): Person => ({
  id,
  name,
  birth: { year: sy(birthYear) },
  tags,
});

const event = (id: string, name: string, year: number, tags: string[]): TimelineEvent => ({
  id,
  name,
  year: sy(year),
  tags,
});

const timeline = (persons: Person[], events: TimelineEvent[]): Timeline => ({
  id: 'tl_1',
  name: '戦国',
  persons,
  events,
  sortMode: 'birthAsc',
  personOrder: [],
  view: { startYear: null, endYear: null, zoom: 'year' },
});

// 生年順ソート（p_shingen 1521 → p_nobunaga 1534 → p_ieyasu 1543 → p_musashi 1584）と
// あえて逆順で定義し「表示行 = ソート後 → 絞り込み」の順序を検証する
const persons = [
  person('p_musashi', '宮本武蔵', 1584, ['剣豪']),
  person('p_ieyasu', '徳川家康', 1543, ['戦国', '天下人']),
  person('p_nobunaga', '織田信長', 1534, ['戦国', '天下人']),
  person('p_shingen', '武田信玄', 1521, ['戦国', '大名']),
  person('p_anon', '無名の人物', 1600, []),
];
const events = [
  event('e_sekigahara', '関ヶ原の戦い', 1600, ['合戦']),
  event('e_osaka', '大坂夏の陣', 1615, ['合戦']),
  event('e_edo', '江戸幕府開府', 1603, ['政治']),
  event('e_plain', 'タグなしの出来事', 1610, []),
];
const tl = timeline(persons, events);

describe('tagFilterOptions（ドロップダウン候補: allTags 順 + 件数）', () => {
  it('候補は allTags の出現順（人物 → イベント、各 tags 内は定義順）で並ぶ', () => {
    expect(tagFilterOptions(tl).map((o) => o.tag)).toEqual([
      '剣豪',
      '戦国',
      '天下人',
      '大名',
      '合戦',
      '政治',
    ]);
  });

  it('件数は絞り込み前の全件に対する「人物n・イベントm」', () => {
    const byTag = new Map(tagFilterOptions(tl).map((o) => [o.tag, o]));
    expect(byTag.get('戦国')).toEqual({ tag: '戦国', personCount: 3, eventCount: 0 });
    expect(byTag.get('剣豪')).toEqual({ tag: '剣豪', personCount: 1, eventCount: 0 });
    expect(byTag.get('合戦')).toEqual({ tag: '合戦', personCount: 0, eventCount: 2 });
    expect(byTag.get('政治')).toEqual({ tag: '政治', personCount: 0, eventCount: 1 });
  });

  it('人物・イベントの両方に付くタグは両方の件数を持つ', () => {
    const mixed = timeline(
      [person('p_1', '甲', 1500, ['戦国'])],
      [event('e_1', '乙', 1550, ['戦国'])],
    );
    expect(tagFilterOptions(mixed)).toEqual([{ tag: '戦国', personCount: 1, eventCount: 1 }]);
  });

  it('タグが1つも無い年表では候補は空', () => {
    const empty = timeline([person('p_1', '甲', 1500, [])], [event('e_1', '乙', 1550, [])]);
    expect(tagFilterOptions(empty)).toEqual([]);
  });
});

describe('toggleTag / removeTag（選択集合の操作。ピルは選択順）', () => {
  it('未選択のタグは末尾へ追加される（選択順を保持する）', () => {
    expect(toggleTag([], '戦国')).toEqual(['戦国']);
    expect(toggleTag(['戦国'], '剣豪')).toEqual(['戦国', '剣豪']);
  });

  it('選択済みのタグは外れる（2回のトグルで元に戻る）', () => {
    expect(toggleTag(['戦国', '剣豪'], '戦国')).toEqual(['剣豪']);
    expect(toggleTag(toggleTag(['戦国'], '剣豪'), '剣豪')).toEqual(['戦国']);
  });

  it('removeTag は指定タグだけ外す（ピルの✕。未選択タグの指定は無変化）', () => {
    expect(removeTag(['戦国', '剣豪', '合戦'], '剣豪')).toEqual(['戦国', '合戦']);
    expect(removeTag(['戦国'], '政治')).toEqual(['戦国']);
  });
});

describe('retainKnownTags（データ変化への追従: 消えたタグは選択から外す）', () => {
  it('年表に存在しなくなったタグを選択から外す', () => {
    expect(retainKnownTags(['戦国', '南北朝'], tl)).toEqual(['戦国']);
  });

  it('全タグ健在なら同一参照を返す（setState の no-op 判定）', () => {
    const selected = ['戦国', '合戦'];
    expect(retainKnownTags(selected, tl)).toBe(selected);
  });
});

describe('tagButtonLabel（〔タグ▼〕の選択数表示）', () => {
  it('未選択は「タグ ▼」、選択中は「タグ（n） ▼」', () => {
    expect(tagButtonLabel([])).toBe('タグ ▼');
    expect(tagButtonLabel(['戦国'])).toBe('タグ（1） ▼');
    expect(tagButtonLabel(['戦国', '剣豪'])).toBe('タグ（2） ▼');
  });
});

describe('visibleRowIds（行への適用: sort → tagFilter）', () => {
  it('選択0個 = 全件（生年順の表示行がそのまま返る）', () => {
    expect(visibleRowIds(tl, [])).toEqual([
      'p_shingen',
      'p_nobunaga',
      'p_ieyasu',
      'p_musashi',
      'p_anon',
    ]);
  });

  it('1タグ選択でそのタグを持つ人物だけ残る（行順は生年順のまま）', () => {
    expect(visibleRowIds(tl, ['戦国'])).toEqual(['p_shingen', 'p_nobunaga', 'p_ieyasu']);
  });

  it('2タグ選択は OR 条件（和集合。重複なし）', () => {
    expect(visibleRowIds(tl, ['戦国', '剣豪'])).toEqual([
      'p_shingen',
      'p_nobunaga',
      'p_ieyasu',
      'p_musashi',
    ]);
  });

  it('複数タグに一致する人物も1行のまま（重複しない）', () => {
    expect(visibleRowIds(tl, ['戦国', '天下人'])).toEqual([
      'p_shingen',
      'p_nobunaga',
      'p_ieyasu',
    ]);
  });

  it('絞り込み中はタグなしの人物は表示されない', () => {
    expect(visibleRowIds(tl, ['戦国'])).not.toContain('p_anon');
  });

  it('誰も持たないタグの選択は0行', () => {
    expect(visibleRowIds(tl, ['南北朝'])).toEqual([]);
  });
});

describe('visibleEvents（イベントレーンへの適用: 人物と対称の OR 条件）', () => {
  it('選択0個 = 全件', () => {
    expect(visibleEvents(tl.events, []).map((e) => e.id)).toEqual([
      'e_sekigahara',
      'e_osaka',
      'e_edo',
      'e_plain',
    ]);
  });

  it('選択タグのいずれかを持つイベントだけ残る（タグなしイベントも非表示）', () => {
    expect(visibleEvents(tl.events, ['合戦']).map((e) => e.id)).toEqual([
      'e_sekigahara',
      'e_osaka',
    ]);
    expect(visibleEvents(tl.events, ['合戦', '政治']).map((e) => e.id)).toEqual([
      'e_sekigahara',
      'e_osaka',
      'e_edo',
    ]);
  });

  it('人物にしか付いていないタグの選択ではイベントは0件（行とレーンに同じ選択を適用）', () => {
    expect(visibleEvents(tl.events, ['戦国'])).toEqual([]);
    // 同じ選択で行側は3人（両方に同時適用しても互いを妨げない）
    expect(visibleRowIds(tl, ['戦国'])).toHaveLength(3);
  });
});
