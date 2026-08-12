---
name: gate-check
description: docs/00-overview/progress.md の状態を読み書きしてフェーズゲート(未着手/進行中/ゲート承認待ち/完了)を判定・更新する手順。オーケストレーターや各フェーズエージェントが進捗確認・更新するときに使う。
---

# ゲート判定スキル

## 状態の正

`docs/00-overview/progress.md` の先頭にある機械可読ブロックが正。人間向けの表と
必ず一致させる。

```
<!-- GATE_STATUS
requirements: not_started | in_progress | pending_approval | done
design: not_started | in_progress | pending_approval | done
implementation: not_started | in_progress | pending_approval | done
test: not_started | in_progress | pending_approval | done
release: not_started | in_progress | pending_approval | done
-->
```

## 判定手順

1. `docs/00-overview/progress.md` が無ければ `progress_template.md` から作成する。
2. 各フェーズについて、対応する成果物ファイルの有無から実態を推測する。
   - requirements: `docs/01-requirements/requirements.md` が無ければ `not_started`。
     あれば `in_progress`。「未確定事項」欄が空でユーザー承認を得ていれば `done`。
   - design: `docs/02-design/architecture.md`
   - implementation: `docs/03-implementation/tasks.md`（全チェックボックス完了で`done`。
     ただし `👤` 印の**人手必須タスク**は、ドラフトの出力ではなく**実体の配置・実行が
     確認できて**初めて完了となる。人手必須タスクの残件が1件でもあれば `done` にしない
     （`[x]` なのに実体未配置のまま5セッション持ち越された実例あり）
   - test: `docs/04-test/test-report.md`
   - release: `docs/05-release/release-checklist.md`
3. GATE_STATUSブロックと実態がずれていれば、ユーザーに更新してよいか確認してから書き換える
   （エージェントが黙って `done` にしない。ユーザーの明示的な承認発言があって初めて `done` にする）。
4. `.github/hooks/scripts/` のゲート系フックはこのGATE_STATUSブロックを直接パースするため、
   フォーマット（インデント・キー名）を崩さない。

## 完了と停止の条件（全フェーズ共通の論理式）

フェーズやタスクの「完了」は、エージェントの完了宣言ではなく次の条件の全充足で判定する。

```
完了 = 受入条件を満たす AND 定義された機械的検証(テスト・ビルド等)が通る
       AND 必要な成果物が docs/ に存在する AND 人間の承認が必要な箇所は承認済み
```

逆に、次のいずれかに当たったら自律継続をやめて停止・報告する（成功による停止と
失敗による停止は別物であり、両方を明示する）。

```
エスカレーション = 同一失敗の反復(3回) OR 進捗なし OR 要件・設計で判断できない事実が必要
                 OR 破壊的操作・方針境界に到達 OR 完了条件そのものが満たせないと判明
```

**完了マークの規律**: `tasks.md` のチェックボックスと GATE_STATUS は「通すために
書き換える」対象になり得る（Markdownはモデルが編集できてしまう）。完了マークは
必ず完了条件の証拠（実行したコマンドと結果）とセットで付け、`done` への遷移は
必ずユーザー承認を経る。reviewer は証拠と実体の一致を照合する（reviewer観点5）。
機械的検証は `python tools/golden-eval.py <プロジェクトパス>` でいつでも実行できる
（完了宣言と成果物実態の突き合わせ。テスト・リリース前の自己点検に使う）。

## 運用中（全フェーズ done）の扱い

5フェーズすべてが `done` の状態は「プロジェクト完了」ではなく **「運用中」** である。
これはリリース済みプロジェクトと、`/11-brownfield-intake` で取り込んだ既存アプリの
初期状態の両方に当たる。

**この状態でユーザーから依頼を受けたときの入口は `/12-change-request`。**
「全部 done なので次にやることはありません」と答えて終わらせない（入口が示されないと、
エージェントはハーネス外の場当たり作業に落ちる。実測された失敗モード）。

## 改修サイクル（リリース後の修正時）

手順の正は `change-request` スキル（`.github/skills/change-request/SKILL.md`）。
以下はゲート操作の部分だけを示す。AGENTS.md「差分駆動の原則」の4分類に基づき、
改修の起点に応じて該当フェーズを `in_progress` へ戻す。

- 要件・設計の変更を伴う改修 → 該当する上流フェーズ（requirements または design）から
- 変更を伴わないバグ修正 → implementation から
- 戻すのは**該当フェーズ以降のみ**（全フェーズのやり直しはしない）
- 改修理由を `progress.md` の「未確定事項・申し送り」に1行記録する
- リリース直前の**小規模な要件追加**は、AGENTS.md「差分駆動の原則」5. の条件
  （影響範囲が閉じていることの明示・`spec-critic` 省略はユーザーの明示承認・
  省略した手続きの progress.md への記録）を満たす場合に限り、
  複数フェーズを1セッションで通してよい

## リリース承認時の後処理（progress.md の肥大化対策）

リリースのゲート承認時（`release` を `done` にするとき）、`progress.md` の
「未確定事項・申し送り」から**完了した版のサイクル分**を
`docs/00-overview/archive/progress-v<版>.md` へ退避する
（GATE_STATUS ブロック・フェーズ表・進行中の申し送りは本文に残す）。
申し送りが append-only のまま積み上がると、オーケストレーターが最初に読むファイルが
1回の Read に収まらなくなる（2巡で879行・115KB に達した実例あり）。

## 横断整合監査（ユーザーが「整合チェック」「監査」を求めたとき）

フェーズ判定は個々の成果物の有無を見るが、この監査は**成果物間の食い違い**を検出する。
改修が数回重なった後に特に効く。以下を突き合わせ、食い違いを表で報告する（修正はしない）。

1. `requirements.md` の要求ID ↔ 設計のトレーサビリティ表（対応漏れ）
2. `architecture.md` / 詳細設計 ↔ `tasks.md` のタスク
   （設計にない実装・実装されない設計）
3. `tasks.md` ↔ テスト計画/レポートのケース対応
4. 文書中の実装ファイル・テストへの参照 ↔ 実在するか（削除・リネーム漏れ）
5. GATE_STATUS ↔ 各成果物の実態
6. 「実装乖離あり」注記 ↔ 解消期限切れがないか
