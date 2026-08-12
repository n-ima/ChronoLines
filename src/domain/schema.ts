// 保存データ（= エクスポートデータ）の唯一のスキーマ定義（data-model.md 2章）。
// クライアントのフォーム検証・インポート検証・サーバーの PUT 検証はすべてこの定義を使う。
// z.strictObject で未知フィールドを拒否する。
import { z } from 'zod';

import { compareStoredYears, type StoredYear } from './year';

export const CURRENT_SCHEMA_VERSION = 1;

// StoredYear: 西暦Y = Y、前N = -N。0 は存在しない年（US-005）
// 技術上限 ±99999: 「前1000年以前も登録を拒否しない」(A-002) を満たしつつ極端値の暴走を防ぐ。
// 末尾の transform は year.ts のブランド型 StoredYear を付与する恒等変換
// （Zod の .brand() は独自のブランド構造になり year.ts の StoredYear と非互換のため、
// 正であるドメイン側のブランドを境界 = パース時にここ1箇所で付ける）
export const yearSchema = z
  .number()
  .int()
  .refine((y) => y !== 0, { message: '0年は存在しません（前1年の翌年は西暦1年です）' })
  .refine((y) => Math.abs(y) <= 99999, { message: '年は±99999の範囲で入力してください' })
  .transform((y) => y as StoredYear);

const monthSchema = z.number().int().min(1).max(12);
const daySchema = z.number().int().min(1).max(31);

// 月日は参考情報（A-005: 年齢計算に使わない）。日は月がある場合のみ許可。
// 実在日チェック（2/30等）はしない
const dateFieldsSchema = z
  .strictObject({
    year: yearSchema,
    month: monthSchema.optional(),
    day: daySchema.optional(),
  })
  .refine((d) => d.day === undefined || d.month !== undefined, {
    message: '日を指定する場合は月も指定してください',
  });

const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(50).default([]);

export const personSchema = z
  .strictObject({
    id: z.string().min(1), // "p_" + crypto.randomUUID()
    name: z.string().trim().min(1, '名前は必須です').max(100),
    birth: dateFieldsSchema, // 必須（年のみ可）
    death: dateFieldsSchema.optional(), // 任意
    tags: tagsSchema,
  })
  .refine(
    (p) => p.death === undefined || compareStoredYears(p.death.year, p.birth.year) >= 0,
    { message: '没年は生年以降にしてください' }, // 同年没(0歳)は許可
  );

export const timelineEventSchema = z
  .strictObject({
    id: z.string().min(1), // "e_" + crypto.randomUUID()
    name: z.string().trim().min(1, 'イベント名は必須です').max(100),
    year: yearSchema, // 必須
    month: monthSchema.optional(),
    day: daySchema.optional(),
    note: z.string().max(2000).optional(),
    personId: z.string().optional(), // 任意 = 個人イベント（US-003）
    tags: tagsSchema, // 2026-08-12差分: イベントにもタグ
  })
  .refine((e) => e.day === undefined || e.month !== undefined, {
    message: '日を指定する場合は月も指定してください',
  });

export const timelineSchema = z.strictObject({
  id: z.string().min(1), // "tl_" + crypto.randomUUID()
  name: z.string().trim().min(1, '年表名は必須です').max(50),
  persons: z.array(personSchema),
  events: z.array(timelineEventSchema),
  sortMode: z.enum(['birthAsc', 'manual']), // US-008
  personOrder: z.array(z.string()), // manual時の行順（person id の列）
  view: z.strictObject({
    startYear: yearSchema.nullable(), // null = 自動（US-006）
    endYear: yearSchema.nullable(),
    zoom: z.enum(['year', 'decade']), // US-007
  }),
});

// 参照整合性（data-model.md 2章の5規則）。メッセージはエラーIDそのもの。
// サーバーの PUT・インポートはこの厳密検証を通す（検証は境界で行う。NFR）
export const storeSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    activeTimelineId: z.string().min(1),
    timelines: z.array(timelineSchema).min(1),
  })
  .superRefine((store, ctx) => {
    // 規則1: activeTimelineId は timelines[].id のいずれかに一致する
    if (!store.timelines.some((t) => t.id === store.activeTimelineId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'E-STORE-ACTIVE-MISSING',
        path: ['activeTimelineId'],
      });
    }

    // 規則2: timelines[].id は重複しない
    const seenTimelineIds = new Set<string>();
    store.timelines.forEach((timeline, ti) => {
      if (seenTimelineIds.has(timeline.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'E-STORE-DUP-TIMELINE',
          path: ['timelines', ti, 'id'],
        });
      }
      seenTimelineIds.add(timeline.id);
    });

    store.timelines.forEach((timeline, ti) => {
      // 規則3: 各 timeline 内で person id / event id は重複しない
      // （id は "p_"/"e_" の接頭辞で種別が分かれるため、名前空間ごとに判定する）
      const personIds = new Set<string>();
      timeline.persons.forEach((person, pi) => {
        if (personIds.has(person.id)) {
          ctx.addIssue({
            code: 'custom',
            message: 'E-STORE-DUP-ID',
            path: ['timelines', ti, 'persons', pi, 'id'],
          });
        }
        personIds.add(person.id);
      });
      const eventIds = new Set<string>();
      timeline.events.forEach((event, ei) => {
        if (eventIds.has(event.id)) {
          ctx.addIssue({
            code: 'custom',
            message: 'E-STORE-DUP-ID',
            path: ['timelines', ti, 'events', ei, 'id'],
          });
        }
        eventIds.add(event.id);

        // 規則4: event.personId は同一 timeline の persons[].id に存在する
        if (event.personId !== undefined && !personIds.has(event.personId)) {
          ctx.addIssue({
            code: 'custom',
            message: 'E-STORE-EVENT-ORPHAN',
            path: ['timelines', ti, 'events', ei, 'personId'],
          });
        }
      });

      // 規則5: sortMode === 'manual' のとき personOrder は persons の id 集合と一致する
      // （過不足なし。'birthAsc' のときは判定しない = 手動順の保持を許す。data-model.md 4章）
      if (timeline.sortMode === 'manual') {
        const orderSet = new Set(timeline.personOrder);
        const mismatch =
          timeline.personOrder.length !== timeline.persons.length ||
          orderSet.size !== timeline.personOrder.length ||
          timeline.persons.some((p) => !orderSet.has(p.id));
        if (mismatch) {
          ctx.addIssue({
            code: 'custom',
            message: 'E-STORE-ORDER-MISMATCH',
            path: ['timelines', ti, 'personOrder'],
          });
        }
      }
    });
  });

export type Person = z.infer<typeof personSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type Store = z.infer<typeof storeSchema>;
