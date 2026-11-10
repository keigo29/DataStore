// Mac 版の中身（フォルダの読み書き・git の同期）のテスト。node test/backend.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Vault, Git } = require('../backend');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdws-'));
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString().trim();
const ok = (name, fn) => fn().then(() => console.log('✓', name)).catch(e => { console.error('✗', name, '\n', e); process.exitCode = 1; });

(async () => {
  // 送り先（GitHub の代わり）と、Mac・もう1台の2つの手元
  const remote = path.join(tmp, 'remote.git');
  sh(tmp, 'init', '--bare', '-b', 'main', remote);
  const mac = path.join(tmp, 'mac'), other = path.join(tmp, 'other');
  for (const d of [mac, other]) { sh(tmp, 'clone', remote, d); sh(d, 'config', 'user.email', 't@example.com'); sh(d, 'config', 'user.name', 'test'); sh(d, 'checkout', '-B', 'main'); }
  fs.mkdirSync(path.join(mac, '日記')); fs.mkdirSync(path.join(mac, '.obsidian'));
  fs.writeFileSync(path.join(mac, '日記', '2026-11-10.md'), '## やること\n- [ ] A\n');
  fs.writeFileSync(path.join(mac, '.obsidian', 'daily-notes.json'), '{"folder":"日記"}');
  fs.writeFileSync(path.join(mac, '.obsidian', 'hidden.md'), 'x');
  fs.writeFileSync(path.join(mac, 'image.png'), 'x');
  sh(mac, 'add', '-A'); sh(mac, 'commit', '-m', 'first'); sh(mac, 'push', '-u', 'origin', 'main');
  sh(other, 'pull', 'origin', 'main'); sh(other, 'branch', '--set-upstream-to=origin/main');

  const v = new Vault(mac), g = new Git(mac);

  await ok('.md だけを読む（.obsidian の中は読まない）・daily-notes.json は読む', async () => {
    const r = await v.scan();
    assert.deepStrictEqual(Object.keys(r.files), ['日記/2026-11-10.md']);
    assert.match(r.dailyJson, /日記/);
  });
  await ok('書く：印が合えば書き、違えば 409、同じ名前の新規は 422', async () => {
    const r = await v.scan();
    const f = r.files['日記/2026-11-10.md'];
    const sha = await v.write('日記/2026-11-10.md', '## やること\n- [x] A\n', f.sha);
    assert.ok(sha);
    await assert.rejects(v.write('日記/2026-11-10.md', 'z', 'old-sha'), e => e.status === 409);
    await assert.rejects(v.write('日記/2026-11-10.md', 'z', null), e => e.status === 422);
    await v.write('研修/新しいノート.md', '# 新しい\n', null);
    assert.ok(fs.existsSync(path.join(mac, '研修', '新しいノート.md')));
  });
  await ok('フォルダの外や .md 以外には書かない', async () => {
    for (const bad of ['../x.md', 'a/../../x.md', 'x.txt', '', '.md/..']) assert.throws(() => v.abs(bad));
    assert.ok(v.abs('/etc/x.md').startsWith(mac + path.sep));   // 先頭の / はフォルダの中として扱う
  });
  await ok('commit して push する', async () => {
    const r = await g.commitPush('完了: A');
    assert.ok(r.ok && r.committed && r.pushed, JSON.stringify(r));
    assert.strictEqual(sh(remote, 'log', '-1', '--format=%s', 'main'), '完了: A');
    const st = await g.status();
    assert.strictEqual(st.changed, 0); assert.strictEqual(st.ahead, 0); assert.strictEqual(st.branch, 'main');
  });
  await ok('もう1台の変更を取り込む', async () => {
    sh(other, 'pull');
    fs.writeFileSync(path.join(other, 'Inbox.md'), '- [ ] スマホから\n');
    sh(other, 'add', '-A'); sh(other, 'commit', '-m', 'from other'); sh(other, 'push');
    const r = await g.pull();
    assert.ok(r.ok && r.changed, JSON.stringify(r));
    assert.ok(fs.existsSync(path.join(mac, 'Inbox.md')));
  });
  await ok('push を断られたら、取り込んでから送り直す（別の行の変更）', async () => {
    fs.writeFileSync(path.join(other, 'Inbox.md'), '- [ ] スマホから\n- [ ] もう1つ\n');
    sh(other, 'commit', '-am', 'other 2'); sh(other, 'push');
    fs.writeFileSync(path.join(mac, '日記', '2026-11-10.md'), '## やること\n- [x] A\n- [ ] B\n');
    const r = await g.commitPush('やること: B');
    assert.ok(r.ok && r.pushed, JSON.stringify(r));
    sh(other, 'pull');
    assert.match(fs.readFileSync(path.join(other, '日記', '2026-11-10.md'), 'utf8'), /- \[ \] B/);
    assert.match(fs.readFileSync(path.join(mac, 'Inbox.md'), 'utf8'), /もう1つ/);
  });
  await ok('同じ行を両方で変えたら、上書きせずに知らせる（ファイルは残る）', async () => {
    fs.writeFileSync(path.join(other, 'Inbox.md'), '- [x] スマホから\n- [ ] もう1つ\n');
    sh(other, 'commit', '-am', 'other 3'); sh(other, 'push');
    fs.writeFileSync(path.join(mac, 'Inbox.md'), '- [ ] スマホから（Macで直した）\n- [ ] もう1つ\n');
    const r = await g.commitPush('Inbox を直した');
    assert.ok(!r.ok && r.error, JSON.stringify(r));
    assert.match(fs.readFileSync(path.join(mac, 'Inbox.md'), 'utf8'), /Macで直した/);
    assert.match(sh(mac, 'status', '--porcelain=2', '--branch'), /branch.head main/);    // rebase の途中で止まっていない
  });
  await ok('git でないフォルダでも動く（同期だけしない）', async () => {
    const plain = path.join(tmp, 'plain'); fs.mkdirSync(plain);
    const g2 = new Git(plain);
    assert.deepStrictEqual(await g2.status(), { repo: false });
    assert.ok((await g2.commitPush('x')).skipped);
  });
})();

// ---------- ノートの画面用の操作 ----------
(async () => {
  await new Promise(r => setTimeout(r, 1500));   // 上のテストのあと
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdws-ops-'));
  const v = new Vault(root);
  await v.write('A.md', '# A', null);
  await ok('画像を書いて読む・一覧に出る', async () => {
    await v.writeBin('画像/x.png', Buffer.from('PNG').toString('base64'));
    assert.strictEqual(await v.readBin('画像/x.png'), Buffer.from('PNG').toString('base64'));
    const r = await v.scan();
    assert.ok(r.bins['画像/x.png']); assert.ok(r.dirs.includes('画像'));
    await assert.rejects(v.writeBin('x.exe', 'AA'));
  });
  await ok('移す・消す・フォルダ', async () => {
    await v.mkdir('B'); await v.move('A.md', 'B/A2.md');
    assert.ok(fs.existsSync(path.join(root, 'B', 'A2.md')));
    await v.write('C.md', 'c', null);
    await assert.rejects(v.move('C.md', 'B/A2.md'), e => e.status === 422);
    await v.remove('C.md'); assert.ok(!fs.existsSync(path.join(root, 'C.md')));
    await v.rmdir('B'); assert.ok(!fs.existsSync(path.join(root, 'B')));
    assert.throws(() => v.absAny('../x.png')); assert.throws(() => v.absAny('.git/config'));
  });
})();
