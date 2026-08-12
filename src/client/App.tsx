import { AppShell } from './components/AppShell';

// アプリ本体はシェル（ロード状態切替・ルートエラー境界。ui-timeline-grid.md 1章・9章）に委譲する
export function App() {
  return <AppShell />;
}
