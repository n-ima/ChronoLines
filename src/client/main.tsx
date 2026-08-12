import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// トークン → グローバルの順で読み込む（global.css がトークンを参照するため）
import './styles/tokens.css';
import './styles/global.css';
import { App } from './App';
import { useAppStore } from './store/appStore';

if (import.meta.env.DEV) {
  // 開発時のみ、機械確認（Playwright）がストアのミューテーションを直接呼べる窓口を開ける
  // （編集フォームは TASK-105 以降のため。本番ビルドには含まれない）
  (window as unknown as Record<string, unknown>)['__chronolines'] = { useAppStore };
}

const container = document.getElementById('root');
if (container === null) {
  // index.html と main.tsx の不整合はここで明示的に失敗させる（黙って白画面にしない）
  throw new Error('#root element not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
