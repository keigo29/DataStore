// PWA の画面（../app）を Mac 版の中にコピーする。画面のコードは PWA と同じものを使う
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', '..', 'app');
const to = path.join(__dirname, '..', 'app');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true, filter: src => !/(^|[\\/])(sw\.js|manifest\.webmanifest)$/.test(src) });
console.log('画面をコピーしました：', path.relative(process.cwd(), to));
