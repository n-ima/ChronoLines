// 年の表現と計算（domain-logic.md 1章 / ADR 0004）。
// 保存・入出力は StoredYear（前N = -N。0 は不正）、内部計算は AstroYear（前1年 = 0 の連続整数軸）。
// toAstro/fromAstro を書いてよいのはこのファイルだけ（他所で y ± 1 の紀元前補正を書かない）。

export type StoredYear = number & { __brand: 'StoredYear' };
export type AstroYear = number & { __brand: 'AstroYear' };

export function toAstro(y: StoredYear): AstroYear {
  return (y < 0 ? y + 1 : y) as AstroYear;
}

export function fromAstro(a: AstroYear): StoredYear {
  return (a <= 0 ? a - 1 : a) as StoredYear;
}

// 年の全順序。0年が存在しない StoredYear のままでは大小比較が不連続になるため astro 差で定義する
export function compareStoredYears(a: StoredYear, b: StoredYear): number {
  return toAstro(a) - toAstro(b);
}

// 満年齢 = astro 差の1式で、glossary.md の場合分け（西暦同士 Y−B / 紀元またぎ Y+B−1 /
// 紀元前同士 B−C）すべてと一致する（ADR 0004）。負値 = 生前（呼び出し側で空欄扱い）
export function ageAt(birthYear: StoredYear, displayYear: StoredYear): number {
  return toAstro(displayYear) - toAstro(birthYear);
}

export type CellValue =
  | { kind: 'blank' } // 生前（US-002）
  | { kind: 'alive'; age: number } // 生存中（生年=0、没年=生存扱い）
  | { kind: 'virtual'; age: number }; // 仮想年齢（没後・存命者の現在年より後）

// cellValue が必要とする最小の構造（schema.ts の Person はこれを構造的に満たす。
// schema.ts は本モジュールに依存するため、逆向きの import はしない）
export type PersonLifespan = {
  birth: { year: StoredYear };
  death?: { year: StoredYear };
};

// 判定規則（domain-logic.md 1章。上から順に評価）
export function cellValue(
  person: PersonLifespan,
  year: StoredYear,
  currentYear: StoredYear,
): CellValue {
  const age = ageAt(person.birth.year, year);
  if (age < 0) {
    return { kind: 'blank' };
  }
  if (person.death !== undefined) {
    if (compareStoredYears(year, person.death.year) > 0) {
      return { kind: 'virtual', age };
    }
  } else if (compareStoredYears(year, currentYear) > 0) {
    return { kind: 'virtual', age };
  }
  return { kind: 'alive', age };
}

export function formatYear(y: StoredYear): string {
  return y < 0 ? `前${-y}` : String(y);
}

export type YearParseResult =
  | { ok: true; year: StoredYear }
  | { ok: false; code: 'E-YEAR-FORMAT' | 'E-YEAR-ZERO' };

// A-006: "1600" / "-100" / "前100" の3表記を受理。全角数字・前後空白は NFKC + trim で正規化
export function parseYearInput(input: string): YearParseResult {
  const normalized = input.normalize('NFKC').trim();
  const match = /^(前|-)?([0-9]+)$/.exec(normalized);
  const digits = match?.[2];
  if (digits === undefined) {
    return { ok: false, code: 'E-YEAR-FORMAT' };
  }
  const magnitude = Number(digits);
  if (magnitude === 0) {
    // 0年は存在しません（前1年の翌年は西暦1年です）
    return { ok: false, code: 'E-YEAR-ZERO' };
  }
  if (!Number.isSafeInteger(magnitude) || magnitude > 99999) {
    return { ok: false, code: 'E-YEAR-FORMAT' };
  }
  const year = match?.[1] === undefined ? magnitude : -magnitude;
  return { ok: true, year: year as StoredYear };
}

// 10年列の境界は stored 年のラベルに整列させる（screen-02 で合意した見た目が正）
export function decadeStart(a: AstroYear): AstroYear {
  if (a >= 10) {
    return (Math.floor(a / 10) * 10) as AstroYear;
  }
  if (a >= 1) {
    // 西暦1〜9 は 0年が存在しないための例外: 9年バケット
    return 1 as AstroYear;
  }
  return (Math.floor((a - 1) / 10) * 10 + 1) as AstroYear;
}

export function decadeEnd(dStart: AstroYear): AstroYear {
  return (dStart === 1 ? 9 : dStart + 9) as AstroYear;
}

// 10年列の見出し（"1600〜" / "前1000〜"）。パネル等の全範囲表記（"1600〜1609" 等）は
// 呼び出し側が formatYear + decadeEnd で組み立てる
export function formatDecade(dStart: AstroYear): string {
  return `${formatYear(fromAstro(dStart))}〜`;
}
