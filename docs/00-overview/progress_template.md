<!-- GATE_STATUS
requirements: not_started
design: not_started
implementation: not_started
test: not_started
release: not_started
-->

# 進捗ダッシュボード

最終更新日: YYYY-MM-DD

上のコメントブロック（GATE_STATUS）が正の状態。`.github/hooks/` のフックや
`.github/skills/gate-check/SKILL.md` はこのブロックを直接パースするため、
書き換えるときはキー名・インデントを崩さないこと。

| フェーズ | 状態 | ゲート承認日 | 備考 |
|---|---|---|---|
| 要件定義 | 未着手 | - | |
| 設計 | 未着手 | - | |
| 実装 | 未着手 | - | |
| テスト | 未着手 | - | |
| リリース | 未着手 | - | |

状態は次のいずれか: `未着手`(not_started) / `進行中`(in_progress) / `ゲート承認待ち`(pending_approval) / `完了`(done)

## 未確定事項・申し送り

- （フェーズ間で持ち越す未解決の疑問点や前提をここに記録する）

申し送りは**進行中のサイクル分のみ**を本文に置く。リリースのゲート承認時に、
完了した版のサイクル分を `docs/00-overview/archive/progress-v<版>.md` へ退避する
（GATE_STATUS ブロック・フェーズ表は本文に残す。append-only のまま積み上がると
このファイルが1回の Read に収まらなくなる。2巡で879行に達した実例あり）。
