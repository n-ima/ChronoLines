import { describe, expect, it } from 'vitest';

import {
  ageAt,
  cellValue,
  compareStoredYears,
  decadeEnd,
  decadeStart,
  formatDecade,
  formatYear,
  fromAstro,
  parseYearInput,
  toAstro,
  type AstroYear,
  type PersonLifespan,
  type StoredYear,
} from '../../src/domain/year';

// テストデータの年をブランド型へ持ち上げるヘルパー（テスト内のみ。値は変えない）
const sy = (n: number) => n as StoredYear;
const ay = (n: number) => n as AstroYear;
const person = (birthYear: number, deathYear?: number): PersonLifespan =>
  deathYear === undefined
    ? { birth: { year: sy(birthYear) } }
    : { birth: { year: sy(birthYear) }, death: { year: sy(deathYear) } };

// domain-logic.md 検算表の「現在年=2026想定」に合わせる
const CURRENT = sy(2026);

describe('toAstro / fromAstro（ADR 0004）', () => {
  it('西暦は恒等: 1600 → 1600', () => {
    expect(toAstro(sy(1600))).toBe(1600);
  });
  it('前1年 = astro 0、前100年 = astro -99', () => {
    expect(toAstro(sy(-1))).toBe(0);
    expect(toAstro(sy(-100))).toBe(-99);
  });
  it('fromAstro は逆変換: astro 0 → 前1、astro -99 → 前100、astro 1 → 西暦1', () => {
    expect(fromAstro(ay(0))).toBe(-1);
    expect(fromAstro(ay(-99))).toBe(-100);
    expect(fromAstro(ay(1))).toBe(1);
  });
  it('往復で元に戻る（0を除く全域）', () => {
    for (const y of [-99999, -1000, -100, -2, -1, 1, 2, 9, 10, 1600, 99999]) {
      expect(fromAstro(toAstro(sy(y)))).toBe(y);
    }
  });
});

describe('compareStoredYears（年の全順序）', () => {
  it('前1年 < 西暦1年（0年は存在しない連続軸）', () => {
    expect(compareStoredYears(sy(-1), sy(1))).toBeLessThan(0);
    expect(compareStoredYears(sy(1), sy(-1))).toBeGreaterThan(0);
  });
  it('同年は 0', () => {
    expect(compareStoredYears(sy(1600), sy(1600))).toBe(0);
    expect(compareStoredYears(sy(-100), sy(-100))).toBe(0);
  });
  it('紀元前同士: 前100 < 前50', () => {
    expect(compareStoredYears(sy(-100), sy(-50))).toBeLessThan(0);
  });
});

describe('ageAt（満年齢 = astro差。glossary.md の場合分けと一致）', () => {
  it('西暦同士 Y−B: 1543 → 1600 は 57', () => {
    expect(ageAt(sy(1543), sy(1600))).toBe(57);
  });
  it('紀元またぎ Y+B−1: 前100 → 西暦1 は 100', () => {
    expect(ageAt(sy(-100), sy(1))).toBe(100);
  });
  it('紀元前同士 B−C: 前100 → 前50 は 50', () => {
    expect(ageAt(sy(-100), sy(-50))).toBe(50);
  });
  it('生前は負値', () => {
    expect(ageAt(sy(1543), sy(1500))).toBeLessThan(0);
  });
});

// domain-logic.md「検算表」9行をそのまま転記（期待値は表が正）
describe('cellValue: 検算表（domain-logic.md 1章）', () => {
  it('1543 / 表示1600 → alive 57（US-004 成功指標）', () => {
    expect(cellValue(person(1543), sy(1600), CURRENT)).toEqual({ kind: 'alive', age: 57 });
  });
  it('1543(没1616) / 表示1700 → virtual 157（US-002）', () => {
    expect(cellValue(person(1543, 1616), sy(1700), CURRENT)).toEqual({ kind: 'virtual', age: 157 });
  });
  it('1543 / 表示1500 → blank（生前）', () => {
    expect(cellValue(person(1543), sy(1500), CURRENT)).toEqual({ kind: 'blank' });
  });
  it('1543(没1616) / 表示1543 → alive 0、表示1616 → alive 73（境界）', () => {
    expect(cellValue(person(1543, 1616), sy(1543), CURRENT)).toEqual({ kind: 'alive', age: 0 });
    expect(cellValue(person(1543, 1616), sy(1616), CURRENT)).toEqual({ kind: 'alive', age: 73 });
  });
  it('1980(存命) / 表示2100 → virtual 120（現在年=2026想定・未来年）', () => {
    expect(cellValue(person(1980), sy(2100), CURRENT)).toEqual({ kind: 'virtual', age: 120 });
  });
  it('前100 / 表示前100 → alive 0（US-005）', () => {
    expect(cellValue(person(-100), sy(-100), CURRENT)).toEqual({ kind: 'alive', age: 0 });
  });
  it('前100 / 表示前50 → alive 50（紀元前同士: B−C = 100−50）', () => {
    expect(cellValue(person(-100), sy(-50), CURRENT)).toEqual({ kind: 'alive', age: 50 });
  });
  it('前100 / 表示西暦1 → alive 100（紀元またぎ: Y+B−1 = 1+100−1）', () => {
    expect(cellValue(person(-100), sy(1), CURRENT)).toEqual({ kind: 'alive', age: 100 });
  });
  it('前1(死没なし) / 表示西暦1 → alive 1（最小の紀元またぎ: astro 0 → 1）', () => {
    expect(cellValue(person(-1), sy(1), CURRENT)).toEqual({ kind: 'alive', age: 1 });
  });
});

// domain-logic.md「cellValue の判定規則」4行（上から順に評価）
describe('cellValue: 判定規則（規則1〜4）', () => {
  it('規則1: ageAt < 0 → blank（没年の有無に関わらず生前が最優先）', () => {
    expect(cellValue(person(1543, 1616), sy(1500), CURRENT)).toEqual({ kind: 'blank' });
  });
  it('規則2: 没年あり かつ year > death.year → virtual', () => {
    expect(cellValue(person(1543, 1616), sy(1617), CURRENT)).toEqual({ kind: 'virtual', age: 74 });
  });
  it('規則3: 没年なし かつ year > currentYear → virtual', () => {
    expect(cellValue(person(1980), sy(2027), CURRENT)).toEqual({ kind: 'virtual', age: 47 });
  });
  it('規則4: それ以外 → alive（生年セル=0、没年セル=生存扱い、現在年セル=生存扱い）', () => {
    expect(cellValue(person(1980), sy(1980), CURRENT)).toEqual({ kind: 'alive', age: 0 });
    expect(cellValue(person(1543, 1616), sy(1616), CURRENT)).toEqual({ kind: 'alive', age: 73 });
    expect(cellValue(person(1980), sy(2026), CURRENT)).toEqual({ kind: 'alive', age: 46 });
  });
  it('補足: 没年が現在年より未来の人物は没年まで alive（意図した挙動として許容）', () => {
    expect(cellValue(person(1980, 2100), sy(2050), CURRENT)).toEqual({ kind: 'alive', age: 70 });
    expect(cellValue(person(1980, 2100), sy(2101), CURRENT)).toEqual({ kind: 'virtual', age: 121 });
  });
});

describe('formatYear（表示は常に「前100」形式。US-005）', () => {
  it('1600 → "1600"', () => {
    expect(formatYear(sy(1600))).toBe('1600');
  });
  it('-100 → "前100"', () => {
    expect(formatYear(sy(-100))).toBe('前100');
  });
  it('境界: 1 → "1"、-1 → "前1"', () => {
    expect(formatYear(sy(1))).toBe('1');
    expect(formatYear(sy(-1))).toBe('前1');
  });
});

// parseYearInput の仕様（A-006 の確定）
describe('parseYearInput', () => {
  it('"1600" → 1600', () => {
    expect(parseYearInput('1600')).toEqual({ ok: true, year: 1600 });
  });
  it('"-100" → -100', () => {
    expect(parseYearInput('-100')).toEqual({ ok: true, year: -100 });
  });
  it('"前100" → -100', () => {
    expect(parseYearInput('前100')).toEqual({ ok: true, year: -100 });
  });
  it('全角数字を正規化して受理: "１６００" → 1600、"前１００" → -100', () => {
    expect(parseYearInput('１６００')).toEqual({ ok: true, year: 1600 });
    expect(parseYearInput('前１００')).toEqual({ ok: true, year: -100 });
  });
  it('前後空白（全角空白含む）を正規化して受理', () => {
    expect(parseYearInput('  1600  ')).toEqual({ ok: true, year: 1600 });
    expect(parseYearInput('　前100　')).toEqual({ ok: true, year: -100 });
  });
  it('0年は拒否: "0" / "前0" / "-0" → E-YEAR-ZERO', () => {
    expect(parseYearInput('0')).toEqual({ ok: false, code: 'E-YEAR-ZERO' });
    expect(parseYearInput('前0')).toEqual({ ok: false, code: 'E-YEAR-ZERO' });
    expect(parseYearInput('-0')).toEqual({ ok: false, code: 'E-YEAR-ZERO' });
  });
  it('±99999 は受理、±99999超 → E-YEAR-FORMAT', () => {
    expect(parseYearInput('99999')).toEqual({ ok: true, year: 99999 });
    expect(parseYearInput('前99999')).toEqual({ ok: true, year: -99999 });
    expect(parseYearInput('100000')).toEqual({ ok: false, code: 'E-YEAR-FORMAT' });
    expect(parseYearInput('-100000')).toEqual({ ok: false, code: 'E-YEAR-FORMAT' });
    expect(parseYearInput('前100000')).toEqual({ ok: false, code: 'E-YEAR-FORMAT' });
  });
  it('整数と解釈できない入力 → E-YEAR-FORMAT', () => {
    for (const input of ['', '   ', 'abc', '12.5', '1600年', '前-100', '--100', '1 600']) {
      expect(parseYearInput(input)).toEqual({ ok: false, code: 'E-YEAR-FORMAT' });
    }
  });
});

// domain-logic.md「10年境界の検算表」8行をそのまま転記（stored → astro → dStart astro）
describe('decadeStart: 10年境界の検算表', () => {
  const rows: Array<[label: string, stored: number, astro: number, dStart: number]> = [
    ['前1000 → 前1000〜前991（紀元前規則）', -1000, -999, -999],
    ['前991 → 前1000〜前991（バケット終端）', -991, -990, -999],
    ['前10 → 前10〜前1（紀元前規則）', -10, -9, -9],
    ['前1 → 前10〜前1（バケット終端）', -1, 0, -9],
    ['西暦1 → 1〜9（例外規則・9年バケット）', 1, 1, 1],
    ['西暦9 → 1〜9（バケット終端）', 9, 9, 1],
    ['西暦10 → 10〜19（西暦規則）', 10, 10, 10],
    ['1600 → 1600〜1609（西暦規則）', 1600, 1600, 1600],
  ];
  it.each(rows)('%s', (_label, stored, astro, dStart) => {
    expect(toAstro(sy(stored))).toBe(astro);
    expect(decadeStart(ay(astro))).toBe(dStart);
  });
});

describe('decadeEnd / formatDecade', () => {
  it('dStart 1（9年バケット）→ 9、それ以外 → dStart + 9', () => {
    expect(decadeEnd(ay(1))).toBe(9);
    expect(decadeEnd(ay(10))).toBe(19);
    expect(decadeEnd(ay(1600))).toBe(1609);
  });
  it('紀元前バケットの終端: dStart astro -999 → astro -990（= 前991）、-9 → 0（= 前1）', () => {
    expect(decadeEnd(ay(-999))).toBe(-990);
    expect(fromAstro(decadeEnd(ay(-999)))).toBe(-991);
    expect(decadeEnd(ay(-9))).toBe(0);
    expect(fromAstro(decadeEnd(ay(-9)))).toBe(-1);
  });
  it('見出し表記: "1600〜" / "前1000〜" / "1〜"', () => {
    expect(formatDecade(ay(1600))).toBe('1600〜');
    expect(formatDecade(ay(-999))).toBe('前1000〜');
    expect(formatDecade(ay(1))).toBe('1〜');
  });
});
