// 入出力ダイアログ（TASK-201/202 / ui-forms-dialogs.md 4章・5章 / US-011 / screen-03 #dlg-io）。
// エクスポートはクライアント単独で行う（Blob + a[download]。サーバー死亡時でも動作する
// 退避手段。ADR 0002）。インポートは判別・検証（domain/import.ts）が通ったファイルだけを
// replaceStore（すべて置き換え。追加確認あり）/ appendTimelines（年表として追加）で反映する。
// 検証失敗時はエラー表示のみで既存データに一切触らない（US-011）。
import { useState, type ChangeEvent } from 'react';

import { buildExportPayload, storeForExportScope, type ExportScope } from '../../domain/export';
import {
  formatExportedAtDisplay,
  IMPORT_ERROR_MESSAGES,
  parseImportFile,
  storeSummary,
  type ImportParseResult,
} from '../../domain/import';
import type { Store } from '../../domain/schema';
import { useAppStore } from '../store/appStore';
import { downloadJson, exportFileName, formatExportedAt } from '../exportDownload';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import dlg from './dialog.module.css';
import styles from './IoDialog.module.css';

type IoTab = 'export' | 'import';
// 取り込み方法（ui-forms-dialogs.md 5章。既定は screen-03 の checked と同じ「すべて置き換える」）
type ImportMode = 'replace' | 'append';
// 選択済みファイルの判定結果（ファイル未選択 = null。選び直すたびに丸ごと差し替える）
type ImportFileState = { fileName: string; result: ImportParseResult };

// 選択ファイルの読み込み失敗（判定以前の I/O エラー）も E-IMPORT-INVALID に集約する
// （ui-forms-dialogs.md 5章: 壊れたJSONと同じ「取り込めません + 既存データ無傷」の扱い）
const READ_FAILURE: ImportParseResult = {
  ok: false,
  code: 'E-IMPORT-INVALID',
  detail: 'ファイルを読み込めませんでした',
};

// 判定結果のプレビュー1行（screen-03 #dlg-io: 年表2個・人物150人・イベント420件
// （エクスポート日時: 2026-08-10 21:30）。保存形式は日時なし = 括弧ごと省く）
function previewLine(result: ImportParseResult & { ok: true }): string {
  const { timelineCount, personCount, eventCount } = storeSummary(result.store);
  const counts = `年表${timelineCount}個・人物${personCount}人・イベント${eventCount}件`;
  return result.exportedAt === undefined
    ? counts
    : `${counts}（エクスポート日時: ${formatExportedAtDisplay(result.exportedAt)}）`;
}

// インポートのエラー表示（screen-03 #import-err: warn ボックス + 折りたたみ詳細）。
// 「既存のデータは変更されていません」を必ず添える（ui-forms-dialogs.md 7章:
// データがどうなっているかを書く。detail は折りたたみで添付）
function ImportError({ result }: { result: ImportParseResult & { ok: false } }) {
  return (
    <div className={dlg.warn} role="alert" data-testid="io-import-error" data-error-code={result.code}>
      {IMPORT_ERROR_MESSAGES[result.code]}。既存のデータは変更されていません。
      {result.code === 'E-IMPORT-INVALID' && (
        <details className={styles.detail}>
          <summary>詳細</summary>
          {result.detail}
        </details>
      )}
    </div>
  );
}

export function IoDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  const [tab, setTab] = useState<IoTab>('export');
  // 既定は「現在の年表のみ」（screen-03 の checked と同じ）
  const [scope, setScope] = useState<ExportScope>('current');
  const [importFile, setImportFile] = useState<ImportFileState | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('replace');
  // 「すべて置き換える」の追加確認（ui-forms-dialogs.md 5章。追加は確認なしで実行）
  const [confirmOpen, setConfirmOpen] = useState(false);

  const active = store.timelines.find((t) => t.id === store.activeTimelineId);
  if (active === undefined) {
    // storeSchema の参照整合性検証済みのため通常到達しない（Toolbar と同じ明示的失敗）
    throw new Error('E-STORE-ACTIVE-MISSING: activeTimelineId が timelines に存在しません');
  }

  const handleDownload = () => {
    const now = new Date();
    downloadJson(
      exportFileName(now),
      buildExportPayload(storeForExportScope(store, scope), {
        exportedAt: formatExportedAt(now),
        appVersion: __APP_VERSION__,
      }),
    );
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return; // 選択キャンセル時は前回の状態を保つ
    }
    void file.text().then(
      (text) => setImportFile({ fileName: file.name, result: parseImportFile(text) }),
      () => setImportFile({ fileName: file.name, result: READ_FAILURE }),
    );
  };

  // 取り込みの実行。検証済み（result.ok）のときだけ到達する
  const runImport = (result: ImportParseResult & { ok: true }) => {
    if (importMode === 'replace') {
      // 現在の全データをファイル内容で置き換える（復旧経路。activeTimelineId も
      // ファイルのものを採用する）。自動保存は replaceStore が起動する
      useAppStore.getState().replaceStore(result.store);
    } else {
      // ファイル内の年表を新しい年表として追加（id 再採番は appendTimelines の管轄）
      useAppStore.getState().appendTimelines(result.store.timelines);
    }
    setConfirmOpen(false);
    onClose();
  };

  // 検証を通ったファイルだけ（プレビュー・〔取り込む〕活性の判定に使う）
  const okFile =
    importFile !== null && importFile.result.ok
      ? { fileName: importFile.fileName, result: importFile.result }
      : null;

  return (
    <Dialog
      title="エクスポート / インポート"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={controls.btn} onClick={onClose}>
            閉じる
          </button>
          {/* 〔取り込む〕はインポートタブの操作（screen-03 のフッター）。エクスポートタブでは
              出さない（押せないボタンを並べて誤解させない = TASK-201 と同じ判断） */}
          {tab === 'import' && (
            <button
              type="button"
              className={controls.btnPrimary}
              disabled={okFile === null}
              data-testid="io-run-import"
              onClick={() => {
                if (okFile === null) {
                  return;
                }
                if (importMode === 'replace') {
                  setConfirmOpen(true); // 置き換えのみ追加確認を挟む
                } else {
                  runImport(okFile.result);
                }
              }}
            >
              取り込む
            </button>
          )}
        </>
      }
    >
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'export'}
          className={tab === 'export' ? styles.tabOn : styles.tab}
          data-testid="io-tab-export"
          onClick={() => setTab('export')}
        >
          エクスポート
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'import'}
          className={tab === 'import' ? styles.tabOn : styles.tab}
          data-testid="io-tab-import"
          onClick={() => setTab('import')}
        >
          インポート
        </button>
      </div>
      {tab === 'export' ? (
        <div role="tabpanel" aria-label="エクスポート">
          <div className={styles.radioRow}>
            <label>
              <input
                type="radio"
                name="export-scope"
                value="current"
                checked={scope === 'current'}
                onChange={() => setScope('current')}
                data-testid="io-scope-current"
              />
              現在の年表のみ（{active.name}）
            </label>
          </div>
          <div className={styles.radioRow}>
            <label>
              <input
                type="radio"
                name="export-scope"
                value="all"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
                data-testid="io-scope-all"
              />
              すべての年表（{store.timelines.length}個）
            </label>
          </div>
          <p className={styles.note}>
            JSONファイルとしてダウンロードします。バックアップはこのファイルを保管してください（復旧はインポートで行います）。
          </p>
          <button
            type="button"
            className={controls.btnPrimary}
            onClick={handleDownload}
            data-testid="io-download"
          >
            JSONをダウンロード
          </button>
        </div>
      ) : (
        <div role="tabpanel" aria-label="インポート">
          <div className={dlg.field}>
            <input
              type="file"
              accept=".json"
              aria-label="インポートするJSONファイル"
              data-testid="io-file"
              onChange={handleFileChange}
            />
          </div>
          {okFile !== null && (
            <>
              <div className={dlg.previewBox} data-testid="io-preview">
                ✔ {okFile.fileName}
                <br />
                {previewLine(okFile.result)}
              </div>
              <div className={styles.radioRow}>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    value="replace"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                    data-testid="io-mode-replace"
                  />
                  すべて置き換える（現在のデータは失われます）
                </label>
              </div>
              <div className={styles.radioRow}>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    value="append"
                    checked={importMode === 'append'}
                    onChange={() => setImportMode('append')}
                    data-testid="io-mode-append"
                  />
                  年表として追加する
                </label>
              </div>
            </>
          )}
          {importFile !== null && !importFile.result.ok && <ImportError result={importFile.result} />}
        </div>
      )}
      {confirmOpen && okFile !== null && (
        <Dialog
          title="インポートの確認"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button type="button" className={controls.btn} onClick={() => setConfirmOpen(false)}>
                キャンセル
              </button>
              <button
                type="button"
                className={controls.btnDanger}
                data-testid="io-confirm-replace"
                onClick={() => runImport(okFile.result)}
              >
                置き換える
              </button>
            </>
          }
        >
          <p className={dlg.message}>現在のデータはすべて失われます。よろしいですか？</p>
        </Dialog>
      )}
    </Dialog>
  );
}
