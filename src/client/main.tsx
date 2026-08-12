import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

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
