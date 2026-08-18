import { describe, expect, it } from 'vitest';

import {
  CAPTURE_CONTENT_ATTR,
  CAPTURE_ROOT_ATTR,
  CAPTURE_STICKY_ATTR,
  captureContentProps,
  captureRootProps,
  captureStickyProps,
  imageExportFileName,
  stickyTransform,
} from '../../src/client/imageExportModel';

// 画像出力の純ロジック（TASK-204 / US-012 / ui-timeline-grid.md 8章）。
// ファイル名 chronolines-<年表名>-<YYYYMMDD>.png と、キャプチャクローンでの
// sticky 補正量の計算を検証する。DOM キャプチャ本体は Playwright の実行時確認が受け持つ。

describe('imageExportFileName（chronolines-<年表名>-<YYYYMMDD>.png）', () => {
  it('年表名と日付から設計どおりのファイル名を作る', () => {
    expect(imageExportFileName('戦国年表', new Date(2026, 7, 18))).toBe(
      'chronolines-戦国年表-20260818.png',
    );
  });

  it('月・日は2桁ゼロ埋め（ローカル時刻）', () => {
    expect(imageExportFileName('年表1', new Date(2026, 0, 5))).toBe(
      'chronolines-年表1-20260105.png',
    );
  });

  it('1000年未満の年は4桁ゼロ埋め（exportFileName と同じ流儀）', () => {
    expect(imageExportFileName('平安', new Date(986, 5, 1))).toBe('chronolines-平安-09860601.png');
  });

  it('年表名の Windows 禁止文字（\\ / : * ? " < > |）は - に正規化する', () => {
    expect(imageExportFileName('a/b:c*d?e"f<g>h|i\\j', new Date(2026, 7, 18))).toBe(
      'chronolines-a-b-c-d-e-f-g-h-i-j-20260818.png',
    );
  });

  it('禁止文字を含まない名前はそのまま使う（空白・記号 . - _ は許容）', () => {
    expect(imageExportFileName('幕末 1853-1869_v2.1', new Date(2026, 7, 18))).toBe(
      'chronolines-幕末 1853-1869_v2.1-20260818.png',
    );
  });
});

describe('stickyTransform（クローン内での sticky 追従の再現）', () => {
  it('x: 横スクロール分だけ寄せる（人物列・コーナーセル）', () => {
    expect(stickyTransform('x', 350, 120)).toBe('translate(350px, 0px)');
  });

  it('y: 縦スクロール分だけ寄せる（年ヘッダー・イベントレーン）', () => {
    expect(stickyTransform('y', 350, 120)).toBe('translate(0px, 120px)');
  });

  it('xy: 両軸に追従する', () => {
    expect(stickyTransform('xy', 350, 120)).toBe('translate(350px, 120px)');
  });

  it('未スクロール（0, 0）でも恒等 translate を返す（適用しても無害）', () => {
    expect(stickyTransform('x', 0, 0)).toBe('translate(0px, 0px)');
  });

  it('未知の軸・属性なし（null）は補正しない', () => {
    expect(stickyTransform(null, 350, 120)).toBeNull();
    expect(stickyTransform('z', 350, 120)).toBeNull();
    expect(stickyTransform('', 350, 120)).toBeNull();
  });
});

describe('マーキング属性のスプレッド用ヘルパ（属性名の二重管理を防ぐ）', () => {
  it('captureRootProps / captureContentProps は定数の属性名をキーに持つ', () => {
    expect(captureRootProps).toEqual({ [CAPTURE_ROOT_ATTR]: 'true' });
    expect(captureContentProps).toEqual({ [CAPTURE_CONTENT_ATTR]: 'true' });
  });

  it('captureStickyProps は軸を値に持つ（stickyTransform が受理する語彙）', () => {
    expect(captureStickyProps('x')).toEqual({ [CAPTURE_STICKY_ATTR]: 'x' });
    expect(captureStickyProps('y')).toEqual({ [CAPTURE_STICKY_ATTR]: 'y' });
    expect(stickyTransform(captureStickyProps('y')[CAPTURE_STICKY_ATTR] ?? null, 1, 2)).not.toBeNull();
  });
});
