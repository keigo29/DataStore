// アイコンを作る（Mac 版・PWA・iPhone すべて同じデザイン）
//   node scripts/make-icons.js      ← リポジトリのいちばん上で実行（Chromium で描いて PNG にする。Mac でなくても作れる）
// デザイン：アプリの左上のロゴ（.railLogo .logo）と同じ
//   ・背景：--accent（#181818）に --gloss（左上の光：radial-gradient at 23% 0%）。Mac だけ、ふちにごくうすい白の線（--gloss-line）。スマホは OS が角を丸めるので線なし
//   ・しるし：4つのマス（左上だけ濃く、ほかはうすく）と、右下の丸い矢印。白
const { chromium } = require('playwright');
const path = require('path');

const MARK = '<rect x="4" y="4" width="7" height="7" rx="2" fill="#fff"/><rect x="13" y="4" width="7" height="7" rx="2" fill="#fff" opacity=".38"/><rect x="4" y="13" width="7" height="7" rx="2" fill="#fff" opacity=".38"/><path d="M16.5 13.6a2.9 2.9 0 1 1-2.9 2.9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>';

// mode：full（四角いっぱい。PWA・iPhone は OS が角を丸める）／ maskable（丸く切られても欠けないよう、しるしを小さめに）／ mac（Apple のテンプレート：1024 に 824 の角丸と影）
function html(mode, size) {
  const mac = mode === 'mac';
  const tile = mac ? size * 824 / 1024 : size, off = mac ? size * 100 / 1024 : 0;
  const radius = mac ? tile * 0.225 : 0;
  const mark = tile * (mode === 'maskable' ? 0.42 : 0.55);   // ロゴと同じ割合（40px の四角に 22px のしるし）。maskable は 80% の円の中に収める
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div style="position:absolute;left:${off}px;top:${off}px;width:${tile}px;height:${tile}px;border-radius:${radius}px;overflow:hidden;
  background:radial-gradient(111% 112% at 23% 0%, rgba(255,255,255,.28) 0%, rgba(255,255,255,0) 100%), #181818;
  box-shadow:${mac ? `0 ${size * 10 / 1024}px ${size * 24 / 1024}px rgba(0,0,0,.32), inset 0 0 0 ${Math.max(1, tile / 220)}px rgba(255,255,255,.22)` : 'none'};
  display:grid;place-items:center">
  <svg viewBox="0 0 24 24" width="${mark}" height="${mark}">${MARK}</svg>
</div></body></html>`;
}

(async () => {
  const root = path.join(__dirname, '..');
  const out = [
    ['full', 192, 'app/icons/icon-192.png'],
    ['full', 512, 'app/icons/icon-512.png'],
    ['maskable', 512, 'app/icons/icon-maskable-512.png'],
    ['full', 180, 'app/icons/apple-touch-icon.png'],
    ['mac', 1024, 'mac/build/icon.png'],
  ];
  const b = await chromium.launch();
  for (const [mode, size, file] of out) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(html(mode, size));
    await p.screenshot({ path: path.join(root, file), omitBackground: true });
    await p.close();
    console.log('✓', file);
  }
  await b.close();
})();
