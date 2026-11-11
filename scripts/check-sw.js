#!/usr/bin/env node
// sw.js（オフライン用に取っておくファイルの一覧）の点検
// ・一覧のファイルが全部あるか
// ・index.html が読む .js / .css が、一覧に入っているか（足し忘れるとオフラインで画面が壊れる）
const fs = require('fs');
const path = require('path');
const app = path.join(__dirname, '..', 'app');
const sw = fs.readFileSync(path.join(app, 'sw.js'), 'utf8');
const m = /const FILES = \[([\s\S]*?)\];/.exec(sw);
if (!m) { console.error('✗ sw.js に FILES が見つかりません'); process.exit(1); }
const files = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).filter(f => f !== './');
const bad = [];
for (const f of files) if (!fs.existsSync(path.join(app, f))) bad.push(`一覧にあるのにファイルがない：${f}`);
const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
for (const x of html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css))"/g)) if (!files.includes(x[1])) bad.push(`index.html が読むのに一覧にない：${x[1]}`);
if (!/const VERSION = 'ws-notes-v\d+'/.test(sw)) bad.push('VERSION の形がちがいます');
if (bad.length) { bad.forEach(b => console.error('✗ ' + b)); process.exit(1); }
console.log(`✓ sw.js の一覧はそろっています（${files.length} ファイル）`);
