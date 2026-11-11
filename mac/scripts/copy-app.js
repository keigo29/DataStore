// PWA の画面（../app）を Mac 版の中にコピーする。画面のコードは PWA と同じものを使う
const fs = require('fs');
const path = require('path');
// まず app/src から app/app.js を組み立てる（app.js は生成ファイル）
require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'build-app.js')], { stdio: 'inherit' });
const from = path.join(__dirname, '..', '..', 'app');
const to = path.join(__dirname, '..', 'app');
fs.rmSync(to, { recursive: true, force: true });
// sw.js・manifest は PWA だけ。app/src（app.js のもと）は入れない
fs.cpSync(from, to, { recursive: true, filter: src => !/(^|[\\/])(sw\.js|manifest\.webmanifest)$/.test(src) && path.relative(from, src).split(path.sep)[0] !== 'src' });
console.log('画面をコピーしました：', path.relative(process.cwd(), to));
