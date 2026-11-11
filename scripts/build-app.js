#!/usr/bin/env node
// app/src/*.js を名前の順につなげて app/app.js を作る（PWA・Mac 版が読むのは app/app.js）
// ・app/src のファイルは、1つの大きな関数（(() => { … })();）の中身を、上から順に分けたもの。
//   はじめのファイルが「(() => {」で開き、最後のファイルが「})();」で閉じる。順番を変えないこと
// ・node scripts/build-app.js          … app/app.js を作る
// ・node scripts/build-app.js --check  … app/app.js が app/src と食いちがっていないかだけ見る（テスト・CI 用）
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'app', 'src');
const out = path.join(root, 'app', 'app.js');
const HEAD = '// ※ このファイルは app/src/ をつなげて作ったもの（npm run build）。直すときは app/src/ のほうを直してください\n';

function build() {
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
  if (!files.length) throw new Error('app/src にファイルがありません');
  return HEAD + files.map(f => { const t = fs.readFileSync(path.join(srcDir, f), 'utf8'); return t.endsWith('\n') ? t : t + '\n'; }).join('');
}

const text = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== text) {
    console.error('✗ app/app.js が app/src と食いちがっています。app/src を直して npm run build してください（app/app.js を直接直さない）');
    process.exit(1);
  }
  console.log('✓ app/app.js は app/src と同じです');
} else {
  fs.writeFileSync(out, text);
  console.log(`✓ app/app.js を作りました（${text.split('\n').length} 行）`);
}
