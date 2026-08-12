// vite.config.ts の define で埋め込まれるビルド時定数。
// アプリ版数の正は package.json の version（server/index.ts と同じ方針。二重管理しない）
declare const __APP_VERSION__: string;
