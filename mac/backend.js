// Mac 版の中身：ローカルのフォルダの .md を読み書きし、git で自動同期する
// ・Electron に依存しないので、node だけでテストできる
// ・フォルダの外のファイルには触らない。.md 以外は書かない
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const MAX_FILES = 8000;
const skipDir = name => name.startsWith('.') || name === 'node_modules';

class Vault {
  constructor(root) { this.root = path.resolve(root); }
  // フォルダの中の場所（rel）→ 実際の場所。外へ出るもの・.md 以外は断る
  abs(rel) {
    const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some(s => s === '..' || s === '') || !/\.md$/i.test(clean)) throw new Error('この場所には書けません');
    const p = path.resolve(this.root, clean);
    if (!p.startsWith(this.root + path.sep)) throw new Error('フォルダの外には書けません');
    return p;
  }
  static shaOf(st) { return `${Math.round(st.mtimeMs)}-${st.size}`; }
  async list() {
    const out = [];
    const walk = async dir => {
      let ents = [];
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (out.length >= MAX_FILES) return;
        if (e.isDirectory()) { if (!skipDir(e.name)) await walk(path.join(dir, e.name)); }
        else if (e.isFile() && /\.md$/i.test(e.name)) out.push(path.relative(this.root, path.join(dir, e.name)).split(path.sep).join('/'));
      }
    };
    await walk(this.root);
    return out;
  }
  // 前に読んだもの（prev: rel → {sha, text}）と同じなら読み直さない
  async scan(prev = {}) {
    const rels = await this.list();
    const files = {};
    for (let i = 0; i < rels.length; i += 32) {      // 少しずつ読む
      await Promise.all(rels.slice(i, i + 32).map(async rel => {
        try {
          const p = path.join(this.root, rel);
          const st = await fsp.stat(p);
          const sha = Vault.shaOf(st);
          files[rel] = prev[rel] && prev[rel].sha === sha ? prev[rel] : { sha, text: await fsp.readFile(p, 'utf8') };
        } catch {}
      }));
    }
    let dailyJson = null;
    try { dailyJson = await fsp.readFile(path.join(this.root, '.obsidian', 'daily-notes.json'), 'utf8'); } catch {}
    return { files, dailyJson, truncated: rels.length >= MAX_FILES };
  }
  // expectSha：読んだときの印。ほかで書きかえられていたら書かない（409）
  async write(rel, text, expectSha) {
    const p = this.abs(rel);
    let cur = null;
    try { cur = Vault.shaOf(await fsp.stat(p)); } catch {}
    if (cur && expectSha && cur !== expectSha) { const e = new Error('ほかで書きかえられていました'); e.status = 409; throw e; }
    if (cur && !expectSha) { const e = new Error('同じ名前のノートがあります'); e.status = 422; throw e; }
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const tmp = p + '.mdws-tmp';
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, p);
    return Vault.shaOf(await fsp.stat(p));
  }
}

// ---------- git ----------
function run(cwd, args, timeout = 60000) {
  return new Promise(res => {
    execFile('git', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C' } },
      (err, stdout, stderr) => res({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() }));
  });
}

class Git {
  constructor(root) {
    this.root = root;
    this.queue = Promise.resolve();     // git は1つずつ
    this.lastPull = null; this.lastPush = null; this.error = null;
  }
  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }
  async isRepo() { const r = await run(this.root, ['rev-parse', '--show-toplevel']); return r.ok; }
  async status() {
    if (!(await this.isRepo())) return { repo: false };
    const [br, remote, dirty, ahead] = await Promise.all([
      run(this.root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      run(this.root, ['remote', 'get-url', 'origin']),
      run(this.root, ['status', '--porcelain', '--', '.']),
      run(this.root, ['rev-list', '--count', '@{u}..HEAD']),
    ]);
    return {
      repo: true, branch: br.ok ? br.out : '', remote: remote.ok ? remote.out.replace(/\/\/[^@/]+@/, '//') : '',
      changed: dirty.ok && dirty.out ? dirty.out.split('\n').length : 0, ahead: ahead.ok ? Number(ahead.out) || 0 : null,
      lastPull: this.lastPull, lastPush: this.lastPush, error: this.error,
    };
  }
  // 取り込む。ぶつかったら元に戻して知らせる（ファイルは消さない）
  pull() {
    return this.serial(async () => {
      if (!(await this.isRepo())) return { ok: false, skipped: true };
      if (!(await run(this.root, ['remote', 'get-url', 'origin'])).ok) return { ok: true, skipped: true };
      const r = await run(this.root, ['pull', '--rebase', '--autostash']);
      if (!r.ok) {
        await run(this.root, ['rebase', '--abort']);
        this.error = /could not read|Authentication|Permission denied|Could not resolve/i.test(r.err) ? 'GitHub につながりませんでした' : '取り込むときにぶつかりました（同じ行を両方で書きかえた？）';
        return { ok: false, error: this.error, detail: r.err };
      }
      this.lastPull = Date.now(); this.error = null;
      return { ok: true, changed: !/Already up to date|Current branch .* is up to date/i.test(r.out) };
    });
  }
  // 変わったものをまとめて commit して push。push を断られたら取り込んでからもう一度
  commitPush(message) {
    return this.serial(async () => {
      if (!(await this.isRepo())) return { ok: false, skipped: true };
      const st = await run(this.root, ['status', '--porcelain', '--', '.']);
      let committed = false;
      if (st.ok && st.out) {
        await run(this.root, ['add', '-A', '--', '.']);
        const c = await run(this.root, ['commit', '-m', message || 'ノートを更新']);
        if (!c.ok && !/nothing to commit/i.test(c.out + c.err)) { this.error = 'commit できませんでした（git の名前・メールの設定は？）'; return { ok: false, error: this.error, detail: c.err }; }
        committed = c.ok;
      }
      if (!(await run(this.root, ['remote', 'get-url', 'origin'])).ok) return { ok: true, committed, pushed: false };
      let p = await run(this.root, ['push']);
      if (!p.ok && /rejected|fetch first|non-fast-forward/i.test(p.err)) {
        const pl = await run(this.root, ['pull', '--rebase', '--autostash']);
        if (!pl.ok) { await run(this.root, ['rebase', '--abort']); this.error = 'GitHub の方が新しく、取り込むときにぶつかりました'; return { ok: false, error: this.error }; }
        this.lastPull = Date.now();
        p = await run(this.root, ['push']);
      }
      if (!p.ok && /no upstream|has no upstream/i.test(p.err)) p = await run(this.root, ['push', '-u', 'origin', 'HEAD']);
      if (!p.ok) { this.error = 'push できませんでした（GitHub につながらない？）'; return { ok: false, committed, error: this.error, detail: p.err }; }
      this.lastPush = Date.now(); this.error = null;
      return { ok: true, committed, pushed: true };
    });
  }
}

module.exports = { Vault, Git, run };
