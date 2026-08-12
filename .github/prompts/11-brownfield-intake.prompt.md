---
agent: requirements
description: '既存のコードベースにハーネスを導入する。実装済みコードからas-is要件・アーキテクチャをdocsへ逆起こしし、整合検証を経て差分駆動の改修サイクルに接続する'
---

`.github/skills/brownfield-intake/SKILL.md` の手順に従って、既存コードベースへの
ハーネス導入を進めてください。

- as-is（今どう動いているか）だけを書き、to-be（改善したいこと）は改修候補リストに分ける。
- これから触る領域＋システムの背骨に絞って逆起こしし、未逆起こし領域は明記して残す。
- environment.md は実機確認して埋める。
- as-is設計の逆起こし（architecture.md・ADR事後記録）が必要な段階に来たら、
  「新しいチャットで `/03-design-architecture` を実行し、brownfield-intake スキルの
  as-is逆起こしとして進めてください」と案内する。
- 最後に spec-critic レビューと gate-check の横断整合監査で文書とコードの整合を検証し、
  ユーザー承認のうえ GATE_STATUS を初期化する。
