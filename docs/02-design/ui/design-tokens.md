# デザイントークン（ChronoLines）

全モックアップ・実装（CSS カスタムプロパティ）が共通で参照する正。
実装フェーズでは `src/client/styles/tokens.css` にこの表のとおり定義する。

## 色

| トークン | 値 | 用途 |
|---|---|---|
| --color-bg | #FFFFFF | ページ・グリッド地 |
| --color-surface | #F9FAFB | ツールバー・パネル地 |
| --color-text | #1F2937 | 基本テキスト |
| --color-text-muted | #6B7280 | 補助テキスト（生没年併記等） |
| --color-border | #E5E7EB | 罫線 |
| --color-border-strong | #9CA3AF | 10年ガイド罫線 |
| --color-alive-bg | #DBEAFE | 生存セルの背景（補助チャネル） |
| --color-alive-text | #1E40AF | 生存セルの年齢数値 |
| --color-alive-band | #3B82F6 | 生存の帯（セル下端3px。識別の主チャネル） |
| --color-virtual-bg | #F3F4F6 | 仮想年齢セルの背景 |
| --color-virtual-text | #4B5563 | 仮想年齢の数値（括弧書式と併用） |
| --color-virtual-band | #9CA3AF | 仮想の帯 |
| --color-chip-bg | #FDE68A | イベントチップ背景 |
| --color-chip-text | #713F12 | イベントチップ文字 |
| --color-selcol-bg | #FEF3C7 | 選択列のハイライト（空欄セル部分） |
| --color-row-hilite | #FEF08A | 検索ヒット行（人物列）の強調 |
| --color-current-year | #DC2626 | 現在年の縦罫線 |
| --color-primary | #2563EB | 主ボタン・リンク |
| --color-danger | #DC2626 | 削除・エラー |
| --color-error-bg | #FEE2E2 | エラーバナー背景 |

## タグ配色（8色パレット）

タグは「淡い背景 + 濃い文字 + 彩度の高い色ドット」のピル型。**タグの識別はラベル文字列が
主チャネル**で、色は補助（同色の別タグが生じても識別を損なわない）。

| # | 名称 | 背景 | 文字 | ドット | 文字/背景コントラスト（実測） |
|---|---|---|---|---|---|
| 0 | blue | #DBEAFE | #1E40AF | #3B82F6 | 7.15 AA合格 |
| 1 | green | #DCFCE7 | #166534 | #22C55E | 6.49 AA合格 |
| 2 | amber | #FEF3C7 | #92400E | #F59E0B | 6.37 AA合格 |
| 3 | purple | #F3E8FF | #6B21A8 | #A855F7 | 7.39 AA合格 |
| 4 | pink | #FCE7F3 | #9D174D | #EC4899 | 6.71 AA合格 |
| 5 | teal | #CCFBF1 | #115E59 | #14B8A6 | 6.73 AA合格 |
| 6 | red | #FEE2E2 | #991B1B | #EF4444 | 6.80 AA合格 |
| 7 | gray | #E5E7EB | #374151 | #6B7280 | 8.33 AA合格 |

- **割り当て規則**: タグ名の文字列ハッシュ（UTF-16コード値の和など単純なもの）mod 8。
  マスタ管理なしで「同名タグ = アプリ全体で常に同色」が成立する。
  衝突（別名タグが同色になる）は許容する（識別はラベル文字が担う）。
- ピルの形: 角丸 999px・パディング 2px 10px・フォント12px・ドット8px（文字の左）。
- 2026-08-12 実測（同スクリプトで機械検証）: 全8ペアの文字コントラスト AA 合格。
  淡い背景同士の ΔE は一部 15 未満（blue/purple 9.1 等）のため、
  背景色単独をタグの識別チャネルにしない（上記の規則どおりラベル + ドットが主）。

## 生存/仮想の識別設計（NFR: 色だけに依存しない）

識別チャネルは3重: (1) **書式** — 仮想年齢は `(157)` と括弧付き、
(2) **文字色** — #1E40AF vs #4B5563、(3) **帯** — セル下端3pxの彩度の高い帯
#3B82F6 vs #9CA3AF。淡い背景ティントは補助のみ（単独の識別に使わない）。

## 実測値（2026-08-12、tools: WCAG相対輝度式 + CIE76、スクリプトによる機械検証）

| 検証項目 | 実測値 | 判定 |
|---|---|---|
| alive-text / alive-bg コントラスト比 | 7.15 | AA合格（>=4.5） |
| virtual-text / virtual-bg | 6.87 | AA合格 |
| chip-text / chip-bg | 6.96 | AA合格 |
| text / bg・selcol-bg・row-hilite | 14.68 / 13.18 / 12.61 | AA合格 |
| text-muted / bg | 4.83 | AA合格 |
| alive-band / virtual-band 色差 | ΔE 61.0（deuteranopia模擬下でも 73.0） | 識別チャネルとして成立 |
| alive-bg / virtual-bg 色差 | ΔE 11.1（模擬下 12.9） | 単独では不成立 → 補助チャネルに限定（上記の識別設計のとおり） |

## タイポグラフィ・寸法

| トークン | 値 |
|---|---|
| --font-family | "Segoe UI", "Yu Gothic UI", Meiryo, system-ui, sans-serif |
| --font-size-base / -small / -cell | 14px / 12px / 12px |
| --cell-w（1年） / --cell-w-decade（10年） | 44px / 72px |
| --cell-h（行高） | 28px |
| --name-col-w（人物列幅） | 200px |
| --radius / --radius-lg | 4px / 8px |
| --space-1..4 | 4px / 8px / 12px / 16px |
| イベントレーン高 | 56px（チップ2段） |

## 部品の共通規則

- ボタン: 主要 = primary塗り + 白文字、通常 = 白地 + border、危険 = danger塗り + 白文字。
- ダイアログ: 中央モーダル・オーバーレイ rgba(0,0,0,.4)・radius-lg・幅 480px（フォーム系）。
- インラインエラー: danger色 12px、フィールド直下。
- バナー: グリッド上部全幅。エラー = error-bg、情報 = selcol-bg。
- テーマは1つ（ライト）に固定する（個人利用ローカルアプリ。ダークテーマは作らない）。
