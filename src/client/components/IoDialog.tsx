// 入出力ダイアログ（TASK-201 / ui-forms-dialogs.md 4章 / US-011 / screen-03 #dlg-io）。
// エクスポートはクライアント単独で行う（Blob + a[download]。サーバー死亡時でも動作する
// 退避手段。ADR 0002）。インポートタブは TASK-202 の管轄のため、本タスクではタブを
// 無効表示に留める（モックアップのタブ構造は維持する）。
import { useState } from 'react';

import { buildExportPayload, storeForExportScope, type ExportScope } from '../../domain/export';
import type { Store } from '../../domain/schema';
import { downloadJson, exportFileName, formatExportedAt } from '../exportDownload';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import styles from './IoDialog.module.css';

export function IoDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  // 既定は「現在の年表のみ」（screen-03 の checked と同じ）
  const [scope, setScope] = useState<ExportScope>('current');
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

  return (
    <Dialog
      title="エクスポート / インポート"
      onClose={onClose}
      // 〔取り込む〕はインポートタブの操作（TASK-202）。エクスポートのみの現段階では
      // フッターは〔閉じる〕だけにする（無効な〔取り込む〕を並べて誤解させない）
      footer={
        <button type="button" className={controls.btn} onClick={onClose}>
          閉じる
        </button>
      }
    >
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className={styles.tabOn}
          data-testid="io-tab-export"
        >
          エクスポート
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          className={styles.tab}
          data-testid="io-tab-import"
          disabled
          title="インポートは準備中です"
        >
          インポート
        </button>
      </div>
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
    </Dialog>
  );
}
