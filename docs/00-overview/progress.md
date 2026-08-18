<!-- GATE_STATUS
requirements: done
design: done
implementation: in_progress
test: not_started
release: not_started
-->

# 進捗ダッシュボード

最終更新日: 2026-08-18

上のコメントブロック（GATE_STATUS）が正の状態。`.github/hooks/` のフックや
`.github/skills/gate-check/SKILL.md` はこのブロックを直接パースするため、
書き換えるときはキー名・インデントを崩さないこと。

| フェーズ | 状態 | ゲート承認日 | 備考 |
|---|---|---|---|
| 要件定義 | 完了 | 2026-08-12 | 成果物4点＋spec-criticレビュー（MAJOR6件対応済み）。ユーザー承認済み |
| 設計 | 完了 | 2026-08-12 | architecture.md・ADR4本・詳細設計5本・モックアップ4枚+トークン・stack-conventionsスキル。spec-criticレビュー（MAJOR2件対応済み）。タグ拡張差分（イベントへの付与・複数選択絞り込み）承認込み。モックアップ確認済み（A-004確定） |
| 実装 | 進行中 | - | 26タスク中21完了（基盤001-007・コア101-113・周辺201。各タスクの証拠は tasks.md）。残り: 202〔インポート〕・203〔リカバリ画面〕・204〔画像出力/Could〕・901〔README〕・902〔完了検証〕 |
| テスト | 未着手 | - | |
| リリース | 未着手 | - | |

状態は次のいずれか: `未着手`(not_started) / `進行中`(in_progress) / `ゲート承認待ち`(pending_approval) / `完了`(done)

## 未確定事項・申し送り

- （フェーズ間で持ち越す未解決の疑問点や前提をここに記録する）

申し送りは**進行中のサイクル分のみ**を本文に置く。リリースのゲート承認時に、
完了した版のサイクル分を `docs/00-overview/archive/progress-v<版>.md` へ退避する
（GATE_STATUS ブロック・フェーズ表は本文に残す。append-only のまま積み上がると
このファイルが1回の Read に収まらなくなる。2巡で879行に達した実例あり）。
