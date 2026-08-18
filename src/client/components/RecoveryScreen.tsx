// リカバリ画面（TASK-203 / US-010 / ui-forms-dialogs.md 6章 / screen-03 #rec-corrupt・#rec-newer）。
// GET /api/store が 409（E-STORE-CORRUPT / E-STORE-NEWER）のとき、通常UIの代わりに全画面で出す。
// - corrupt: 〔JSONファイルから復旧〕= 置き換えインポートを recovery:true で PUT（サーバーが
//   破損ファイルを chronolines.corrupt-<日時>.json に改名保全してから書き込む）・
//   .bak からの手動復旧手順の提示・〔空のデータで開始〕（追加確認あり）・〔再試行〕。
// - newer: 形式バージョンと「一切書き込まない」読み取り専用の説明のみ（書き込み系の操作を
//   一切置かない = US-010「上書きせず停止」。〔再試行〕はページ再読込のみで書き込まない）。
import { useState, type ChangeEvent } from 'react';

import {
  formatExportedAtDisplay,
  IMPORT_ERROR_MESSAGES,
  parseImportFile,
  storeSummary,
  type ImportParseResult,
} from '../../domain/import';
import { CURRENT_SCHEMA_VERSION, type Store } from '../../domain/schema';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import dlg from './dialog.module.css';
import {
  bakPathOf,
  createRecoveryInitialStore,
  putRecoveryStore,
  type RecoveryPutOutcome,
} from './recoveryModel';
import styles from './RecoveryScreen.module.css';

// GET /api/store の 409 応答から AppShell が読み取った表示情報（apiErrorSchema と同形）
export interface StoreErrorInfo {
  code: string;
  message: string;
  detail?: string;
  dataPath?: string;
  fileVersion?: number;
}

// 選択済みファイルの判定結果（IoDialog と同じ持ち方。選び直すたびに丸ごと差し替える）
type RecoveryFileState = { fileName: string; result: ImportParseResult };

// 選択ファイルの読み込み失敗（判定以前の I/O エラー）も E-IMPORT-INVALID に集約する
const READ_FAILURE: ImportParseResult = {
  ok: false,
  code: 'E-IMPORT-INVALID',
  detail: 'ファイルを読み込めませんでした',
};

// 判定結果のプレビュー1行（IoDialog と同文言。保存形式は日時なし = 括弧ごと省く）
function previewLine(result: ImportParseResult & { ok: true }): string {
  const { timelineCount, personCount, eventCount } = storeSummary(result.store);
  const counts = `年表${timelineCount}個・人物${personCount}人・イベント${eventCount}件`;
  return result.exportedAt === undefined
    ? counts
    : `${counts}（エクスポート日時: ${formatExportedAtDisplay(result.exportedAt)}）`;
}

// リカバリ PUT の失敗表示（ui-forms-dialogs.md 7章: 何が起きたか + detail は折りたたみ）
function PutError({ outcome }: { outcome: RecoveryPutOutcome & { ok: false } }) {
  return (
    <div className={dlg.warn} role="alert" data-testid="recovery-put-error">
      {outcome.message}
      {outcome.detail !== undefined && (
        <details className={styles.detail}>
          <summary>詳細</summary>
          {outcome.detail}
        </details>
      )}
    </div>
  );
}

export function RecoveryScreen({
  error,
  onRecovered,
}: {
  error: StoreErrorInfo;
  // recovery:true の PUT 成功後に呼ぶ（AppShell が GET からやり直して ready へ進む）
  onRecovered: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<RecoveryFileState | null>(null);
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  // PUT 実行中はボタンを塞ぐ（二重送信でサーバーの保全・書き込みを重ねない）
  const [busy, setBusy] = useState(false);
  const [putError, setPutError] = useState<(RecoveryPutOutcome & { ok: false }) | null>(null);

  // ファイルを手で修復した後の再読込。サーバーの状態判定は起動時のみのため、リロードだけで
  // 足りるのは「サーバーも再起動済み」の場合（画面にその旨を明記。ui-forms-dialogs.md 6章）
  const retry = () => {
    window.location.reload();
  };

  if (error.code === 'E-STORE-NEWER') {
    // 書き込み系の操作は一切描画しない（復旧ボタン・インポートを出さない = 全面不可）
    return (
      <div className={styles.screen} role="alert">
        <div className={styles.card} data-testid="recovery-newer">
          <h1 className={styles.title}>⚠ より新しいバージョンのデータです</h1>
          <p className={styles.text}>
            このデータは新しいバージョンの ChronoLines
            （データ形式 v{error.fileVersion ?? '不明'}）で保存されています。 現在のアプリ
            （データ形式 v{CURRENT_SCHEMA_VERSION}）では開けません。
          </p>
          {error.dataPath !== undefined && (
            <p className={styles.text}>
              <code className={styles.code}>{error.dataPath}</code>
            </p>
          )}
          <p className={styles.text}>
            <strong>データを守るため、このままでは一切書き込みを行いません。</strong>
            アプリを新しいバージョンに更新してから開いてください。
          </p>
          <div className={styles.actions}>
            <button type="button" className={controls.btn} onClick={retry} data-testid="recovery-retry">
              再試行
            </button>
          </div>
        </div>
      </div>
    );
  }

  // E-STORE-CORRUPT（保存データ破損）。GET の 409 は corrupt / newer の2種のみのため、
  // newer 以外はすべてこの画面で受ける
  const okFile =
    importFile !== null && importFile.result.ok
      ? { fileName: importFile.fileName, result: importFile.result }
      : null;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPutError(null);
    const file = event.target.files?.[0];
    if (file === undefined) {
      return; // 選択キャンセル時は前回の状態を保つ
    }
    void file.text().then(
      (text) => setImportFile({ fileName: file.name, result: parseImportFile(text) }),
      () => setImportFile({ fileName: file.name, result: READ_FAILURE }),
    );
  };

  const runRecovery = (store: Store) => {
    setBusy(true);
    setPutError(null);
    void putRecoveryStore(store).then((outcome) => {
      setBusy(false);
      if (outcome.ok) {
        onRecovered();
        return;
      }
      setPutError(outcome);
    });
  };

  return (
    <div className={styles.screen} role="alert">
      <div className={styles.card} data-testid="recovery-corrupt">
        <h1 className={styles.title}>⚠ 保存データを読み込めませんでした</h1>
        <p className={styles.text}>
          データファイルの解析に失敗しました。<strong>既存のファイルは変更していません。</strong>
        </p>
        {error.dataPath !== undefined && (
          <p className={styles.text}>
            <code className={styles.code} data-testid="recovery-data-path">
              {error.dataPath}
            </code>
          </p>
        )}
        {error.detail !== undefined && (
          <details className={styles.detail} data-testid="recovery-detail">
            <summary>技術的な詳細</summary>
            {error.detail}
          </details>
        )}
        <p className={styles.textLead}>次のいずれかで復旧できます:</p>
        <ol className={styles.list}>
          <li>
            <strong>JSONファイルから復旧</strong> —
            エクスポート済みのバックアップを取り込みます（下のボタン）
          </li>
          <li>
            <strong>自動バックアップから手動復旧</strong> —{' '}
            <code className={styles.code}>{bakPathOf(error.dataPath)}</code> を{' '}
            <code className={styles.code}>{error.dataPath ?? 'chronolines.json'}</code>{' '}
            に上書きコピーし、サーバーを再起動してから〔再試行〕
          </li>
          <li>
            <strong>空のデータで開始</strong> — 読めなかったファイルは{' '}
            <code className={styles.code}>chronolines.corrupt-日時.json</code> として保全されます
          </li>
        </ol>
        <div className={styles.actions}>
          <button
            type="button"
            className={controls.btnPrimary}
            disabled={busy}
            onClick={() => {
              setPutError(null);
              setImportOpen(true);
            }}
            data-testid="recovery-import-open"
          >
            JSONファイルから復旧...
          </button>
          <button
            type="button"
            className={controls.btn}
            disabled={busy}
            onClick={() => {
              setPutError(null);
              setConfirmEmptyOpen(true);
            }}
            data-testid="recovery-empty-open"
          >
            空のデータで開始...
          </button>
          <button
            type="button"
            className={controls.btn}
            disabled={busy}
            onClick={retry}
            data-testid="recovery-retry"
          >
            再試行
          </button>
        </div>
        <p className={styles.note}>
          ファイルを手で修復した場合は、サーバーを再起動してから〔再試行〕してください（データの読み込み判定はサーバー起動時に行われるため）。
        </p>
        {!importOpen && !confirmEmptyOpen && putError !== null && <PutError outcome={putError} />}
      </div>
      {importOpen && (
        <Dialog
          title="JSONファイルから復旧"
          onClose={() => {
            if (!busy) {
              setImportOpen(false);
            }
          }}
          footer={
            <>
              <button
                type="button"
                className={controls.btn}
                disabled={busy}
                onClick={() => setImportOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className={controls.btnPrimary}
                disabled={okFile === null || busy}
                data-testid="recovery-run-import"
                onClick={() => {
                  if (okFile !== null) {
                    runRecovery(okFile.result.store);
                  }
                }}
              >
                このファイルで復旧
              </button>
            </>
          }
        >
          {/* 復旧は「すべて置き換える」のみ（ui-forms-dialogs.md 6章。取り込み方法の選択は無い） */}
          <p className={dlg.note}>
            エクスポート済みのJSONファイル（または保存ファイルそのもの）を選ぶと、その内容でデータを置き換えて復旧します。読めなかった現在のファイルは{' '}
            <code className={styles.code}>chronolines.corrupt-日時.json</code> として保全されます。
          </p>
          <div className={dlg.field}>
            <input
              type="file"
              accept=".json"
              aria-label="復旧に使うJSONファイル"
              data-testid="recovery-file"
              onChange={handleFileChange}
            />
          </div>
          {okFile !== null && (
            <div className={dlg.previewBox} data-testid="recovery-preview">
              ✔ {okFile.fileName}
              <br />
              {previewLine(okFile.result)}
            </div>
          )}
          {importFile !== null && !importFile.result.ok && (
            // 検証失敗はエラー表示のみで既存データ・破損ファイルとも無変更（US-011 と同じ原則）
            <div
              className={dlg.warn}
              role="alert"
              data-testid="recovery-import-error"
              data-error-code={importFile.result.code}
            >
              {IMPORT_ERROR_MESSAGES[importFile.result.code]}。データファイルは変更されていません。
              {importFile.result.code === 'E-IMPORT-INVALID' && (
                <details className={styles.detail}>
                  <summary>詳細</summary>
                  {importFile.result.detail}
                </details>
              )}
            </div>
          )}
          {putError !== null && <PutError outcome={putError} />}
        </Dialog>
      )}
      {confirmEmptyOpen && (
        // 〔空のデータで開始〕の追加確認（ui-forms-dialogs.md 6章「追加確認の上」）
        <Dialog
          title="空のデータで開始"
          onClose={() => {
            if (!busy) {
              setConfirmEmptyOpen(false);
            }
          }}
          footer={
            <>
              <button
                type="button"
                className={controls.btn}
                disabled={busy}
                onClick={() => setConfirmEmptyOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className={controls.btnDanger}
                disabled={busy}
                data-testid="recovery-empty-confirm"
                onClick={() => runRecovery(createRecoveryInitialStore())}
              >
                空のデータで開始する
              </button>
            </>
          }
        >
          <p className={dlg.message}>空のデータ（年表1のみ）で開始しますか？</p>
          <p className={dlg.note}>
            読めなかった現在のファイルは{' '}
            <code className={styles.code}>chronolines.corrupt-日時.json</code>{' '}
            に改名して保全されます（削除はされません）。
          </p>
          {putError !== null && <PutError outcome={putError} />}
        </Dialog>
      )}
    </div>
  );
}
