// ルートエラー境界（ui-timeline-grid.md 9章 / ADR 0001）: 予期しない例外時に白画面に
// せず、「エラーが発生しました」+〔再読み込み〕+〔JSONエクスポート（メモリ上のデータの
// 退避）〕を表示する。エラー境界は React の仕様上クラスコンポーネントでしか書けない。
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { buildExportPayload } from '../../domain/export';
import type { Store } from '../../domain/schema';
import { downloadJson, exportFileName, formatExportedAt } from '../exportDownload';
import controls from './controls.module.css';
import screen from './statusScreen.module.css';

interface RootErrorBoundaryProps {
  appVersion: string;
  // 描画ツリーが壊れていても「メモリ上のデータ」へ到達できるよう、参照は関数で受ける
  // （子ツリーの state に依存すると、その子が壊れたときに退避できなくなる）
  getStore: () => Store | null;
  children: ReactNode;
}

interface RootErrorBoundaryState {
  hasError: boolean;
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  override state: RootErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 画面には出さないが、開発者が原因調査できる手掛かりは隠さず残す
    console.error('RootErrorBoundary caught:', error, info.componentStack);
  }

  private readonly handleExport = (): void => {
    const store = this.props.getStore();
    if (store === null) {
      return; // ボタン側で disabled にしているため通常到達しない
    }
    const now = new Date();
    downloadJson(
      exportFileName(now),
      buildExportPayload(store, {
        exportedAt: formatExportedAt(now),
        appVersion: this.props.appVersion,
      }),
    );
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const hasStore = this.props.getStore() !== null;
    return (
      <div className={screen.screen} role="alert">
        <h1 className={screen.title}>エラーが発生しました</h1>
        <p className={screen.note}>
          予期しないエラーにより画面を表示できません。再読み込みしてください。
          保存されていない編集内容が心配な場合は、先にJSONエクスポートで退避できます。
        </p>
        <div className={screen.actions}>
          <button
            type="button"
            className={controls.btnPrimary}
            onClick={() => {
              window.location.reload();
            }}
          >
            再読み込み
          </button>
          <button
            type="button"
            className={controls.btn}
            onClick={this.handleExport}
            disabled={!hasStore}
            title={hasStore ? undefined : '退避できるデータがまだ読み込まれていません'}
          >
            JSONエクスポート（メモリ上のデータの退避）
          </button>
        </div>
      </div>
    );
  }
}
