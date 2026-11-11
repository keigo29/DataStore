// MD Workstation（PWA。Mac 版もこの画面を使う）
// GitHub の非公開リポジトリに置いたナレッジの Markdown から、
// やること・予定・今日のノートを出す。画面の部品は Workstation モバイル、ノートの見た目は Mac 版と同じ
(() => {
  const $ = s => document.querySelector(s);
  const icon = n => window.svgIcon(n);
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const todayKey = () => keyOf(new Date());
  const md = k => { const d = parseKey(k); return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; };
  const sd = k => { const d = parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameOf = p => p.split('/').pop().replace(/\.md$/i, '');
  const folderOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  function relDay(k) {
    const t = todayKey();
    if (k === t) return '今日';
    if (k === addDays(t, 1)) return '明日';
    if (k === addDays(t, -1)) return '昨日';
    return md(k);
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, content, onClick, label) {
    const b = el('button', cls);
    b.type = 'button';
    for (const c of [].concat(content ?? [])) { if (typeof c === 'string' && window.ICONS[c]) b.insertAdjacentHTML('beforeend', icon(c)); else b.append(c); }
    if (label) b.setAttribute('aria-label', label);
    if (onClick) b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
    return b;
  }
  function panelHead(ic, text, right) {
    const h = el('h3');
    h.innerHTML = icon(ic);
    h.append(text);
    if (right != null) { const r = el('span', 'right'); [].concat(right).forEach(x => r.append(x)); h.append(r); }
    return h;
  }
  const panel = (cls = '') => el('section', 'panel ' + cls);
  const noData = t => el('div', 'noData', t);

  // ---------- お知らせ ----------
  let toastTimer = null;
  function toast(msg, kind = '') {
    const t = $('#toast');
    t.className = kind;
    t.innerHTML = icon(kind === 'warn' ? 'triangle-alert' : 'circle-check');
    t.append(msg);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // ---------- 保存（IndexedDB） ----------
  const DB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('ws-notes', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    get(k) { return new Promise(res => { try { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(undefined); } }); },
    set(k, v) { return new Promise(res => { try { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; } catch { res(); } }); },
  };

  // ---------- 設定 ----------
  const CFG_KEY = 'ws-notes.config';
  let cfg = (() => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; } })();
  // Mac 版（Electron）では preload が window.mdws を用意する。あればローカルのフォルダ＋git を使う
  const desk = window.mdws || null;
  let deskSt = null;           // { folder, autoGit, git: { repo, branch, remote, changed, ahead, lastPull, lastPush, error }, pending }
  const connected = () => (desk ? !!(deskSt && deskSt.folder) : !!(cfg.owner && cfg.repo && cfg.token));
  const sourceName = () => (desk ? (deskSt?.folder || '').split('/').filter(Boolean).pop() || '' : cfg.repo || '');
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} };
  function applyTheme() {
    if (!cfg.theme || cfg.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = cfg.theme;
  }

  // ---------- データ ----------
  // files: path → { sha, text }。dailyJson: .obsidian/daily-notes.json の中身
  // files: .md（rel → { sha, text, mtime }）、bins: 画像など（rel → { sha }）、cfg: .obsidian の設定、dirs: フォルダ
  let S = { files: {}, dailyJson: null, cfg: {}, bins: {}, dirs: [], syncedAt: null, error: null };
  let dailyCfg = Daily.config(null);
  let items = [];
  let dayOf = new Map();          // path → その日（デイリーノートのとき）
  let tab = 'home';
  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let calSel = todayKey();
  let todoFilter = 'open', todoTag = null;
  let noteQuery = '';
  let noteTag = null;             // ノート一覧のカテゴリ（タグ）の絞り込み
  let showDays = 14;              // ノート一覧で見せる日数
  let note = null;                // 開いているノートの path
  let editing = false, draft = '';
  let syncing = false;

  function recompute() {
    dailyCfg = Daily.config(S.dailyJson);
    // daily-notes.json がないときは、「2026-11-10.md」のような名前のノートがいちばん多いフォルダをデイリーノートの場所にする
    if (!S.dailyJson) {
      const cnt = new Map();
      for (const p of Object.keys(S.files)) if (/(^|\/)\d{4}-\d{2}-\d{2}\.md$/.test(p)) { const f = folderOf(p); cnt.set(f, (cnt.get(f) || 0) + 1); }
      const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) dailyCfg = { ...dailyCfg, folder: best[0] };
    }
    // daily-notes.json がなく、2026/11/10/ のような日付フォルダがあるときは、その形にする
    if (!S.dailyJson && Object.keys(S.files).some(p => folderDay(p))) dailyCfg = { ...dailyCfg, folder: '', format: 'YYYY/MM/DD/[デイリー]' };
    dayOf = new Map();
    noteTags = new Map();
    items = [];
    for (const [p, f] of Object.entries(S.files)) {
      // その日のノート：デイリーノートの設定に合うもの ＋ 日付フォルダ（2026/11/10/…）の中のノートすべて
      const d = Daily.dateOf(p, dailyCfg) || folderDay(p);
      if (d) dayOf.set(p, d);
      noteTags.set(p, tagsOfNote(f.text));
      items.push(...MDParser.parse(p, f.text, d));
    }
    computeProjects();
  }
  // 2026/11/10/メモ.md のように、年/月/日 のフォルダに入っていれば、その日（'YYYY-MM-DD'）
  function folderDay(p) {
    const m = /(?:^|\/)(\d{4})\/(\d{1,2})\/(\d{1,2})\/[^/]+\.md$/i.exec(p);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? keyOf(d) : null;
  }
  // ノートのタグ（カテゴリ）：先頭のプロパティの tags ＋ 本文の #タグ
  let noteTags = new Map();
  function tagsOfNote(text) {
    const out = new Set();
    const { props, body } = splitFrontmatter(text);
    for (const pr of props || []) if (/^tags?$/i.test(pr.k)) pr.v.forEach(v => { const t = v.replace(/^#/, '').trim(); if (t) out.add(t); });
    let fence = false;
    for (const l of body.split('\n')) {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
      if (fence || /^#{1,6}\s/.test(l)) continue;
      for (const m of l.matchAll(/(^|[\s(（「、。])#([^\s#.,;:!?()[\]{}"'`、。「」（）<>]+)/g)) if (!/^\d+$/.test(m[2])) out.add(m[2]);
    }
    return [...out];
  }
  // その日のノート（その日のデイリーノートを先に）
  const dayFiles = k => Object.keys(S.files).filter(p => dayOf.get(p) === k).sort((a, b) => (a === dailyPathOf(k) ? -1 : b === dailyPathOf(k) ? 1 : a.localeCompare(b, 'ja')));
  const dayFolder = k => folderOf(dailyPathOf(k));
  const isMainDaily = p => dayOf.has(p) && p === dailyPathOf(dayOf.get(p));
  function fileChip(p) {
    const c = btn('fchip', [], () => openNote(p), nameOf(p));
    c.insertAdjacentHTML('beforeend', icon(isMainDaily(p) ? 'notebook-text' : 'file-text'));
    c.append(el('span', '', nameOf(p)));
    (noteTags.get(p) || []).slice(0, 3).forEach(t => c.append(el('i', '', '#' + t)));
    return c;
  }
  const dailyPathOf = k => Daily.pathOf(parseKey(k), dailyCfg);
  const byTime = (a, b) => ((a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0);
  const byDate = (a, b) => ((a.date || '9') === (b.date || '9') ? byTime(a, b) : (a.date || '9') < (b.date || '9') ? -1 : 1);

  // デモ（つなぐ前に見た目を確かめる用）
  function demo() {
    const t = todayKey(), d = n => addDays(t, n);
    const day = (n, name) => `${d(n).replace(/-/g, '/')}/${name}.md`;
    const f = text => ({ sha: 'demo', text });
    return {
      files: {
        [day(0, 'MTG メモ')]: f(`---\ntags: [仕事, ほのぼの書店]\n---\n## チームMTG\n- 注文画面は今週中\n- [ ] 決済のエラー表示を相談する [[ほのぼの書店]]\n`),
        [day(0, 'Docker の調べもの')]: f(`---\ntags: [勉強, docker]\n---\n- \`docker compose up -d\` で裏で動かす\n- ==ボリュームを消すと DB も消える==\n`),
        [day(0, 'デイリー')]: f(`## やること\n- [x] ほのぼの書店のデプロイ確認\n- [ ] プルリクのレビューを返す\n- [ ] [[Spring Boot メモ]]の続きを読む\n- [ ] API のエラー処理を直す [[ほのぼの書店]]\n\n## 予定\n- 10:00 朝会\n- 14:00-15:00 チームMTG #仕事\n\n## メモ\n> [!info] EC2\n> Tomcat が再起動後に上がらなかった → \`systemctl enable tomcat\` で解決\n`),
        [day(-1, 'デイリー')]: f(`## やること\n- [x] 資格の問題集 2章\n- [ ] 筋トレメモにグラフを足す\n`),
        'Inbox.md': f(`# Inbox\n\n- [ ] 資格の問題集 3章 @due(${d(3)}) #資格\n- [ ] ポートフォリオの README を書く #個人開発\n- [x] AWS の請求を確認 #仕事\n`),
        'Projects/ほのぼの書店.md': f(`---\ncolor: "#005cff"\nlinks:\n  - GitLab https://gitlab.com/\n  - 設計書 https://example.com/design\n---\nSpring Boot のグループ開発。EC2（Tomcat・MySQL）にデプロイする。\n\n## タスク\n- [x] 要件のまとめ 🛫 ${d(-9)} 📅 ${d(-6)}\n- [x] 画面設計 🛫 ${d(-5)} 📅 ${d(-2)}\n- [ ] 注文画面の実装 🛫 ${d(-1)} 📅 ${d(4)}\n- [ ] テスト 🛫 ${d(5)} 📅 ${d(9)}\n- [ ] 発表 📅 ${d(12)} #節目\n`),
        'Projects/資格の勉強.md': f(`---\ncolor: "#00c230"\n---\n基本情報技術者試験。\n\n## タスク\n- [x] 1章 🛫 ${d(-12)} 📅 ${d(-8)}\n- [ ] 2章 🛫 ${d(-7)} 📅 ${d(-1)}\n- [ ] 3章 🛫 ${d(0)} 📅 ${d(6)}\n- [ ] 試験日 📅 ${d(20)} #節目\n`),
        'Spring Boot メモ.md': f(`---\nproject: 研修\ntags: [java, spring]\n---\n## よく使うアノテーション\n- \`@RestController\` … JSON を返す\n- \`@Transactional\` … まとめてコミット／ロールバック\n\n## 予定\n### ${d(5)}\n- 13:00 Spring 勉強会（社内）\n- [ ] 勉強会の資料を準備 #仕事\n\n> [!tip] ==大事==\n> Bean のスコープは基本シングルトン\n`),
      },
      dailyJson: JSON.stringify({ folder: '', format: 'YYYY/MM/DD/[デイリー]' }),
    };
  }

  // ---------- GitHub ----------
  const encPath = p => p.split('/').map(encodeURIComponent).join('/');
  const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const textToB64 = txt => { const b = new TextEncoder().encode(txt); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const repoBase = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const branch = () => cfg.branch || 'main';
  async function gh(path, opts = {}) {
    const r = await fetch('https://api.github.com' + path, {
      ...opts, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!r.ok) { let msg = ''; try { msg = (await r.json()).message; } catch {} const e = new Error(`${r.status} ${msg}`); e.status = r.status; throw e; }
    return r.json();
  }
  async function pool(list, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
  }
  const ATTACH_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf)$/i;
  const ignored = p => p.split('/').some(s => s.startsWith('.')) || p.includes('node_modules/');
  async function pull() {
    if (desk) {
      const r = await desk.scan();
      if (r.error) { const e = new Error(r.error); e.status = 400; throw e; }
      // 印（sha）は「更新時刻-大きさ」。更新時刻をノートの「新しい順」に使う
      for (const f of Object.values(r.files)) f.mtime = parseInt(f.sha, 10) || 0;
      S = { files: r.files, dailyJson: r.dailyJson, cfg: r.cfg || {}, bins: r.bins || {}, dirs: r.dirs || [], isVault: r.isVault, syncedAt: Date.now(), error: null };
      if (r.truncated) toast('ファイルが多すぎて、一部しか読めていません', 'warn');
      return;
    }
    const tree = await gh(`${repoBase()}/git/trees/${encodeURIComponent(branch())}?recursive=1`);
    const pre = (cfg.prefix || '').replace(/^\/+|\/+$/g, '');
    const inPre = p => !pre || p === pre || p.startsWith(pre + '/');
    const strip = p => (pre ? p.slice(pre.length + 1) : p);
    const mine = tree.tree.filter(t => inPre(t.path) && strip(t.path));
    const blobs = mine.filter(t => t.type === 'blob' && /\.md$/i.test(t.path) && !ignored(strip(t.path)));
    const next = {};
    await pool(blobs, 6, async b => {
      const rel = strip(b.path);
      const old = S.files[rel];
      // まだ GitHub に送っていない書きかけ（ノートの画面）は、手元のものを残す
      if (old && (old.sha === b.sha || Bridge.pending(rel))) { next[rel] = old; return; }
      const blob = await gh(`${repoBase()}/git/blobs/${b.sha}`);
      next[rel] = { sha: b.sha, text: b64ToText(blob.content), mtime: old ? Date.now() : 0 };
    });
    for (const [rel, f] of Object.entries(S.files)) if (!next[rel] && Bridge.pending(rel)) next[rel] = f;
    // 画像など・フォルダ・Obsidian の設定
    const bins = {};
    for (const t of mine) if (t.type === 'blob' && ATTACH_RE.test(t.path) && !ignored(strip(t.path))) bins[strip(t.path)] = { sha: t.sha };
    const dirs = mine.filter(t => t.type === 'tree' && !ignored(strip(t.path))).map(t => strip(t.path));
    const cfgFiles = {};
    let isVault = false;
    await pool(['daily-notes.json', 'app.json', 'templates.json', 'appearance.json'], 4, async f => {
      const t = mine.find(x => x.type === 'blob' && strip(x.path) === '.obsidian/' + f);
      if (t) { isVault = true; try { cfgFiles[f] = (S.cfg?.[f + '#sha'] === t.sha && S.cfg[f]) || b64ToText((await gh(`${repoBase()}/git/blobs/${t.sha}`)).content); cfgFiles[f + '#sha'] = t.sha; } catch {} }
    });
    if (mine.some(t => strip(t.path) === '.obsidian')) isVault = true;
    S = { files: next, dailyJson: cfgFiles['daily-notes.json'] || null, cfg: cfgFiles, bins, dirs: [...new Set([...dirs, ...(S.dirs || []).filter(d => Bridge.virtualDir(d))])], isVault, syncedAt: Date.now(), error: null };
    if (tree.truncated) toast('ファイルが多すぎて、一部しか読めていません', 'warn');
  }
  const fullPath = rel => ((cfg.prefix || '').replace(/^\/+|\/+$/g, '') ? cfg.prefix.replace(/^\/+|\/+$/g, '') + '/' : '') + rel;
  async function putFile(rel, text, sha, message) {
    if (desk) {
      const r = await desk.write(rel, text, sha && sha !== 'demo' ? sha : null, message);
      if (r.error) { const e = new Error(r.error); e.status = r.status; throw e; }
      return r.sha;
    }
    const body = { message, content: textToB64(text), branch: branch() };
    if (sha) body.sha = sha;
    const res = await gh(`${repoBase()}/contents/${encPath(fullPath(rel))}`, { method: 'PUT', body: JSON.stringify(body) });
    return res.content.sha;
  }
  const persist = () => (!desk && connected() ? DB.set('snap:' + cfg.owner + '/' + cfg.repo + '@' + branch() + ':' + (cfg.prefix || ''), S) : Promise.resolve());

  async function sync(quiet) {
    if (syncing) return;
    syncing = true; render();
    try {
      if (!connected()) { S = { ...demo(), syncedAt: null, error: null }; }
      else if (desk) {
        // Mac 版：同期ボタンのときは git で取り込み・送ってから、フォルダを読み直す
        if (!quiet) { const r = await desk.sync(); deskSt = r; if (r.error) toast(r.error, 'warn'); else toast(r.git?.repo ? '同期しました' : '読み直しました'); }
        await pull();
      } else { await pull(); await persist(); if (!quiet) toast('同期しました'); }
    } catch (e) {
      // 404 は「リポジトリが見えない（トークンに入っていない・名前違い）」と「ブランチがない」を見分ける
      let why404 = 'リポジトリかブランチが見つかりません';
      if (e.status === 404 && !desk) {
        try { await gh(repoBase()); why404 = `ブランチ「${branch()}」が見つかりません。ブランチの名前を確かめてください`; }
        catch (e2) { if (e2.status === 404) why404 = `${cfg.owner}/${cfg.repo} が見えません。名前が合っているか、トークンの Repository access にこのリポジトリが入っているか（Contents は Read and write）を確かめてください`; }
      }
      S.error = e.status === 401 ? 'トークンが使えません（期限切れ・消した・貼り間違い）。トークンを作り直して貼ってください' : e.status === 403 ? 'トークンに読み書きの許可がありません（Contents を Read and write に）' : e.status === 404 ? why404 : 'つながりませんでした（オフライン？）';
      if (!quiet || e.status) toast(S.error, 'warn');
      console.error(e);
    } finally { syncing = false; recompute(); render(); Bridge.notify(null); }
  }

  // ファイルを書きかえて commit（失敗したら元に戻す）。fn(今の本文) → 新しい本文（変えないなら null）
  async function edit(rel, fn, message) {
    const f = S.files[rel];
    const before = f ? f.text : null;
    const next = fn(before);
    if (next == null || next === before) return false;
    const prev = f ? { ...f } : null;
    S.files[rel] = { sha: f ? f.sha : null, text: next, mtime: Date.now() };
    recompute(); render();
    if (!connected()) { S.files[rel].sha = S.files[rel].sha || 'demo'; Bridge.notify([rel]); return true; }
    try {
      S.files[rel].sha = await putFile(rel, next, prev && prev.sha, message);
      if (desk) S.files[rel].mtime = parseInt(S.files[rel].sha, 10) || Date.now();
      await persist();
      Bridge.notify([rel]);
      return true;
    } catch (e) {
      if (prev) S.files[rel] = prev; else delete S.files[rel];
      recompute(); render();
      if (e.status === 409 || e.status === 422) { toast('ほかで書きかえられていました。読み直します', 'warn'); sync(true); }
      else toast('保存できませんでした', 'warn');
      console.error(e);
      return false;
    }
  }
  // ================= ノートの画面（旧 Workstation の notes.js）とのつなぎ =================
  // 旧 Workstation の Mac 版 src/main/notes.js と同じ答えを、ここのデータ（GitHub／手元のフォルダ／お試し）で返す
  // ・スマホ版（GitHub）：書くたびに commit しないように、書くのが止まって少しあと（4秒）にまとめて送る
  // ・Mac 版：すぐフォルダに書く（commit・push は Mac 版の自動同期がまとめて行う）
  const Bridge = (() => {
    const WAIT = 4000;
    const timers = new Map();      // rel → 送るのを待っているタイマー（スマホ版）
    const vdirs = new Set();       // まだノートのないフォルダ（GitHub は空のフォルダを持てないので、この端末の中だけ）
    const listeners = [];
    const urls = new Map();        // 画像 rel → object URL
    const loading = new Set();
    const cleanName = x => String(x || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const baseName = rel => rel.split('/').pop().replace(/\.md$/i, '');
    const dirOf = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const unq = x => String(x).replace(/^["']|["']$/g, '').trim();
    const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); return { error: e.message || String(e) }; } };
    const err = m => { throw new Error(m); };

    // ---- Markdown から情報を取り出す（旧 Workstation と同じ） ----
    function parseFrontmatter(text) {
      const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
      if (!m) return { data: {}, body: text, quoted: [] };
      const data = {}, quoted = [];
      let key = null;
      for (const line of m[1].split(/\r?\n/)) {
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (item && key) { (Array.isArray(data[key]) ? data[key] : (data[key] = [])).push(unq(item[1])); continue; }
        const kv = /^([A-Za-z0-9_\-぀-ヿ一-鿿]+)\s*:\s*(.*)$/.exec(line);
        if (!kv) continue;
        key = kv[1];
        const v = kv[2].trim();
        if (!v) data[key] = [];
        else if (/^\[.*\]$/.test(v)) data[key] = v.slice(1, -1).split(',').map(x => unq(x.trim())).filter(Boolean);
        else { data[key] = unq(v); if (/^["'].*["']$/.test(v)) quoted.push(key); }
      }
      return { data, body: text.slice(m[0].length), quoted };
    }
    const stripCode = t => t.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ').replace(/`[^`\n]*`/g, ' ');
    function normUrl(u) { try { const x = new URL(String(u).trim()); if (!/^https?:$/.test(x.protocol)) return ''; return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); } catch { return ''; } }
    function parseNote(text) {
      const fm = parseFrontmatter(text);
      const body = stripCode(fm.body);
      const tags = new Set();
      for (const t of [].concat(fm.data.tags ?? fm.data.tag ?? [])) String(t).split(/[\s,]+/).filter(Boolean).forEach(x => tags.add(x.replace(/^#/, '')));
      for (const m of body.matchAll(/(^|[\s(（「、。,])#([^\s#.,;:!?()[\]{}"'`、。「」（）]+)/g)) if (!/^\d+$/.test(m[2])) tags.add(m[2]);
      const links = [], seenLink = new Set();
      for (const m of body.matchAll(/(!?)\[\[([^\]|#^\n]*)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) {
        const target = m[2].trim(), k = (m[1] ? '!' : '') + target;
        if (target && !seenLink.has(k)) { seenLink.add(k); links.push({ target, embed: !!m[1] }); }
      }
      const urls = [], seenUrl = new Set();
      const addUrl = (url, title = '') => { url = url.replace(/[.,;:!?]+$/, ''); const k = normUrl(url); if (!k || seenUrl.has(k) || urls.length >= 30) return; seenUrl.add(k); urls.push({ url, title: title.trim().slice(0, 80) }); };
      for (const m of body.matchAll(/(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g)) addUrl(m[2], m[1]);
      for (const m of body.matchAll(/https?:\/\/[^\s<>"'`)\]（）「」『』、。]+/g)) addUrl(m[0]);
      const h1 = /^#\s+(.+)$/m.exec(body);
      const excerpt = body.replace(/^#\s+.*$/m, '').replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, alias) => alias || t)
        .replace(/^>\s*\[![\w-]+\][+-]?/gm, '').replace(/^#{1,6}\s+/gm, '').replace(/<[^>]+>/g, ' ').replace(/[*_>`=~\[\]!|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      return { frontmatter: fm.data, fmQuoted: fm.quoted, tags: [...tags], links, urls, h1: h1 ? h1[1].trim() : '', excerpt };
    }
    function editListValues(text, key, fn) {
      const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
      const lines = m ? m[1].split(/\r?\n/) : [];
      const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`);
      let at = lines.findIndex(l => keyRe.test(l)), values = [], span = 0;
      if (at >= 0) {
        const v = keyRe.exec(lines[at])[1].trim(); span = 1;
        if (/^\[.*\]$/.test(v)) values = v.slice(1, -1).split(',').map(x => unq(x.trim())).filter(Boolean);
        else if (v) values = [unq(v)];
        else while (at + span < lines.length && /^\s*-\s+/.test(lines[at + span])) { values.push(unq(lines[at + span].replace(/^\s*-\s+/, ''))); span++; }
      }
      const nx = fn(values);
      if (!nx) return text;
      const q = v => (/[:#[\]{},]|^\s|\s$/.test(v) ? JSON.stringify(v) : v);
      const block = !nx.length ? [] : nx.length === 1 ? [`${key}: ${q(nx[0])}`] : [`${key}:`, ...nx.map(v => `  - ${q(v)}`)];
      if (at >= 0) lines.splice(at, span, ...block); else lines.push(...block);
      const body = m ? text.slice(m[0].length) : text;
      if (!lines.some(l => l.trim())) return body;
      return `---\n${lines.join('\n')}\n---\n` + body;
    }

    // ---- 一覧 ----
    const cache = new Map();   // rel → { text, info }
    function infoOf(rel) {
      const f = S.files[rel];
      let c = cache.get(rel);
      if (!c || c.text !== f.text) { c = { text: f.text, info: parseNote(f.text) }; cache.set(rel, c); }
      return c.info;
    }
    const mtimeOf = rel => { const f = S.files[rel]; if (f?.mtime) return f.mtime; const d = dayOf.get(rel); return d ? parseKey(d).getTime() + 12 * 3600e3 : 1; };
    function entry(rel) {
      if (!S.files[rel]) return null;
      const f = S.files[rel];
      return { path: rel, name: baseName(rel), folder: dirOf(rel), mtime: mtimeOf(rel), ctime: mtimeOf(rel), size: f.text.length, day: dayOf.get(rel) && isMainDaily(rel) ? dayOf.get(rel) : null, ...infoOf(rel) };
    }
    function folders() {
      const set = new Set([...(S.dirs || []), ...vdirs]);
      for (const p of [...Object.keys(S.files), ...Object.keys(S.bins || {})]) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/')); }
      return [...set].filter(d => d && !d.split('/').some(x => x.startsWith('.'))).sort();
    }
    const notesList = () => Object.keys(S.files);
    function resolve(target, from = '') {
      const t = String(target || '').trim().replace(/\.md$/i, '');
      if (!t) return null;
      const ns = notesList();
      if (t.includes('/')) { const w = (t + '.md').toLowerCase(); return ns.find(n => n.toLowerCase() === w) || ns.find(n => n.toLowerCase().endsWith('/' + w)) || null; }
      const hits = ns.filter(n => baseName(n).toLowerCase() === t.toLowerCase());
      if (hits.length <= 1) return hits[0] || null;
      return hits.find(n => dirOf(n) === dirOf(from)) || hits.sort((a, b) => a.length - b.length)[0];
    }
    function checkRel(rel, md = true) {
      const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!r || r.split('/').some(x => x === '..' || x === '' || x.startsWith('.'))) err('この場所は使えません');
      if (md && !/\.md$/i.test(r)) err('ノートは .md ファイルだけです');
      return r;
    }
    function uniquePath(folder, name) {
      const base = cleanName(name) || '無題のノート';
      for (let i = 0; i < 1000; i++) { const rel = (folder ? folder + '/' : '') + base + (i ? ' ' + i : '') + '.md'; if (!S.files[rel]) return rel; }
      err('ファイル名を決められませんでした');
    }

    // ---- 書く・消す・移す（ここで GitHub／フォルダに反映する） ----
    async function flush(rel) {
      const t = timers.get(rel);
      if (!t) return;
      clearTimeout(t); timers.delete(rel);
      await pushNow(rel);
    }
    async function flushAll() { await Promise.all([...timers.keys()].map(flush)); }
    async function pushNow(rel) {
      const f = S.files[rel];
      if (!f || !connected()) return;
      try {
        const sha = await putFile(rel, f.text, f.sha && f.sha !== 'demo' ? f.sha : null, `ノート: ${baseName(rel)}`);
        if (S.files[rel] === f) f.sha = sha;
        await persist();
      } catch (e) {
        console.error(e);
        toast(e.status === 409 || e.status === 422 ? `「${baseName(rel)}」はほかで書きかえられていました。同期してから書き直してください` : `「${baseName(rel)}」を GitHub に送れませんでした`, 'warn');
      }
    }
    // 書く（新しく作るときも）。now = すぐ送る
    async function putText(rel, text, now) {
      const old = S.files[rel];
      S.files[rel] = { sha: old ? old.sha : null, text, mtime: Date.now() };
      recompute();
      if (!connected()) { S.files[rel].sha = S.files[rel].sha || 'demo'; return; }
      if (desk) {
        const sha = await putFile(rel, text, old ? old.sha : null, `ノート: ${baseName(rel)}`);
        S.files[rel].sha = sha; S.files[rel].mtime = parseInt(sha, 10) || Date.now();
        return;
      }
      clearTimeout(timers.get(rel));
      if (now || !old) { timers.delete(rel); await pushNow(rel); }
      else timers.set(rel, setTimeout(() => { timers.delete(rel); pushNow(rel); }, WAIT));
      persist();
    }
    async function delFile(rel, msg) {
      await flush(rel);
      const f = S.files[rel] || S.bins?.[rel];
      if (!f) return;
      if (connected()) {
        if (desk) { const r = await desk.remove(rel, msg); if (r.error) err(r.error); }
        else await gh(`${repoBase()}/contents/${encPath(fullPath(rel))}`, { method: 'DELETE', body: JSON.stringify({ message: msg || `削除: ${rel}`, sha: f.sha, branch: branch() }) });
      }
      delete S.files[rel]; if (S.bins) delete S.bins[rel];
      cache.delete(rel);
      recompute(); persist();
    }
    async function moveFile(from, to, msg) {
      if (from === to) return;
      await flush(from);
      const isMd = /\.md$/i.test(from);
      if ((isMd ? S.files[to] : S.bins?.[to]) && from.toLowerCase() !== to.toLowerCase()) err(`「${to.split('/').pop()}」はもうあります`);
      if (connected() && desk) {
        const r = await desk.move(from, to, msg); if (r.error) err(r.error);
        if (isMd) { S.files[to] = S.files[from]; delete S.files[from]; } else { S.bins[to] = S.bins[from]; delete S.bins[from]; }
      } else if (isMd) {
        const f = S.files[from];
        S.files[to] = { sha: null, text: f.text, mtime: Date.now() };
        if (connected()) { S.files[to].sha = await putFile(to, f.text, null, msg || `移動: ${from} → ${to}`); }
        else S.files[to].sha = 'demo';
        delete S.files[from];
        if (connected()) await gh(`${repoBase()}/contents/${encPath(fullPath(from))}`, { method: 'DELETE', body: JSON.stringify({ message: msg || `移動: ${from} → ${to}`, sha: f.sha, branch: branch() }) });
      } else {
        // 画像（GitHub）：中身を読んで、新しい場所に書いてから消す
        const b = S.bins[from];
        if (connected()) {
          const blob = await gh(`${repoBase()}/git/blobs/${b.sha}`);
          const res = await gh(`${repoBase()}/contents/${encPath(fullPath(to))}`, { method: 'PUT', body: JSON.stringify({ message: msg || `移動: ${from} → ${to}`, content: blob.content.replace(/\s/g, ''), branch: branch() }) });
          await gh(`${repoBase()}/contents/${encPath(fullPath(from))}`, { method: 'DELETE', body: JSON.stringify({ message: msg || `移動: ${from} → ${to}`, sha: b.sha, branch: branch() }) });
          S.bins[to] = { sha: res.content.sha };
        } else S.bins[to] = b;
        delete S.bins[from];
        if (urls.has(from)) { urls.set(to, urls.get(from)); urls.delete(from); }
      }
      cache.delete(from);
      recompute(); persist();
    }
    async function mkdirReal(rel) {
      if (connected() && desk) { const r = await desk.mkdir(rel); if (r.error) err(r.error); S.dirs = [...new Set([...(S.dirs || []), rel])]; }
      else vdirs.add(rel);
    }
    // 中のノート・画像をまとめて移す（フォルダの名前を変える・移す）
    async function moveTree(from, to, msg) {
      const all = [...Object.keys(S.files), ...Object.keys(S.bins || {})].filter(p => p.startsWith(from + '/'));
      if (connected() && desk) {
        const r = await desk.move(from, to, msg); if (r.error) err(r.error);
        for (const p of all) { const q = to + p.slice(from.length); if (S.files[p]) { S.files[q] = S.files[p]; delete S.files[p]; } else { S.bins[q] = S.bins[p]; delete S.bins[p]; } }
        S.dirs = (S.dirs || []).map(d => (d === from || d.startsWith(from + '/') ? to + d.slice(from.length) : d));
      } else {
        for (const p of all) await moveFile(p, to + p.slice(from.length), msg);
        for (const d of [...vdirs]) if (d === from || d.startsWith(from + '/')) { vdirs.delete(d); vdirs.add(to + d.slice(from.length)); }
        S.dirs = (S.dirs || []).filter(d => !(d === from || d.startsWith(from + '/')));
        vdirs.add(to);
      }
      recompute(); persist();
    }
    // 名前を変える：ほかのノートの [[古い名前]] も書きかえる（旧 Workstation と同じ）
    async function rename(rel, newName, newFolder) {
      rel = checkRel(rel);
      if (!S.files[rel]) err('ノートが見つかりません');
      const folder = newFolder ?? dirOf(rel);
      const name = cleanName(newName);
      if (!name) err('名前を入れてください');
      const to = (folder ? folder + '/' : '') + name + '.md';
      if (to === rel) return { path: rel, updated: 0 };
      const before = notesList();
      const edits = [];
      for (const n of before) {
        if (n === rel) continue;
        let changed = false;
        const nx = S.files[n].text.replace(/(!?\[\[)([^\]|#^\n]+)((?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\])/g, (all, open, target, rest) => {
          if (resolve(target, n) !== rel) return all;
          changed = true;
          return open + (target.includes('/') ? to.replace(/\.md$/i, '') : name) + rest;
        });
        if (changed) edits.push([n, nx]);
      }
      await moveFile(rel, to, `名前を変更: ${rel} → ${to}`);
      for (const [n, nx] of edits) await putText(n, nx, true);
      return { path: to, updated: edits.length };
    }

    // ---- 画像 ----
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', pdf: 'application/pdf' };
    const b64ToBlob = (b64, rel) => new Blob([Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0))], { type: MIME[rel.split('.').pop().toLowerCase()] || 'application/octet-stream' });
    const bufToB64 = buf => { const b = new Uint8Array(buf); let s2 = ''; for (let i = 0; i < b.length; i += 0x8000) s2 += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s2); };
    function fileUrl(rel) {
      if (urls.has(rel)) return urls.get(rel);
      if (!loading.has(rel) && connected() && S.bins?.[rel]) {
        loading.add(rel);
        (async () => {
          try {
            const b64 = desk ? (await desk.readBin(rel)).value : (await gh(`${repoBase()}/git/blobs/${S.bins[rel].sha}`)).content;
            const u = URL.createObjectURL(b64ToBlob(b64, rel));
            urls.set(rel, u);
            document.querySelectorAll('img[data-vault]').forEach(im => { if (im.dataset.vault === rel) im.src = u; });
          } catch (e) { console.error(e); } finally { loading.delete(rel); }
        })();
      }
      return 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    }
    function attachmentFolder(noteRel = '') {
      let c = {}; try { c = JSON.parse(S.cfg?.['app.json'] || '{}') || {}; } catch {}
      const p = String(c.attachmentFolderPath ?? '/').trim(), nd = dirOf(noteRel || 'x');
      let f;
      if (!p || p === '/') f = ''; else if (p === '.' || p === './') f = nd; else if (p.startsWith('./')) f = [nd, p.slice(2)].filter(Boolean).join('/'); else f = p;
      return f.replace(/^\/+|\/+$/g, '').replace(/^\.$/, '');
    }
    async function saveImage(noteRel, name, bytes) {
      const ext = (String(name || '').split('.').pop() || 'png').toLowerCase();
      if (!/^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(ext)) err('画像（png・jpg・gif・webp・svg など）だけ入れられます');
      if (bytes.byteLength > 20 * 1024 * 1024) err('画像が大きすぎます（20MB まで）');
      const base = cleanName(String(name || '').replace(/\.[^.]+$/, '')) || 'Pasted image';
      const folder = attachmentFolder(noteRel);
      let rel = (folder ? folder + '/' : '') + base + '.' + ext;
      for (let i = 1; S.bins?.[rel]; i++) rel = (folder ? folder + '/' : '') + `${base} ${i}.${ext}`;
      const b64 = bufToB64(bytes);
      S.bins = S.bins || {};
      if (connected()) {
        if (desk) { const r = await desk.writeBin(rel, b64, `画像: ${rel}`); if (r.error) err(r.error); S.bins[rel] = { sha: r.value }; }
        else { const res = await gh(`${repoBase()}/contents/${encPath(fullPath(rel))}`, { method: 'PUT', body: JSON.stringify({ message: `画像: ${rel}`, content: b64, branch: branch() }) }); S.bins[rel] = { sha: res.content.sha }; }
      } else S.bins[rel] = { sha: 'demo' };
      urls.set(rel, URL.createObjectURL(b64ToBlob(b64, rel)));
      persist();
      const fname = rel.split('/').pop();
      const same = Object.keys(S.bins).filter(f => f.split('/').pop().toLowerCase() === fname.toLowerCase()).length;
      return { path: rel, link: same > 1 ? rel : fname };
    }
    const pickFiles = () => new Promise(res => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.addEventListener('change', () => res([...inp.files]));
      inp.click();
    });

    // ---- 本文の検索 ----
    function search(query, { matchCase = false, maxFiles = 200, perFile = 50 } = {}) {
      const q = String(query || '');
      if (!q.trim()) return { files: [], total: 0, more: false };
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
      const files = [];
      let total = 0;
      for (const rel of notesList()) {
        const text = S.files[rel].text || '';
        const hits = [];
        let count = 0, lineNo = 0, lineStart = 0, m;
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
          if (!m[0]) { re.lastIndex++; continue; }
          count++;
          if (hits.length >= perFile) continue;
          for (let i = text.indexOf('\n', lineStart); i !== -1 && i < m.index; i = text.indexOf('\n', lineStart)) { lineNo++; lineStart = i + 1; }
          const end = text.indexOf('\n', m.index);
          const line = text.slice(lineStart, end === -1 ? text.length : end);
          const col = m.index - lineStart, from = Math.max(0, col - 24);
          hits.push({ offset: m.index, line: lineNo, col, len: m[0].length, before: (from > 0 ? '…' : '') + line.slice(from, col).trimStart(), match: m[0], after: line.slice(col + m[0].length, col + m[0].length + 80) });
        }
        if (!count) continue;
        total += count;
        files.push({ path: rel, name: baseName(rel), folder: dirOf(rel), mtime: mtimeOf(rel), count, hits });
      }
      files.sort((a, b) => b.mtime - a.mtime);
      return { files: files.slice(0, maxFiles), total, more: files.length > maxFiles };
    }

    // ---- Obsidian の設定 ----
    function obsidianConfig() {
      const read = f => { try { return JSON.parse(S.cfg?.[f] || 'null'); } catch { return null; } };
      const tpl = read('templates.json') || {};
      let tf = String(tpl.folder || '').replace(/^\/+|\/+$/g, '');
      if (!tf && folders().includes('Templates')) tf = 'Templates';
      return { isVault: !!S.isVault || !!S.dailyJson, daily: { folder: dailyCfg.folder, format: dailyCfg.format, template: dailyCfg.template }, templatesFolder: tf, snippets: [] };
    }

    // ---- 旧 Workstation と同じ形の窓口（ctx.api.notes） ----
    const notes = {
      info: async () => ({ ready: true, root: connected() ? (desk ? deskSt?.folder || '' : `${cfg.owner}/${cfg.repo}`) : 'お試し', ...obsidianConfig() }),
      list: async () => ({ root: '', notes: notesList().map(entry).filter(Boolean), files: Object.keys(S.bins || {}), folders: folders() }),
      entries: async rels => [].concat(rels || []).map(r => ({ path: r, entry: entry(r) })),
      read: safe(async rel => { rel = checkRel(rel); const f = S.files[rel]; if (!f) err('ノートが見つかりません'); return { path: rel, text: f.text, mtime: mtimeOf(rel) }; }),
      search: safe(async (q, opt) => search(q, opt)),
      write: safe(async (rel, text, opt = {}) => {
        rel = checkRel(rel);
        if (opt.expectMtime != null && S.files[rel] && Math.abs(mtimeOf(rel) - opt.expectMtime) > 1) return { conflict: true, mtime: mtimeOf(rel) };
        await putText(rel, String(text));
        return { mtime: mtimeOf(rel), entry: entry(rel) };
      }),
      create: safe(async (folder = '', name = '', text = '') => { const rel = uniquePath(folder, name); await putText(rel, text, true); return { path: rel }; }),
      mkdir: safe(async rel => { rel = checkRel(rel, false); await mkdirReal(rel); return { path: rel }; }),
      rename: safe(rename),
      remove: safe(async rel => { await delFile(checkRel(rel), `削除: ${rel}`); return true; }),
      setProject: safe(async (rel, name, add) => {
        const t = S.files[rel]?.text ?? err('ノートが見つかりません');
        const nx = editListValues(t, 'project', vals => (vals.includes(String(name)) === !!add ? null : add ? [...vals, String(name)] : vals.filter(v => v !== String(name))));
        if (nx !== t) await putText(rel, nx, true);
        return { changed: nx !== t };
      }),
      move: safe(async (rel, folder) => rename(rel, baseName(rel), folder || '')),
      moveFolder: safe(async (rel, parent) => {
        parent = parent || '';
        if (parent === rel || parent.startsWith(rel + '/')) err('フォルダを自分の中には移動できません');
        const to = (parent ? parent + '/' : '') + rel.split('/').pop();
        if (to === rel) return { path: rel };
        if (folders().includes(to)) err(`「${parent || 'いちばん上'}」にはもう「${rel.split('/').pop()}」があります`);
        await moveTree(rel, to, `フォルダを移動: ${rel} → ${to}`);
        return { path: to };
      }),
      renameFolder: safe(async (rel, newName) => {
        const name = cleanName(newName); if (!name) err('名前を入れてください');
        const to = (dirOf(rel) ? dirOf(rel) + '/' : '') + name;
        if (to === rel) return { path: rel };
        if (folders().includes(to)) err(`「${name}」はもうあります`);
        await moveTree(rel, to, `フォルダの名前を変更: ${rel} → ${to}`);
        return { path: to };
      }),
      removeFolder: safe(async rel => {
        const all = [...Object.keys(S.files), ...Object.keys(S.bins || {})].filter(p => p.startsWith(rel + '/'));
        if (connected() && desk) { const r = await desk.rmdir(rel, `フォルダを削除: ${rel}`); if (r.error) err(r.error); for (const p of all) { delete S.files[p]; delete S.bins[p]; } }
        else for (const p of all) await delFile(p, `フォルダを削除: ${rel}`);
        for (const d of [...vdirs]) if (d === rel || d.startsWith(rel + '/')) vdirs.delete(d);
        S.dirs = (S.dirs || []).filter(d => !(d === rel || d.startsWith(rel + '/')));
        recompute(); persist();
        return true;
      }),
      daily: safe(async () => {
        const k = todayKey(), rel = dailyPathOf(k);
        if (S.files[rel]) return { path: rel, created: false };
        await putText(rel, newDailyText(k), true);
        return { path: rel, created: true };
      }),
      resolve: async (t, from) => resolve(t, from),
      saveImage: safe(saveImage),
      pickImage: safe(async noteRel => { const fs2 = await pickFiles(); const items = []; for (const f of fs2.slice(0, 20)) items.push(await saveImage(noteRel, f.name, await f.arrayBuffer())); return { items }; }),
      choose: async () => { if (desk) { deskSt = await desk.chooseFolder(); await sync(true); return notes.info(); } switchTab('sync'); return null; },
      useDefault: async () => ({ error: '「同期」から GitHub につなぐか、Mac 版でフォルダを選んでください' }),
    };
    if (desk) { notes.reveal = rel => desk.reveal(rel); notes.openInObsidian = rel => desk.openInObsidian(rel); }

    const SET_KEY = 'ws-notes.ntSettings';
    let onSet = () => {};
    let settings = (() => { try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch { return {}; } })();
    const api = {
      notes,
      // 変えたら描き直す（書く⇔読む・右のパネルなど、設定を変えるだけのボタンが効くように）
      settings: { set: async o => { settings = { ...settings, ...o }; try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch {} onSet(); return settings; } },
      app: {
        openUrl: u => { try { const x = new URL(String(u)); if (!/^https?:$/.test(x.protocol)) return; if (desk) desk.openExternal(x.href); else window.open(x.href, '_blank', 'noopener'); } catch {} },
        copy: t => navigator.clipboard?.writeText(String(t)),
      },
      on: { notes: cb => listeners.push(cb) },
    };
    return {
      api, fileUrl, flushAll,
      get settings() { return settings; },
      set onSettings(fn) { onSet = fn; },
      pending: rel => timers.has(rel),
      virtualDir: d => vdirs.has(d),
      notify: files => { for (const cb of listeners) { try { cb({ files }); } catch (e) { console.error(e); } } },
    };
  })();
  // 閉じる・ほかのアプリに切りかえるときは、待っている分をすぐ送る
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Promise.resolve(window.NotesApp?.flush?.()).catch(() => {}).then(() => Bridge.flushAll()); });
  window.addEventListener('pagehide', () => { Promise.resolve(window.NotesApp?.flush?.()).catch(() => {}).then(() => Bridge.flushAll()); });

  function setDone(it, done) {
    edit(it.path, t => (t == null ? null : MDParser.toggle(t, it.line, it.raw, done)), `${done ? '完了' : '未完了'}: ${it.title}`)
      .then(ok => { if (ok && done && navigator.vibrate) navigator.vibrate(12); });
  }
  // 今日のノートを作る（デイリーノートの設定・テンプレートを使う）
  function newDailyText(k) {
    const rel = dailyPathOf(k);
    const tp = Daily.findTemplate(dailyCfg, Object.keys(S.files));
    return tp ? Daily.fill(S.files[tp].text, parseKey(k), rel, dailyCfg) : '';
  }
  async function addTodoTo(k, v) {
    const rel = dailyPathOf(k);
    const ok = await edit(rel, t => MDParser.addTodo(t == null ? newDailyText(k) : t, v), `やること: ${v}`);
    if (ok) toast(`${relDay(k)}のノートに足しました`);
  }
  async function createDaily(k) {
    const rel = dailyPathOf(k);
    if (!S.files[rel]) await edit(rel, () => newDailyText(k) || `# ${nameOf(rel)}\n`, `ノートを作成: ${rel}`);
    openNote(rel);
  }

  // ---------- 共通の部品 ----------
  // やること1行（Workstation モバイルのタスクの行と同じ形）
  function todoRow(it, opt = {}) {
    const today = todayKey();
    const r = el('div', 'trow' + (it.done ? ' done' : ''));
    r.style.setProperty('--c', 'var(--accent)');
    const ck = btn('tchk' + (it.done ? ' on' : ''), 'check', () => setDone(it, !it.done), it.done ? 'まだにする' : '完了にする');
    const ttl = btn('ttl', [], () => openItem(it));
    const nm = el('b');
    if (it.time) nm.append(el('span', 'tm', it.time));
    nm.append(it.title);
    ttl.append(nm);
    const meta = el('small');
    const pj = it.project && projByPath(it.project);
    if (pj && !opt.inProj) { const d = el('i', 'pdot'); d.style.background = pj.color; meta.append(d, pj.name); }
    else if (!pj || it.path !== it.project) {
      meta.insertAdjacentHTML('beforeend', icon(dayOf.has(it.path) ? 'notebook-text' : 'file-text'));
      meta.append(isMainDaily(it.path) ? `${sd(dayOf.get(it.path))}のノート` : nameOf(it.path));
    }
    const sep = () => (meta.childNodes.length ? ' ・ ' : '');
    if (it.start && !it.done) meta.append(`${sep()}${sd(it.start)}〜`);
    if (it.milestone) meta.append(el('span', 'tagc', '節目'));
    if (!opt.noDate && it.date && it.date !== dayOf.get(it.path)) meta.append(`${it.start && !it.done ? '' : sep()}${relDay(it.date)}`);
    it.tags.filter(t => t !== '予定' && t !== '節目').slice(0, 2).forEach(t => meta.append(el('span', 'tagc', '#' + t)));
    if (!it.done && it.date && it.date < today) meta.append(el('em', 'bad', '期限切れ'));
    ttl.append(meta);
    r.append(ck, ttl);
    return r;
  }
  // 予定1行（カレンダーの「作業計画」と同じ形）
  function planRow(it, opt = {}) {
    const r = btn('plan', [], () => openItem(it));
    r.append(el('time', '', it.time ? (it.endTime ? `${it.time}–${it.endTime}` : it.time) : '終日'), el('i', 'pl'));
    const tx = el('span', 'ptx');
    tx.append(el('b', '', it.title));
    if (opt.showDate) tx.append(el('small', '', relDay(it.date)));
    r.append(tx);
    if (it.type === 'todo') r.classList.add('isTodo');
    return r;
  }

  // ---------- 下から出るシート ----------
  const sheet = $('#sheet');
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  function sheetHead(inn, title) {
    inn.innerHTML = '';
    inn.append(el('div', 'grab'));
    const hd = el('div', 'shHead');
    hd.append(el('h3', '', title), btn('iconBtn plain', 'x', () => sheet.close(), '閉じる'));
    inn.append(hd);
  }
  function openItem(it) {
    if (it.type === 'event') return newEvent(it.date, { item: it });
    const inn = $('#sheetIn');
    sheetHead(inn, it.type === 'todo' ? 'やること' : '予定');
    inn.append(el('div', 'itTitle' + (it.done ? ' done' : ''), it.title));
    const chips = el('div', 'itChips');
    if (it.date) chips.append(el('span', 'chip' + (it.type === 'todo' && !it.done && it.date < todayKey() ? ' bad' : ''), relDay(it.date)));
    if (it.start) chips.prepend(el('span', 'chip', `開始 ${sd(it.start)}`));
    if (it.time) chips.append(el('span', 'chip', it.endTime ? `${it.time}–${it.endTime}` : it.time));
    if (it.milestone) chips.append(el('span', 'chip', '節目'));
    it.tags.forEach(t => chips.append(el('span', 'chip', '#' + t)));
    if (chips.childElementCount) inn.append(chips);
    const src = el('div', 'tnote');
    src.textContent = it.raw.trim();
    inn.append(el('div', 'sub', `${it.path}（${it.line + 1}行目）${it.section ? ' ・ ' + it.section : ''}`), src);
    const bs = el('div', 'shBtns');
    const pj = it.project && projByPath(it.project);
    if (pj) bs.append(btn('btn', ['folder-kanban', pj.name], () => { sheet.close(); proj = pj.path; tab = 'proj'; render(); window.scrollTo(0, 0); }));
    bs.append(btn('btn', ['file-text', 'ノートを開く'], () => { sheet.close(); openNote(it.path); }));
    if (it.type === 'todo') bs.append(btn('btn primary', [it.done ? 'x' : 'check', it.done ? 'まだにする' : '完了にする'], () => { sheet.close(); setDone(it, !it.done); }));
    inn.append(bs);
    sheet.showModal();
  }

  // 1行の文から予定を読む。日付（今日・明日・あさって・11/12・2026-11-12・金曜）と時刻（14:00・14時・14時半・14-15時・14:00〜15:30）
  const isTouch = () => matchMedia('(hover: none)').matches;
  function parseQuickEvent(text, base) {
    let s2 = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
    let date = base;
    const take = (re, fn) => { const m = re.exec(s2); if (!m) return false; const r = fn(m); if (r === false) return false; s2 = s2.slice(0, m.index) + ' ' + s2.slice(m.index + m[0].length); return true; };
    const rel = { '今日': 0, 'きょう': 0, '明日': 1, 'あした': 1, 'あす': 1, '明後日': 2, 'あさって': 2 };
    take(/\s(今日|きょう|明日|あした|あす|明後日|あさって)(?=\s|$)/, m => { date = addDays(todayKey(), rel[m[1]]); })
      || take(/\s(\d{4})-(\d{1,2})-(\d{1,2})(?=\s)/, m => { date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`; })
      || take(/\s(\d{1,2})[\/月](\d{1,2})日?(?=\s|\d|$)/, m => {
        const t = todayKey(); let y = +t.slice(0, 4);
        let d = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
        if (d < addDays(t, -60)) d = `${y + 1}` + d.slice(4);   // 2か月より前なら来年のこと
        if (+m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return false;
        date = d;
      })
      || take(/\s(?:(来週)の?)?([月火水木金土日])曜日?(?=\s)/, m => {
        const want = '日月火水木金土'.indexOf(m[2]), t = todayKey(), now = parseKey(t).getDay();
        // 来週の○曜：来週（月曜はじまり）のその曜日。ただの○曜：次のその曜日（今日をふくむ）
        const n = m[1] ? 7 - ((now + 6) % 7) + ((want + 6) % 7) : (want - now + 7) % 7;
        date = addDays(t, n);
      });
    const T = '(\\d{1,2})(?::(\\d{2})|時(?:(半)|(\\d{1,2})分)?)';
    const hm = (h, mm, half, mm2) => { const H = +h, M = mm != null ? +mm : half ? 30 : mm2 != null ? +mm2 : 0; return H <= 24 && M < 60 ? `${String(Math.min(H, 23)).padStart(2, '0')}:${String(H === 24 ? 59 : M).padStart(2, '0')}` : null; };
    let start = null, end = null;
    take(new RegExp(`(?:^|\\s|から)${T}\\s*(?:[-–〜~ーから]+\\s*${T})?`), m => {
      start = hm(m[1], m[2], m[3], m[4]); if (!start) return false;
      if (m[5]) end = hm(m[5], m[6], m[7], m[8]);
    })
      || take(/\s(\d{1,2})\s*[-–〜~]\s*(\d{1,2})時(?=\s|$)/, m => { start = hm(m[1], null, null, null); end = hm(m[2], null, null, null); });
    if (start && end && end <= start) end = null;
    const title = s2.replace(/\s+/g, ' ').trim();
    return { date, start, end, title };
  }
  async function addEventNow(ev) {
    const d = ev.date, e2 = { title: ev.title };
    if (ev.start) { e2.time = ev.start; if (ev.end) e2.endTime = ev.end; }
    calSel = d;
    const pd = parseKey(d);
    calMonth = new Date(pd.getFullYear(), pd.getMonth(), 1);
    const ok = await edit(dailyPathOf(d), t => MDParser.addEvent(t == null ? newDailyText(d) : t, e2), `予定: ${e2.time ? e2.time + ' ' : ''}${ev.title}`);
    if (ok) toast(`${relDay(d)}${e2.time ? ' ' + e2.time : ''} に「${ev.title}」を入れました`);
    return ok;
  }
  // 予定を1行で入れる欄（読み取った結果をすぐ下に出す）
  function quickEventBox(k) {
    const f = el('form', 'qEv');
    const row = el('div', 'qEvRow');
    const inp = el('input', 'inp');
    inp.placeholder = '例：14時 MTG／明日 10:00-11:30 歯医者';
    inp.maxLength = 200; inp.enterKeyHint = 'done';
    const go = btn('btn primary small', ['plus', '入れる'], null);
    go.type = 'submit';
    row.append(inp, go);
    const pv = el('div', 'qEvPv');
    const show = () => {
      const r = parseQuickEvent(inp.value, k);
      pv.innerHTML = '';
      pv.classList.toggle('idle', !inp.value.trim());
      if (!inp.value.trim()) { pv.append('日付・時刻・タイトルを1行で書けます（日付を書かなければ ' + md(k) + '）'); return; }
      pv.innerHTML = icon('calendar-clock');
      pv.append(`${md(r.date)}  ${r.start ? r.start + (r.end ? '–' + r.end : '') : '終日'}  `, el('b', '', r.title || '（タイトルを入れてください）'));
    };
    inp.addEventListener('input', show);
    show();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const r = parseQuickEvent(inp.value, k);
      if (!r.title) { inp.focus(); return; }
      inp.value = ''; show();
      await addEventNow(r);
    });
    f.append(row, pv);
    return f;
  }
  async function updateEventItem(it, v) {
    const titleChanged = v.title != null && v.title !== it.title;
    const upd = { title: titleChanged ? v.title : null, time: v.time || null, endTime: v.time ? v.endTime || null : null, date: it.due ? v.date : null };
    const msg = `予定を変更: ${v.time ? v.time + ' ' : ''}${v.title || it.title}`;
    if (v.date === it.date || it.due) {
      const ok = await edit(it.path, t => (t == null ? null : MDParser.updateEvent(t, it.line, it.raw, upd)), msg);
      if (!ok) toast('予定の行が見つかりませんでした。同期してからもう一度', 'warn');
      return ok;
    }
    // ちがう日へ：その日のデイリーノートに書いてから、元の行を消す
    const line = MDParser.rewriteEvent(it.raw, upd);
    if (line == null) return false;
    const dst = dailyPathOf(v.date);
    const ok = await edit(dst, t => MDParser.addEvent(t == null ? newDailyText(v.date) : t, { time: v.time || null, line: line.replace(/^\s+/, '') }), msg);
    if (!ok) return false;
    const ok2 = await edit(it.path, t => (t == null ? null : MDParser.removeLine(t, it.line, it.raw)), msg);
    if (!ok2) toast('元の行を消せませんでした。ノートを見てください', 'warn');
    return ok;
  }

  // 予定を足す（その日のデイリーノートに「- 14:00-15:00 タイトル」、終日は「- タイトル #予定」で書く）
  function newEvent(k = todayKey(), opt = {}) {
    const it = opt.item || null;   // あれば「予定を直す」
    if (it) { k = it.date; opt = { ...opt, title: it.title, start: it.time || '', end: it.endTime || '', allDay: !it.time }; }
    const inn = $('#sheetIn');
    sheetHead(inn, it ? '予定を直す' : '予定を追加');
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const ttl = el('input', 'inp');
    ttl.placeholder = '例：MTG、歯医者、ジム';
    ttl.maxLength = 200;
    ttl.enterKeyHint = 'done';
    ttl.value = opt.title || '';
    // 前に入れた予定のタイトルを候補に出す
    const dl = el('datalist'); dl.id = 'evTitles';
    [...new Set(items.filter(i => i.type === 'event').sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(i => i.title))].slice(0, 30).forEach(t => { const o = el('option'); o.value = t; dl.append(o); });
    ttl.setAttribute('list', 'evTitles');
    const day = el('input', 'inp');
    day.type = 'date';
    day.value = k;
    day.required = true;
    const allDay = el('input');
    allDay.type = 'checkbox';
    const tog = el('label', 'tog');
    tog.append(allDay, '終日');
    // 初めの時刻：今日なら次のちょうどの時間、ほかの日は 10:00。終わりは1時間あと
    const p2 = n => String(n).padStart(2, '0');
    const h0 = k === todayKey() ? Math.min(new Date().getHours() + 1, 23) : 10;
    const st = el('input', 'inp'); st.type = 'time'; st.value = opt.start || `${p2(h0)}:00`;
    const en = el('input', 'inp'); en.type = 'time'; en.value = opt.start ? (opt.end || '') : h0 < 23 ? `${p2(h0 + 1)}:00` : '';
    const times = el('div', 'evTimes');
    const two = el('div', 'two');
    two.append(fld('開始', st), fld('終了（なくても可）', en));
    times.append(two);
    let lastLen = 60;   // 開始を動かしたら、長さを保って終了も動かす
    const mins = v => { const m = /^(\d{1,2}):(\d{2})/.exec(v); return m ? +m[1] * 60 + +m[2] : null; };
    // 長さのボタン：押すと終了がその分あとになる
    const lens = el('div', 'evLens');
    const paintLens = () => { const a = mins(st.value), b = mins(en.value); lens.querySelectorAll('button').forEach(x => x.classList.toggle('on', a != null && b != null && b - a === +x.dataset.m)); };
    [[30, '30分'], [60, '1時間'], [90, '1時間半'], [120, '2時間'], [180, '3時間']].forEach(([m, l]) => {
      const b = btn('chip', l, () => { const a = mins(st.value); if (a == null) return; const e2 = Math.min(a + m, 23 * 60 + 59); en.value = `${p2(Math.floor(e2 / 60))}:${p2(e2 % 60)}`; lastLen = m; paintLens(); });
      b.dataset.m = m; lens.append(b);
    });
    times.append(lens);
    st.addEventListener('change', paintLens); en.addEventListener('change', paintLens);
    { const a = mins(st.value), b = mins(en.value); if (a != null && b != null && b > a) lastLen = b - a; }
    setTimeout(paintLens);
    en.addEventListener('change', () => { const a = mins(st.value), b = mins(en.value); if (a != null && b != null && b > a) lastLen = b - a; });
    st.addEventListener('change', () => { const a = mins(st.value); if (a == null || !en.value) return; const b = Math.min(a + lastLen, 23 * 60 + 59); en.value = `${p2(Math.floor(b / 60))}:${p2(b % 60)}`; });
    allDay.addEventListener('change', () => { times.hidden = allDay.checked; });
    if (opt.allDay) { allDay.checked = true; times.hidden = true; }
    const where = el('div', 'hint sub');
    const showWhere = () => {
      if (it && (day.value === it.date || it.due)) where.textContent = `${it.path}（${it.line + 1}行目）を書きかえます`;
      else where.textContent = day.value ? `${dailyPathOf(day.value)} に${it ? '移します' : '書きます'}` : '';
    };
    day.addEventListener('input', showWhere);
    showWhere();
    inn.append(fld('タイトル', ttl), dl, fld('日付', day), tog, times, where);

    const save = async () => {
      const title = ttl.value.replace(/\s+/g, ' ').trim();
      if (!title) { ttl.focus(); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.value)) { day.focus(); return; }
      const ev = { title };
      if (!allDay.checked) {
        if (!st.value) { st.focus(); return; }
        ev.time = st.value.slice(0, 5);
        if (en.value) {
          if (mins(en.value) <= mins(st.value)) { toast('終了は開始より後にしてください', 'warn'); en.focus(); return; }
          ev.endTime = en.value.slice(0, 5);
        }
      }
      const d = day.value;
      sheet.close();
      calSel = d;
      const pd = parseKey(d);
      calMonth = new Date(pd.getFullYear(), pd.getMonth(), 1);
      if (it) {
        const ok = await updateEventItem(it, { title, date: d, time: ev.time || null, endTime: ev.endTime || null });
        if (ok) toast('予定を直しました');
        return;
      }
      const ok = await edit(dailyPathOf(d), t => MDParser.addEvent(t == null ? newDailyText(d) : t, ev), `予定: ${ev.time ? ev.time + ' ' : ''}${title}`);
      if (ok) toast(`${relDay(d)}に予定を入れました`);
    };
    ttl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });
    const bs = el('div', 'shBtns');
    if (it) {
      // 削除：1回目で「本当に削除」に変わり、2回目で消す
      const del = btn('btn danger', ['trash-2', '削除'], async () => {
        if (!del.classList.contains('sure')) { del.classList.add('sure'); del.lastChild.textContent = '本当に削除'; setTimeout(() => { if (del.isConnected) { del.classList.remove('sure'); del.lastChild.textContent = '削除'; } }, 3000); return; }
        sheet.close();
        const ok = await edit(it.path, t => (t == null ? null : MDParser.removeLine(t, it.line, it.raw)), `予定を削除: ${it.title}`);
        if (ok) toast(`「${it.title}」を削除しました`); else toast('予定の行が見つかりませんでした。同期してからもう一度', 'warn');
      });
      bs.append(del, btn('btn', ['file-text', 'ノート'], () => { sheet.close(); openNote(it.path); }));
    }
    bs.append(btn('btn primary', it ? ['check', '保存'] : ['calendar-plus', '追加する'], save));
    inn.append(bs);
    sheet.showModal();
    if (!it) { if (!isTouch()) ttl.focus(); setTimeout(() => ttl.focus(), 50); }
  }

  // ================= ホーム =================
  function addForm(k, ph) {
    const f = el('form', 'addRow');
    const inp = el('input', 'inp');
    inp.placeholder = ph;
    inp.maxLength = 200;
    inp.enterKeyHint = 'done';
    f.append(inp, btn('iconBtn dark', 'plus', () => f.requestSubmit(), '足す'));
    f.addEventListener('submit', e => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; inp.value = ''; addTodoTo(k, v); });
    return f;
  }
  function renderHome(main) {
    const t = todayKey();
    const dRel = dailyPathOf(t);
    const dPaths = dayFiles(t);
    const daily = dPaths.length > 0;
    const dTodos = items.filter(i => dPaths.includes(i.path) && i.type === 'todo');
    const todayAll = items.filter(i => i.date === t && !dPaths.includes(i.path));
    const sched = items.filter(i => i.date === t && (i.type === 'event' || i.time)).sort(byTime);
    const over = items.filter(i => i.type === 'todo' && !i.done && i.date && i.date < t).sort(byDate);
    const open = items.filter(i => i.type === 'todo' && !i.done);
    const todayTodos = [...dTodos, ...todayAll.filter(i => i.type === 'todo' && !i.time)];
    if (isWide()) return renderHomeWide(main, { t, dRel, dPaths, dTodos, sched, over, open, todayTodos });

    const kp = el('div', 'kpis');
    const kpi = (ic, label, value, sub, note) => {
      const k = el('div', 'kpi');
      const l = el('div', 'label'); l.innerHTML = icon(ic); l.append(label);
      const v = el('div', 'value', value); if (sub) v.append(el('small', '', sub));
      k.append(l, v, el('div', 'note', note));
      return k;
    };
    kp.append(
      kpi('list-checks', '今日のやること', String(todayTodos.filter(i => i.done).length), `/ ${todayTodos.length}`, todayTodos.length ? `のこり ${todayTodos.filter(i => !i.done).length} 件` : 'まだありません'),
      kpi('calendar-clock', '今日の予定', String(sched.filter(i => i.type === 'event').length), '件', sched[0] ? `次 ${sched.find(i => (i.time || '') >= hhmm()) ? sched.find(i => (i.time || '') >= hhmm()).time : '—'}` : '予定なし'),
      kpi('triangle-alert', '期限切れ', String(over.length), '件', over.length ? over[0].title : 'ありません'),
      kpi('list-todo', 'まだのやること', String(open.length), '件', `ノート ${Object.keys(S.files).length} 件から`),
    );
    if (over.length) kp.children[2].classList.add('warn');
    // PC の幅：Mac のダッシュボードと同じ（あいさつ＋数字のタイル、下に2列）
    const W = isWide();
    const grid = el('div', 'db-grid'), left = el('div', 'db-col'), right = el('div', 'db-col');
    const put = (where, node) => (W ? (where === 'left' ? left : where === 'right' ? right : grid).append(node) : main.append(node));
    if (W) {
      const hero = el('div', 'db-card db-hero');
      const ht = el('div', 'db-heroText');
      const h = new Date().getHours();
      ht.append(el('div', 'db-date', md(t)), el('div', 'db-greet', h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'));
      const ks = el('div', 'db-kpis');
      const dn = todayTodos.filter(i => i.done).length, tot = todayTodos.length;
      const C = 2 * Math.PI * 22, pct = tot ? dn / tot : 0;
      const ring = btn('db-kpi ring', [], () => switchTab('todo'));
      const rg = el('div', 'db-ring');
      rg.innerHTML = `<svg viewBox="0 0 52 52"><circle class="bgc" cx="26" cy="26" r="22"/><circle class="fgc" cx="26" cy="26" r="22" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>`;
      rg.append(el('b', '', String(tot - dn)));
      const rl = el('div', 'kl'); rl.append(el('b', '', '今日のやること'), `${dn} / ${tot} 完了`);
      ring.append(rg, rl);
      const tile = (ic, v, unit, label, cls, go) => { const k = btn('db-kpi ' + (cls || ''), [], go); const kv = el('div', 'kv'); kv.innerHTML = icon(ic); kv.append(v); if (unit) kv.append(el('small', '', unit)); k.append(kv, el('div', 'kl', label)); return k; };
      const nx = sched.find(i => (i.time || '') >= hhmm());
      ks.append(ring,
        tile('calendar-clock', String(sched.filter(i => i.type === 'event').length), '件', nx ? `今日の予定・次 ${nx.time}` : '今日の予定', '', () => switchTab('cal')),
        tile('triangle-alert', String(over.length), '件', '期限切れ', over.length ? 'bad' : '', () => { todoFilter = 'over'; switchTab('todo'); }),
        tile('list-todo', String(open.length), '件', 'まだのやること', '', () => { todoFilter = 'open'; switchTab('todo'); }),
        tile('folder-kanban', String(projects.length), '件', 'プロジェクト', '', () => switchTab('proj')));
      hero.append(ht, ks);
      grid.append(hero);
    } else main.append(kp);

    // 今日のノート（Mac のダッシュボードの「今日のノート」と同じ）
    const p = panel('dailyPanel');
    p.append(panelHead('notebook-text', '今日のノート', [el('span', '', daily ? `${dTodos.filter(i => i.done).length}/${dTodos.length}` : ''), btn('linkBtn', '＋ ノート', () => newNote({ day: t }))]));
    if (daily) {
      const fc = el('div', 'fchips');
      dPaths.forEach(x => fc.append(fileChip(x)));
      p.append(fc);
    }
    if (!daily) {
      const e = el('div', 'empty');
      e.innerHTML = icon('notebook-pen');
      e.append(el('p', '', '今日のノートはまだありません。やることやメモを書いておく場所です。'));
      e.append(btn('btn primary', ['file-plus', '今日のノートを作る'], () => createDaily(t)));
      p.append(e);
    } else {
      const ds = [...dTodos.filter(i => !i.done), ...dTodos.filter(i => i.done)];
      if (!ds.length) p.append(noData('やること（- [ ] …）はまだありません。下の欄から足せます。'));
      ds.forEach(i => p.append(todoRow(i, { noDate: true })));
    }
    p.append(addForm(t, S.files[dRel] ? `やることを足して Enter（${nameOf(dRel)}に入ります）` : 'やることを足す（今日のノートを作ります）'));
    put('left', p);

    const ps = panel();
    ps.append(panelHead('calendar-clock', '今日の予定', [el('span', '', `${sched.length}件`), btn('linkBtn', '＋ 予定', () => newEvent(t))]));
    if (!sched.length) ps.append(noData('時刻つきの予定（- 14:00 MTG など）はありません'));
    sched.forEach(i => ps.append(planRow(i)));
    put('right', ps);

    if (over.length) {
      const po = panel();
      po.append(panelHead('triangle-alert', '期限切れ', el('span', '', `${over.length}件`)));
      over.slice(0, 8).forEach(i => po.append(todoRow(i)));
      if (over.length > 8) po.append(btn('addTask', ['chevron-right', `ほか ${over.length - 8} 件`], () => { todoFilter = 'over'; switchTab('todo'); }));
      put('right', po);
    }
    const other = todayAll.filter(i => i.type === 'todo' && !i.time);
    if (other.length) {
      const pt = panel();
      pt.append(panelHead('list-todo', 'ほかのノートの今日の分', el('span', '', `${other.length}件`)));
      other.forEach(i => pt.append(todoRow(i, { noDate: true })));
      put('right', pt);
    }
    const end = addDays(t, 7);
    const soon = items.filter(i => i.date && i.date > t && i.date <= end && !i.done).sort(byDate);
    const pn = panel();
    pn.append(panelHead('calendar-days', 'これから7日', el('span', '', `${soon.length}件`)));
    if (!soon.length) pn.append(noData('予定もやることもありません'));
    let last = null;
    for (const i of soon) {
      if (i.date !== last) { pn.append(el('div', 'hb-sep', relDay(i.date))); last = i.date; }
      pn.append(i.type === 'event' ? planRow(i) : todoRow(i, { noDate: true }));
    }
    if (W) { pn.classList.add('db-full'); grid.append(left, right, pn); main.append(grid); }
    else main.append(pn);
  }
  const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  // ================= やること =================
  function renderTodo(main) {
    if (isWide()) return renderTodoWide(main);
    const t = todayKey();
    const seg = el('div', 'seg');
    [['open', '未完了'], ['over', '期限切れ'], ['nodate', '日付なし'], ['done', '完了']].forEach(([k, l]) =>
      seg.append(btn(todoFilter === k ? 'on' : '', l, () => { todoFilter = k; render(); })));
    const bar = el('div', 'gtool mobileOnly'); bar.append(seg);
    main.append(bar);
    const all = items.filter(i => i.type === 'todo');
    const tags = [...new Set(all.flatMap(i => i.tags))].sort();
    if (tags.length) {
      const tg = el('div', 'tagBar mobileOnly');
      tags.forEach(g => tg.append(btn('chip' + (todoTag === g ? ' ok' : ''), '#' + g, () => { todoTag = todoTag === g ? null : g; render(); })));
      main.append(tg);
    }
    let list = todoTag ? all.filter(i => i.tags.includes(todoTag)) : all;
    list = list.filter(i => (todoFilter === 'open' ? !i.done : todoFilter === 'over' ? !i.done && i.date && i.date < t : todoFilter === 'nodate' ? !i.done && !i.date : i.done));
    if (!list.length) {
      const p = panel(); const e = el('div', 'empty'); e.innerHTML = icon('circle-check'); e.append(el('p', '', '該当するやることはありません')); p.append(e); main.append(p); return;
    }
    const groups = new Map();
    const push = (k, i) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); };
    if (todoFilter === 'nodate' || todoFilter === 'done') list.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).forEach(i => push(nameOf(i.path), i));
    else list.sort(byDate).forEach(i => push(!i.date ? '日付なし' : i.date < t ? '期限切れ' : relDay(i.date), i));
    for (const [k, arr] of groups) {
      const p = panel();
      p.append(panelHead(k === '期限切れ' ? 'triangle-alert' : k === '日付なし' ? 'list-todo' : todoFilter === 'nodate' || todoFilter === 'done' ? 'file-text' : 'calendar-days', k, el('span', '', `${arr.length}件`)));
      arr.forEach(i => p.append(todoRow(i, { noDate: k !== '期限切れ' && todoFilter !== 'done' && todoFilter !== 'nodate' })));
      main.append(p);
    }
  }

  // ================= カレンダー（Workstation モバイルと同じ形） =================
  // ================= カレンダー（よくあるカレンダーアプリと同じ：日・週・月） =================
  // ・PC／タブレット：日・週・月（はじめは週）。スマホ：月（点＋下にその日の一覧）・日
  // ・空いている時間を押す（マウスはドラッグで長さも）と、その時間で予定を入れる。予定を押すとくわしく
  let calView = (() => { try { return localStorage.getItem('ws-notes.calView') || ''; } catch { return ''; } })();
  const calV = () => calView || (isWide() ? 'week' : 'month');
  function setCalView(v) { calView = v; try { localStorage.setItem('ws-notes.calView', v); } catch {} render(); }
  const weekStart = k => addDays(k, -((parseKey(k).getDay() + 6) % 7));
  function calGo(k, v) { calSel = k; const d = parseKey(k); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); if (v) setCalView(v); else render(); }
  function calStep(n) {
    const v = calV();
    if (v !== 'month') return calGo(addDays(calSel, v === 'week' ? 7 * n : n));
    const d = parseKey(calSel), m = new Date(d.getFullYear(), d.getMonth() + n, 1);
    calGo(keyOf(new Date(m.getFullYear(), m.getMonth(), Math.min(d.getDate(), new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()))));
  }
  function calTitle() {
    const v = calV(), d = parseKey(calSel);
    if (v === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (v === 'day') return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
    const a = parseKey(weekStart(calSel)), b = parseKey(addDays(weekStart(calSel), 6));
    if (!isWide()) return `${a.getMonth() + 1}/${a.getDate()} 〜 ${b.getMonth() + 1}/${b.getDate()}`;
    return `${a.getFullYear()}年${a.getMonth() + 1}月${a.getDate()}日 〜 ${a.getMonth() === b.getMonth() ? '' : b.getMonth() + 1 + '月'}${b.getDate()}日`;
  }
  // その日の予定（時刻あり・終日）と、日付のあるやること（まだの分）
  function dayItems(k) {
    const arr = items.filter(i => i.date === k);
    return {
      timed: arr.filter(i => i.time).sort(byTime),
      allDay: arr.filter(i => !i.time && i.type === 'event'),
      todos: arr.filter(i => !i.time && i.type === 'todo' && !i.done),
    };
  }
  const evLabel = i => (i.endTime ? `${i.time}–${i.endTime}` : i.time || '');
  // 重なる予定を横に並べる（lane：何列目、n：その重なりの列の数）
  function layoutLanes(list) {
    const toMin = v => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; };
    const placed = list.filter(i => toMin(i.time) != null).map(i => { const a = toMin(i.time), b = Math.max(toMin(i.endTime) ?? a + 60, a + 20); return { i, a, b }; }).sort((x, y) => x.a - y.a || y.b - x.b);
    const lanes = []; let group = [], gEnd = -1;
    const flush = () => { const n = Math.max(1, ...group.map(g => g.lane + 1)); group.forEach(g => (g.n = n)); group = []; };
    for (const p of placed) {
      if (p.a >= gEnd) { flush(); lanes.length = 0; }
      let l = lanes.findIndex(e => e <= p.a); if (l < 0) l = lanes.length;
      lanes[l] = p.b; p.lane = l; group.push(p); gEnd = Math.max(gEnd, p.b);
    }
    flush();
    return placed;
  }
  const p2c = n => String(n).padStart(2, '0');
  const hhmmOf = m => `${p2c(Math.floor(m / 60))}:${p2c(m % 60)}`;

  // 上の行：今日・前・次・見出し・日／週／月
  function calBar() {
    const bar = el('div', 'calBar');
    const nv = el('div', 'calNav');
    nv.append(btn('btn white small', '今日', () => calGo(todayKey())),
      btn('iconBtn', 'chevron-left', () => calStep(-1), '前へ'), btn('iconBtn', 'chevron-right', () => calStep(1), '次へ'),
      el('h2', 'calTtl', calTitle()));
    const seg = el('div', 'seg calSeg');
    (isWide() ? [['day', '日'], ['week', '週'], ['month', '月']] : [['month', '月'], ['week', '週'], ['day', '日']])
      .forEach(([k, l]) => seg.append(btn(calV() === k ? 'on' : '', l, () => setCalView(k))));
    if (!isWide()) bar.classList.add('m');
    bar.append(nv, seg);
    return bar;
  }
  // 小さなチップ（予定・やること）
  function calChip(i, cls = '') {
    const c = btn('calChip ' + cls + (i.type === 'todo' ? ' todo' : !i.time ? ' allday' : ''), [], e => { e.stopPropagation(); openItem(i); }, i.title);
    if (i.type === 'todo') c.append(el('i', 'ck'));
    else if (i.time) c.append(el('i', 'dt'));
    if (i.time) c.append(el('time', '', i.time));
    c.append(el('span', '', i.title));
    return c;
  }

  // ---- 新しい予定の四角（下書き）と、下の入力欄 ----
  let calDraft = null;        // { date, a, b }（分）
  let cgScroll = { key: '', top: 0 };
  const SNAP = 15;
  const draftLabel = () => calDraft ? `${md(calDraft.date)}  ${hhmmOf(calDraft.a)} – ${hhmmOf(Math.min(calDraft.b, 24 * 60 - 1))}` : '';
  function draftEl(P) {
    const d = el('div', 'cgDraft');
    const lab = el('span', 'cgDraftT');
    const top = el('i', 'cgH top'), bot = el('i', 'cgH bot');
    const place = () => {
      d.style.top = (calDraft.a / 60) * P + 'px';
      d.style.height = Math.max(((calDraft.b - calDraft.a) / 60) * P - 2, 14) + 'px';
      lab.textContent = `${hhmmOf(calDraft.a)}–${hhmmOf(Math.min(calDraft.b, 24 * 60 - 1))}`;
      const t = $('#evBarTime'); if (t) t.textContent = draftLabel();
    };
    d.append(top, el('b', '', '（新しい予定）'), lab, bot);
    place();
    // 端をドラッグで長さ、まん中をドラッグで時間ごと動かす（15分きざみ）
    let mv = null;
    d.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      mv = { mode: e.target === top ? 'top' : e.target === bot ? 'bot' : 'move', y: e.clientY, a: calDraft.a, b: calDraft.b };
      try { d.setPointerCapture(e.pointerId); } catch {} d.classList.add('drag');
    });
    d.addEventListener('pointermove', e => {
      if (!mv) return;
      const dm = Math.round(((e.clientY - mv.y) / P) * 60 / SNAP) * SNAP;
      if (mv.mode === 'top') calDraft.a = Math.max(0, Math.min(mv.b - SNAP, mv.a + dm));
      else if (mv.mode === 'bot') calDraft.b = Math.min(24 * 60, Math.max(mv.a + SNAP, mv.b + dm));
      else { const len = mv.b - mv.a; calDraft.a = Math.max(0, Math.min(24 * 60 - len, mv.a + dm)); calDraft.b = calDraft.a + len; }
      place();
    });
    const end = () => { if (!mv) return; mv = null; d.classList.remove('drag'); };
    d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
    d.addEventListener('click', e => { e.stopPropagation(); $('#evBarIn')?.focus(); });
    return d;
  }
  function setDraft(k, a, b, focus) {
    calDraft = { date: k, a, b: Math.min(b, 24 * 60) };
    document.querySelectorAll('.cgDraft').forEach(x => x.remove());
    const cols = [...document.querySelectorAll('.cgCol')];
    const idx = calV() === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(calSel), i)).indexOf(k) : 0;
    const P = isWide() ? 48 : 52;
    if (cols[idx]) cols[idx].append(draftEl(P));
    showEvBar(focus);
  }
  function clearDraft() { calDraft = null; document.querySelectorAll('.cgDraft').forEach(x => x.remove()); hideEvBar(); }
  // 下の入力欄（キーボードが出ても、その上に出る）
  function evBar() {
    let bar = $('#evBar');
    if (bar) return bar;
    bar = el('form', 'evBar'); bar.id = 'evBar'; bar.hidden = true;
    const hd = el('div', 'evBarHd');
    const tm = el('span', 'evBarTime'); tm.id = 'evBarTime';
    hd.insertAdjacentHTML('beforeend', icon('calendar-clock'));
    hd.append(tm, btn('iconBtn plain evBarX', 'x', () => clearDraft(), 'やめる'));
    const row = el('div', 'evBarRow');
    const inp = el('input', 'inp'); inp.id = 'evBarIn'; inp.placeholder = 'タイトル（例：MTG・歯医者）'; inp.maxLength = 200; inp.enterKeyHint = 'done'; inp.autocomplete = 'off';
    const ok = btn('btn primary', '保存', null); ok.type = 'submit';
    row.append(inp, ok);
    const more = btn('linkBtn evBarMore', 'くわしく（場所・メモ・終日）', () => { const d = calDraft; const t = inp.value; clearDraft(); newEvent(d.date, { start: hhmmOf(d.a), end: hhmmOf(Math.min(d.b, 23 * 60 + 59)), title: t }); });
    bar.append(hd, row, more);
    bar.addEventListener('submit', async e => {
      e.preventDefault();
      const title = inp.value.trim();
      if (!title) { inp.focus(); bar.classList.remove('shake'); void bar.offsetWidth; bar.classList.add('shake'); return; }
      const d = calDraft; if (!d) return;
      inp.value = ''; calDraft = null; hideEvBar();
      await addEventNow({ date: d.date, start: hhmmOf(d.a), end: hhmmOf(Math.min(d.b, 23 * 60 + 59)), title });
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') clearDraft(); });
    document.body.append(bar);
    // スマホ：キーボードが出たら、その上に
    const vv = window.visualViewport;
    if (vv) { const fit = () => { const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); bar.style.setProperty('--kb', kb + 'px'); bar.classList.toggle('kbOpen', kb > 60); }; vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    return bar;
  }
  function showEvBar(focus) {
    const bar = evBar();
    bar.hidden = false;
    $('#evBarTime').textContent = draftLabel();
    if (focus) $('#evBarIn').focus({ preventScroll: true });
    // 置いた四角が下の入力欄にかくれるときは、表をスクロールして見えるように
    const fit = () => {
      const d = document.querySelector('.cgDraft'), body = d?.closest('.cgBody');
      if (!d || !body || bar.hidden) return;
      const r = d.getBoundingClientRect(), br = body.getBoundingClientRect(), barTop = bar.getBoundingClientRect().top;
      const limit = Math.min(br.bottom, barTop) - 12;
      if (r.bottom > limit) body.scrollBy({ top: Math.min(r.bottom - limit, r.top - br.top - 12), behavior: 'smooth' });
      else if (r.top < br.top + 4) body.scrollBy({ top: r.top - br.top - 12, behavior: 'smooth' });
    };
    requestAnimationFrame(fit);
    setTimeout(fit, 350);   // キーボードが出たあとにも
  }
  function hideEvBar() { const bar = $('#evBar'); if (bar) { bar.hidden = true; $('#evBarIn').blur(); } }

  // 予定の四角を動かす：マウスはそのままドラッグ、指は長押ししてからドラッグ（ふつうのスクロールとぶつからないように）
  // 下の端（指は下のほう）をつかむと長さを変える。週の表なら、ほかの日へも動かせる。15分きざみ
  function evDrag(b, p, days, P) {
    const it = p.i, len0 = p.b - p.a;
    b.append(el('i', 'cgEvH'));
    let st = null;
    const colAt = (x, y) => { b.style.pointerEvents = 'none'; const c = document.elementFromPoint(x, y)?.closest('.cgCol'); b.style.pointerEvents = ''; return c; };
    const begin = (x, y, resize) => {
      st = { x, y, resize, a: p.a, b: p.b, col: b.parentElement, moved: false };
      b.classList.add('lift');
    };
    const move = (x, y) => {
      if (!st) return;
      const dm = Math.round(((y - st.y) / P) * 60 / SNAP) * SNAP;
      if (dm || Math.abs(x - st.x) > 6) st.moved = true;
      if (st.resize) { st.b = Math.min(24 * 60, Math.max(p.a + SNAP, p.b + dm)); st.a = p.a; }
      else {
        st.a = Math.max(0, Math.min(24 * 60 - len0, p.a + dm)); st.b = st.a + len0;
        const c = days.length > 1 ? colAt(x, y) : null;
        if (c && c !== st.col) { st.col = c; c.append(b); }
      }
      b.style.top = (st.a / 60) * P + 1 + 'px';
      b.style.height = Math.max(((st.b - st.a) / 60) * P - 3, 18) + 'px';
      if (st.col !== p.colEl) { b.style.left = '2px'; b.style.width = 'calc(100% - 5px)'; }
      b.querySelector('small').textContent = `${hhmmOf(st.a)}–${hhmmOf(Math.min(st.b, 24 * 60 - 1))}`;
    };
    const finish = async () => {
      if (!st) return;
      const s2 = st; st = null; b.classList.remove('lift');
      if (!s2.moved) return;
      b.dataset.dragged = '1'; setTimeout(() => delete b.dataset.dragged, 400);
      const cols = [...b.closest('.cgIn').querySelectorAll('.cgCol')];
      const date = days[Math.max(0, cols.indexOf(s2.col))] || it.date;
      const keepEnd = it.endTime || s2.resize || s2.b - s2.a !== 60;
      const ok = await updateEventItem(it, { title: null, date, time: hhmmOf(s2.a), endTime: keepEnd ? hhmmOf(Math.min(s2.b, 23 * 60 + 59)) : null });
      if (ok) toast(`「${it.title}」を ${date !== it.date ? md(date) + ' ' : ''}${hhmmOf(s2.a)} に動かしました`);
      else render();
    };
    p.colEl = null; requestAnimationFrame(() => { p.colEl = b.parentElement; });
    // マウス
    b.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button) return;
      e.stopPropagation();
      const r = b.getBoundingClientRect();
      begin(e.clientX, e.clientY, e.clientY > r.bottom - 8);
      try { b.setPointerCapture(e.pointerId); } catch {}
    });
    b.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && st) move(e.clientX, e.clientY); });
    b.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') finish(); });
    // 指：長押し（0.4秒）でつかむ
    let timer = null, t0 = null;
    b.addEventListener('touchstart', e => {
      const t = e.touches[0]; t0 = { x: t.clientX, y: t.clientY };
      const r = b.getBoundingClientRect(), resize = t.clientY > r.bottom - Math.min(18, r.height / 3);
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; begin(t0.x, t0.y, resize); navigator.vibrate?.(12); }, 400);
    }, { passive: true });
    b.addEventListener('touchmove', e => {
      const t = e.touches[0];
      if (st) { e.preventDefault(); move(t.clientX, t.clientY); return; }
      if (timer && t0 && Math.hypot(t.clientX - t0.x, t.clientY - t0.y) > 8) { clearTimeout(timer); timer = null; }
    }, { passive: false });
    const tend = () => { clearTimeout(timer); timer = null; if (st) finish(); };
    b.addEventListener('touchend', tend); b.addEventListener('touchcancel', tend);
    b.addEventListener('contextmenu', e => { if (isTouch()) e.preventDefault(); });
  }

  // 週・日：時間が縦に並ぶ表
  function timeGrid(days) {
    const today = todayKey(), P = isWide() ? 48 : 52;
    const wrap = el('div', 'cg' + (days.length === 1 ? ' one' : ''));
    wrap.style.setProperty('--n', days.length);
    wrap.style.setProperty('--hp', P + 'px');
    const head = el('div', 'cgHead');
    head.append(el('div', 'cgGut'));
    for (const k of days) {
      const d = parseKey(k);
      const h = btn('cgDay' + (k === today ? ' today' : '') + ([0, 6].includes(d.getDay()) ? ' we' : ''), [], () => calGo(k, 'day'), `${md(k)}を開く`);
      h.append(el('small', '', WD[d.getDay()]), el('b', '', String(d.getDate())));
      head.append(h);
    }
    // 終日の予定・その日のやること
    const all = el('div', 'cgAll');
    all.append(el('div', 'cgGut', '終日'));
    let maxAll = 0;
    for (const k of days) {
      const { allDay, todos } = dayItems(k);
      const cell = el('div', 'cgAllCell');
      cell.title = 'ダブルクリックで終日の予定を入れる';
      const list = [...allDay, ...todos];
      const MAX = days.length === 1 && isWide() ? 8 : 3;
      list.slice(0, MAX).forEach(i => cell.append(calChip(i)));
      if (list.length > MAX) cell.append(btn('calMore', `ほか ${list.length - MAX} 件`, () => calGo(k, 'day')));
      maxAll = Math.max(maxAll, Math.min(list.length, MAX + (list.length > MAX ? 1 : 0)));
      cell.addEventListener('dblclick', e => { if (!e.target.closest('.calChip')) newEvent(k, { allDay: true }); });
      all.append(cell);
    }
    if (!maxAll) all.classList.add('empty');
    // 時間の表
    const body = el('div', 'cgBody');
    const inner = el('div', 'cgIn');
    inner.style.height = 24 * P + 'px';
    const gut = el('div', 'cgGut cgHours');
    for (let h = 1; h < 24; h++) { const s = el('span', '', `${h}:00`); s.style.top = h * P + 'px'; gut.append(s); }
    inner.append(gut);
    let firstMin = null;
    days.forEach(k => {
      const col = el('div', 'cgCol' + (k === today ? ' today' : '') + ([0, 6].includes(parseKey(k).getDay()) ? ' we' : ''));
      for (const p of layoutLanes(dayItems(k).timed)) {
        const b = btn('cgEv' + (p.i.type === 'todo' ? ' todo' : '') + (p.i.done ? ' done' : '') + (p.b - p.a <= 40 ? ' short' : ''), [], () => { if (!b.dataset.dragged) openItem(p.i); }, p.i.title);
        if (p.i.type === 'event') evDrag(b, p, days, P);
        b.style.top = (p.a / 60) * P + 1 + 'px';
        b.style.height = Math.max(((p.b - p.a) / 60) * P - 3, 18) + 'px';
        b.style.left = `calc(${(p.lane / p.n) * 100}% + 2px)`;
        b.style.width = `calc(${100 / p.n}% - 5px)`;
        b.append(el('b', '', p.i.title), el('small', '', evLabel(p.i)));
        col.append(b);
        if (firstMin == null || p.a < firstMin) firstMin = p.a;
      }
      if (k === today) { const n = new Date(), ln = el('div', 'cgNow'); ln.style.top = ((n.getHours() * 60 + n.getMinutes()) / 60) * P + 'px'; col.append(ln); }
      // 空いている時間：タップ（マウスはドラッグでも）すると「新しい予定」の四角を置く → 下の入力欄でタイトル
      const ghost = el('div', 'cgGhost'); ghost.hidden = true; col.append(ghost);
      const minAt = (e, snap = 30) => { const y = e.clientY - col.getBoundingClientRect().top; return Math.max(0, Math.min(24 * 60 - snap, Math.floor(((y / P) * 60) / snap) * snap)); };
      const paint = (a, b2) => { ghost.hidden = false; ghost.style.top = (a / 60) * P + 'px'; ghost.style.height = ((b2 - a) / 60) * P + 'px'; ghost.textContent = `${hhmmOf(a)}–${hhmmOf(Math.min(b2, 24 * 60 - 1))}`; };
      let drag = null;
      col.addEventListener('pointerdown', e => {
        if (e.target.closest('.cgEv, .cgDraft') || e.button || e.pointerType !== 'mouse') return;
        const a = minAt(e); drag = { a, b: a + 30, moved: false }; paint(drag.a, drag.b);
        col.setPointerCapture(e.pointerId); e.preventDefault();
      });
      col.addEventListener('pointermove', e => { if (!drag) return; const b2 = Math.max(drag.a + 30, minAt(e) + 30); if (b2 !== drag.b) drag.moved = true; drag.b = b2; paint(drag.a, drag.b); });
      col.addEventListener('pointerup', () => {
        if (!drag) return;
        const d2 = drag; drag = null; ghost.hidden = true;
        setDraft(k, d2.a, d2.moved ? d2.b : d2.a + 60, true);
      });
      col.addEventListener('click', e => {
        if (e.target.closest('.cgEv, .cgDraft') || e.pointerType === 'mouse' || (e.pointerType == null && !isTouch())) return;
        const a = minAt(e); setDraft(k, a, a + 60, true);
      });
      if (calDraft && calDraft.date === k) col.append(draftEl(P));
      inner.append(col);
    });
    body.append(inner);
    if (days.length === 1 && !isWide()) wrap.classList.add('mDay');
    if (days.length > 1 && !isWide()) wrap.classList.add('mWeek');
    wrap.append(...(days.length === 1 && !isWide() ? [] : [head]), all, body);
    // スマホ：左右にスワイプで前の日・次の日
    if (!isWide()) {
      let sx = null, sy = 0;
      body.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
      body.addEventListener('touchend', e => {
        if (sx == null) return;
        const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) calStep(dx < 0 ? 1 : -1);
      }, { passive: true });
    }
    // はじめは今（今日をふくむとき）か、最初の予定か、8時のあたりを見せる
    // 今日をふくむときは「今」の少し前、ただしそれより早い予定があればそこから
    const nowStart = days.includes(today) ? new Date().getHours() * 60 - 90 : null;
    const cands = [nowStart, firstMin != null ? firstMin - 30 : null].filter(x => x != null);
    const start = cands.length ? Math.min(...cands) : 8 * 60;
    // 同じ表を描き直したとき（予定を入れた・同期した）は、見ていた位置のまま
    const sk = `${calV()}|${days[0]}|${days.length}`;
    const keep = cgScroll.key === sk ? cgScroll.top : null;
    requestAnimationFrame(() => { body.scrollTop = keep != null ? keep : Math.max(0, (start / 60) * P); cgScroll = { key: sk, top: body.scrollTop }; });
    body.addEventListener('scroll', () => { cgScroll = { key: sk, top: body.scrollTop }; }, { passive: true });
    return wrap;
  }

  // 月：マス目に予定を並べる（スマホは点）
  function monthGrid(compact) {
    const today = todayKey(), d0 = parseKey(calSel);
    const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
    const start = addDays(keyOf(first), -((first.getDay() + 6) % 7));
    const days = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((((first.getDay() + 6) % 7) + days) / 7);
    const wrap = el('div', 'cm' + (compact ? ' compact' : ''));
    const wd = el('div', 'cmWd');
    [1, 2, 3, 4, 5, 6, 0].forEach(i => wd.append(el('span', i === 0 || i === 6 ? 'we' : '', WD[i])));
    const grid = el('div', 'cmGrid');
    grid.style.gridTemplateRows = `repeat(${weeks}, minmax(0, 1fr))`;
    const MAX = 4;
    for (let w = 0; w < weeks * 7; w++) {
      const k = addDays(start, w), d = parseKey(k);
      const cell = el('div', 'cmCell' + (d.getMonth() !== d0.getMonth() ? ' out' : '') + ([0, 6].includes(d.getDay()) ? ' we' : '') + (k === today ? ' today' : '') + (k === calSel ? ' sel' : ''));
      const num = btn('cmNum', String(d.getDate()), e => { e.stopPropagation(); if (compact) { if (calSel === k) newEvent(k); else calGo(k); } else calGo(k, 'day'); }, `${md(k)}${compact ? '' : 'を開く'}`);
      cell.append(num);
      const { timed, allDay, todos } = dayItems(k);
      const list = [...allDay, ...timed, ...todos];
      if (compact) {
        // スマホ：予定の名前を短い帯で（入りきらない分は +数）
        const MAXM = 3, ls = el('div', 'cmMini');
        list.slice(0, MAXM).forEach(i => {
          const t = el('span', 'mi' + (i.type === 'todo' ? ' todo' + (k < today ? ' late' : '') : !i.time ? ' allday' : '') + (i.done ? ' done' : ''));
          t.textContent = i.title;
          ls.append(t);
        });
        if (list.length > MAXM) ls.append(el('span', 'miMore', `+${list.length - MAXM}`));
        cell.append(ls);
        if (dayFiles(k).length) cell.append(el('i', 'cmNote'));
        cell.addEventListener('click', () => { if (calSel === k) newEvent(k); else calGo(k); });
      } else {
        const ls = el('div', 'cmList');
        list.slice(0, MAX).forEach(i => ls.append(calChip(i)));
        if (list.length > MAX) ls.append(btn('calMore', `ほか ${list.length - MAX} 件`, e => { e.stopPropagation(); calGo(k, 'day'); }));
        cell.append(ls);
        cell.title = '空いているところを押すと、この日に予定を入れる';
        cell.addEventListener('click', e => { if (!e.target.closest('button')) newEvent(k); });
      }
      grid.append(cell);
    }
    wrap.append(wd, grid);
    return wrap;
  }

  // スマホの月：選んだ日の一覧
  function dayAgenda(k) {
    const today = todayKey();
    const p = panel('dayPanel');
    const hd = el('div', 'dayHead');
    hd.append(el('b', '', md(k)));
    if (k === today) hd.append(el('span', 'chip ok', '今日'));
    const dps = dayFiles(k);
    hd.append(dps.length ? btn('btn small white', ['plus', 'ノート'], () => newNote({ day: k })) : btn('btn small white', ['file-plus', 'ノートを作る'], () => createDaily(k)));
    p.append(hd);
    if (dps.length) { const fc = el('div', 'fchips'); dps.forEach(x => fc.append(fileChip(x))); p.append(fc); }
    const arr = items.filter(i => i.date === k);
    const ev = arr.filter(i => i.type === 'event' || i.time).sort(byTime);
    const td = arr.filter(i => i.type === 'todo' && !i.time);
    p.append(panelHead('calendar-clock', '予定', [el('span', '', `${ev.length}件`), btn('linkBtn', '＋ くわしく', () => newEvent(k))]));
    p.append(quickEventBox(k));
    if (!ev.length) p.append(noData('この日の予定はありません'));
    ev.forEach(i => p.append(planRow(i)));
    p.append(panelHead('list-todo', 'やること', el('span', '', `${td.filter(i => i.done).length}/${td.length}`)));
    if (!td.length) p.append(noData('この日のやることはありません'));
    td.forEach(i => p.append(todoRow(i, { noDate: true })));
    p.append(addForm(k, `${relDay(k)}のノートにやることを足す`));
    return p;
  }

  function renderCal(main) {
    const v = calV(), W = isWide();
    if (v === 'month' && calDraft) clearDraft();
    main.classList.toggle('calMode', W);
    main.append(calBar());
    if (v === 'month') {
      main.append(monthGrid(!W));
      if (!W) main.append(dayAgenda(calSel));
    } else {
      if (!W) { const q = quickEventBox(calSel); q.classList.add('slim'); main.append(q); }
      const ws = weekStart(calSel);
      main.append(timeGrid(v === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(ws, i)) : [calSel]));
      if (!W && v === 'day') {
        const { todos } = dayItems(calSel);
        if (todos.length) { const p = panel('dayPanel'); p.append(panelHead('list-todo', 'この日のやること', el('span', '', `${todos.length}件`))); todos.forEach(i => p.append(todoRow(i, { noDate: true }))); main.append(p); }
      }
    }
  }

  // サイドバーの小さな月のカレンダー
  let miniMonth = null;
  function miniCal() {
    const sel = parseKey(calSel);
    if (!miniMonth || miniMonth.sel !== calSel) miniMonth = { sel: calSel, m: new Date(sel.getFullYear(), sel.getMonth(), 1) };
    const m = miniMonth.m, today = todayKey(), v = calV(), ws = weekStart(calSel);
    const box = el('div', 'mm');
    const hd = el('div', 'mmHead');
    hd.append(el('b', '', `${m.getFullYear()}年${m.getMonth() + 1}月`),
      btn('iconBtn plain', 'chevron-left', () => { miniMonth.m = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderSide(); }, '前の月'),
      btn('iconBtn plain', 'chevron-right', () => { miniMonth.m = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderSide(); }, '次の月'));
    const g = el('div', 'mmGrid');
    [1, 2, 3, 4, 5, 6, 0].forEach(i => g.append(el('span', 'mmWd' + (i === 0 || i === 6 ? ' we' : ''), WD[i])));
    const start = addDays(keyOf(m), -((m.getDay() + 6) % 7));
    const busy = new Set(items.filter(i => i.date && (i.type === 'event' || i.time)).map(i => i.date));
    for (let i = 0; i < 42; i++) {
      const k = addDays(start, i), d = parseKey(k);
      const inRange = v === 'week' ? k >= ws && k <= addDays(ws, 6) : v === 'month' ? d.getMonth() === sel.getMonth() && d.getFullYear() === sel.getFullYear() : k === calSel;
      const b = btn('mmDay' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (k === today ? ' today' : '') + (k === calSel ? ' sel' : '') + (inRange && v !== 'month' ? ' range' : '') + (busy.has(k) ? ' busy' : ''), String(d.getDate()), () => calGo(k), md(k));
      g.append(b);
    }
    box.append(hd, g);
    return box;
  }

  // ================= プロジェクト（Mac の Workstation のプロジェクトと同じ項目を、Markdown で） =================
  // ・Projects/（または プロジェクト/）のノート、先頭のプロパティに type: project があるノートが、1つのプロジェクト
  // ・色・リンクは先頭のプロパティ。メモは最初の見出しまでの本文
  // ・タスク：そのノートのチェックリスト ＋ ほかのノートで [[プロジェクト名]] と書いたチェックリスト
  const P_COLORS = ['#005cff', '#00c230', '#ff5a00', '#8600ff', '#1fb8cc', '#f2280d', '#ffae00', '#717680'];
  const PREF_KEY = 'ws-notes.prefs';
  let prefs = (() => { try { return { showDone: false, closed: [], ...JSON.parse(localStorage.getItem(PREF_KEY)) }; } catch { return { showDone: false, closed: [] }; } })();
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };
  let projects = [];
  let proj = null;                  // 開いているプロジェクトの path
  let projView = 'list';            // list / gantt
  let ganttScroll = null;
  const projByPath = p => projects.find(x => x.path === p);
  const isProjFolder = p => /^(projects|プロジェクト)\//i.test(p);

  function computeProjects() {
    projects = [];
    for (const [p, f] of Object.entries(S.files)) {
      const { props, body } = splitFrontmatter(f.text);
      const get = k => (props || []).find(x => x.k.toLowerCase() === k);
      const type = get('type')?.v[0];
      if (!isProjFolder(p) && !/^(project|プロジェクト)$/i.test(type || '')) continue;
      const color = get('color')?.v[0];
      const links = (get('links')?.v || []).map(v => {
        const m = /^(.*?)\s*(https?:\/\/\S+)\s*$/.exec(v);
        return m ? { title: m[1].trim() || m[2], url: m[2] } : null;
      }).filter(Boolean);
      const memo = [];
      for (const l of body.split('\n')) { if (/^#{1,6}\s/.test(l)) break; if (!/^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.test(l)) memo.push(l); }
      projects.push({ path: p, name: nameOf(p), color: /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : null, links, memo: memo.join('\n').trim(), status: get('status')?.v[0] || '' });
    }
    projects.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    projects.forEach((x, i) => { if (!x.color) x.color = P_COLORS[i % P_COLORS.length]; });
    // タスクをプロジェクトに入れる
    for (const it of items) {
      it.project = projByPath(it.path) ? it.path : null;
      if (!it.project) for (const l of it.links || []) {
        const r = resolve(l, it.path);
        if (!r || !projByPath(r)) continue;
        it.project = r;
        // 名前から、プロジェクトへのリンク（[[ほのぼの書店]]）の部分を外す（プロジェクトは色の点で出す）
        const m = new RegExp(`\\[\\[${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`).exec(it.raw);
        const label = m ? (m[1] || l) : l;
        const at = it.title.lastIndexOf(label);   // リンクはふつう行の最後なので、最後の方を外す
        const t2 = (at < 0 ? it.title : it.title.slice(0, at) + it.title.slice(at + label.length)).replace(/\s+/g, ' ').trim();
        if (t2) it.title = t2;
        break;
      }
    }
  }
  const tasksOf = p => items.filter(i => i.type === 'todo' && i.project === p.path);
  const spanOf = t => { const e = t.date, s = t.start && t.start <= e ? t.start : e; return { s, e }; };

  // ---------- プロジェクトカード（旧 Workstation と同じ：フォルダの形） ----------
  // 後ろの板＋タブ → はみ出た紙（次の節目・直近のタスク）→ 表面（名前・数・ノート・リンク）の3枚重ね
  // マウスを乗せると表面が下がって紙が出る（指で使うときは、はじめから出ておく）
  function projNotes(p) {
    // このプロジェクトのノート：[[プロジェクト]] とリンクしている・先頭の project: に名前があるノート（新しい順に2件）
    const out = [];
    for (const n of Object.keys(S.files)) {
      if (n === p.path || projByPath(n)) continue;
      const fm = splitFrontmatter(S.files[n].text).props || [];
      const pv = (fm.find(x => x.k.toLowerCase() === 'project')?.v || []).map(x => x.replace(/^\[\[|\]\]$/g, ''));
      if (pv.includes(p.name) || linksOf(n).includes(p.path)) out.push(n);
    }
    const t = n => S.files[n].mtime || (dayOf.get(n) ? parseKey(dayOf.get(n)).getTime() : 0);
    return out.sort((a, b) => t(b) - t(a)).slice(0, 2);
  }
  function projCard(p) {
    const tk = todayKey();
    const all = tasksOf(p), open = all.filter(t => !t.done);
    const isLate = t => !t.done && t.date && t.date < tk;
    const late = open.filter(isLate).length;
    const card = el('article', 'pcard');
    card.style.setProperty('--c', p.color);
    const goProj = () => { proj = p.path; tab = 'proj'; render(); window.scrollTo(0, 0); };

    // はみ出た紙：次の節目＋期限の近い順のタスク（合わせて2行まで）
    const paper = el('div', 'pcPaper');
    const next = open.filter(t => t.milestone && t.date && t.date >= tk).sort(byDate)[0];
    if (next) {
      const n = Math.round((parseKey(next.date) - parseKey(tk)) / 864e5);
      const r = btn('pcLine pcNext', ['flag', el('span', 'nm', next.title)], () => openItem(next));
      r.title = '節目を開く';
      const sm = el('small'); sm.append(el('span', 'pcDate', `${sd(next.date)}・`), n === 0 ? '今日' : `あと${n}日`); r.append(sm);
      paper.append(r);
    }
    const soon = open.filter(t => !t.milestone).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    for (const t of soon.slice(0, next ? 1 : 2)) {
      const r = el('div', 'pcLine' + (isLate(t) ? ' late' : ''));
      const chk = btn('pcChk', 'check', () => setDone(t, true), '完了にする');
      chk.title = '完了にする';
      const nm = btn('pcTask', t.title, () => openItem(t));
      nm.title = 'タスクを開く';
      r.append(chk, nm);
      if (t.date) r.append(el('small', '', isLate(t) ? '期限切れ' : t.date === tk ? '今日' : sd(t.date)));
      paper.append(r);
    }
    if (!paper.children.length) {
      const r = btn('pcLine pcEmpty', ['plus', open.length ? '期限のあるタスクはありません' : 'タスクを追加'], () => { proj = p.path; tab = 'proj'; render(); });
      paper.append(r);
    }
    card.append(paper);

    // 表面：名前（押すとプロジェクトのページ）・数・ノート・リンク。編集はマウスを乗せたときだけ
    const front = el('div', 'pcFront');
    const head = el('div', 'pcHead');
    const nm = btn('pcName', el('span', 'nm', p.name), goProj);
    nm.title = 'メモ・リンク・タスクを開く';
    const acts = el('span', 'pcActs');
    const eb = btn('iconBtn', 'pencil', () => openProjectSheet(p), 'リンク・メモを編集'); eb.title = 'リンク・メモを編集';
    acts.append(eb);
    head.append(nm, acts);
    front.append(head);
    const meta = el('div', 'pcMeta');
    meta.append(el('span', '', all.length ? `残り ${open.length}件` : 'タスクなし'));
    if (late) { const s2 = el('span', 'late'); s2.innerHTML = icon('triangle-alert'); s2.append(`期限切れ ${late}`); meta.append(s2); }
    if (all.length) meta.append(el('span', '', `完了 ${all.length - open.length}/${all.length}`));
    front.append(meta);
    // 最近のノート（2件まで）とリンクを1行に
    const recent = projNotes(p);
    if (p.links.length || recent.length) {
      const links = el('div', 'pcLinks');
      for (const n of recent) {
        const a = btn('pcLink pcNote', ['file-text', el('span', '', nameOf(n))], () => openNote(n));
        a.title = `ノート「${nameOf(n)}」を開く`;
        links.append(a);
      }
      for (const l of p.links) {
        let host = l.url; try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch {}
        const a = btn('pcLink', ['link', el('span', '', l.title || host)], () => Bridge.api.app.openUrl(l.url));
        a.title = l.url;
        links.append(a);
      }
      front.append(links);
    }
    card.append(front);
    // 表面の空いているところを押しても、プロジェクトのページへ
    front.addEventListener('click', e => { if (!e.target.closest('button')) goProj(); });
    return card;
  }
  // カードを並べる。limit：1行に入るぶんだけ出して、残りは「ほか N件」（ガントの上）
  let cardsAll = false;
  function projCards(limit) {
    const box = el('div', 'pcards' + (limit ? '' : ' pgrid'));
    projects.forEach(p => box.append(projCard(p)));
    const add = btn('pcTile pcAdd', ['folder-plus', 'プロジェクトを追加'], () => openProjectSheet(null));
    box.append(add);
    if (!limit) return box;
    const more = btn('pcTile pcMore', [], () => { cardsAll = more.dataset.expanded !== '1'; layout(); });
    box.append(more);
    const layout = () => {
      const cards = [...box.querySelectorAll('.pcard')];
      if (!box.clientWidth) return;
      const min = parseFloat(getComputedStyle(box).getPropertyValue('--pc-min')) || 230, gap = 12;
      const cols = Math.max(1, Math.floor((box.clientWidth + gap) / (min + gap)));
      const fits = cards.length <= cols, expanded = cardsAll && !fits;
      const shown = fits || expanded ? cards.length : Math.max(1, cols - 1);
      cards.forEach((c, i) => { c.hidden = i >= shown; });
      add.hidden = !expanded && cards.length + 1 > cols;
      more.hidden = fits;
      more.dataset.expanded = expanded ? '1' : '';
      more.innerHTML = '';
      const lbl = el('span', 'lbl');
      lbl.innerHTML = icon(expanded ? 'chevron-up' : 'chevron-down');
      lbl.append(expanded ? 'たたむ' : `ほか ${cards.length - shown}件`);
      more.append(lbl);
      if (!expanded) {
        const names = el('span', 'names');
        projects.slice(shown, shown + 3).forEach(p => { const n = el('span', 'nm'); const d = el('i', 'dot'); d.style.background = p.color; n.append(d, el('span', '', p.name)); names.append(n); });
        more.append(names);
      }
    };
    new ResizeObserver(() => requestAnimationFrame(layout)).observe(box);
    return box;
  }

  function renderProj(main) {
    if (proj && projByPath(proj)) return renderProjDetail(main, projByPath(proj));
    proj = null;
    if (isWide() && projView === 'gantt') return renderGanttWide(main);
    const tool = el('div', 'gtool');
    const seg = el('div', 'seg');
    seg.append(btn(projView === 'list' ? 'on' : '', '一覧', () => { projView = 'list'; render(); }),
      btn(projView === 'gantt' ? 'on' : '', 'ガント', () => { projView = 'gantt'; render(); }));
    seg.classList.add('mobileOnly');
    tool.append(seg);
    if (projView === 'gantt') {
      const s2 = el('div', 'seg');
      s2.append(btn(prefs.showDone ? '' : 'on', '進行中', () => { prefs.showDone = false; savePrefs(); render(); }),
        btn(prefs.showDone ? 'on' : '', 'すべて', () => { prefs.showDone = true; savePrefs(); render(); }));
      tool.append(s2);
    }
    main.append(tool);
    if (projView === 'gantt') return renderGantt(main);

    main.append(projCards(false));
    if (!projects.length) {
      const p = panel();
      p.append(panelHead('info', 'プロジェクトの書き方'));
      p.innerHTML += `<ul class="steps"><li><code>Projects/</code> フォルダにノートを作ると、1つのプロジェクトになります</li>
        <li>タスク：<code>- [ ] 画面設計 🛫 2026-11-10 📅 2026-11-14</code>（🛫 開始・📅 期限）</li>
        <li>節目（締切・発表日）：<code>- [ ] 発表 📅 2026-11-28 #節目</code></li>
        <li>ほかのノートでも <code>- [ ] API修正 [[プロジェクト名]]</code> と書けば、そのプロジェクトのタスク</li></ul>`;
      main.append(p);
      return;
    }
    // 期限が近いタスク（全部のプロジェクトから）
    const t = todayKey();
    const soon = items.filter(i => i.type === 'todo' && i.project && !i.done && i.date).sort(byDate).slice(0, 12);
    const ps = panel();
    ps.append(panelHead('clock', '期限が近いタスク', el('span', '', `${soon.length}件`)));
    if (!soon.length) ps.append(noData('期限のあるタスクはありません'));
    if (isWide()) { const ul = el('ul', 'list flat'); soon.forEach(i => ul.append(taskLi(i))); ps.append(ul); }
    else soon.forEach(i => ps.append(todoRow(i, { proj: true })));
    main.append(ps);
    const nod = items.filter(i => i.type === 'todo' && i.project && !i.done && !i.date);
    if (nod.length) {
      const pn = panel();
      pn.append(panelHead('inbox', '日付なし', el('span', '', `${nod.length}件`)));
      nod.forEach(i => pn.append(todoRow(i, { proj: true })));
      main.append(pn);
    }
    void t;
  }

  function renderProjDetail(main, p) {
    const today = todayKey();
    const all = tasksOf(p);
    const open = all.filter(t => !t.done).sort(byDate);
    const done = all.filter(t => t.done);
    const bar = el('div', 'noteBar');
    bar.append(btn('btn white small', ['chevron-left', 'プロジェクト'], () => { proj = null; render(); }), el('span', 'notePath', ''),
      btn('btn white small', ['palette', '色'], () => openProjectSheet(p)),
      btn('btn white small', ['file-text', 'ノート'], () => openNote(p.path)));
    if (!isWide()) main.append(bar);
    const W = isWide();
    const pjL = el('div', 'pj-col'), pjR = el('div', 'pj-col');

    // まとめ（進み具合・期間・次の期限）
    const sm = panel('projSum');
    sm.style.setProperty('--c', p.color);
    const pct = all.length ? Math.round(done.length / all.length * 100) : 0;
    const dated = all.filter(t => t.date);
    const s = dated.length ? dated.map(t => spanOf(t).s).sort()[0] : null;
    const e = dated.length ? dated.map(t => t.date).sort().slice(-1)[0] : null;
    const top = el('div', 'psTop');
    top.append(el('i', 'dot'), el('b', '', `${pct}%`), el('small', '', `完了 ${done.length}/${all.length}`));
    sm.append(top);
    const pb = el('div', 'psBar'); const pf = el('i'); pf.style.width = pct + '%'; pb.append(pf); sm.append(pb);
    const meta = el('div', 'psMeta');
    if (s) meta.append(el('span', '', `期間 ${sd(s)} 〜 ${sd(e)}`));
    const next = open.find(t => t.date);
    if (next) meta.append(el('span', next.date < today ? 'bad' : '', `次の期限 ${relDay(next.date)}：${next.title}`));
    const late = open.filter(t => t.date && t.date < today).length;
    if (late) meta.append(el('span', 'bad', `期限切れ ${late}件`));
    sm.append(meta);
    if (!W) main.append(sm);
    else {
      const ks = el('div', 'pj-kpis');
      const kpi = (ic, lb, val, sub, bad) => { const k = el('div', 'pj-kpi'); k.style.setProperty('--c', p.color); const l = el('div', 'lb'); l.innerHTML = icon(ic); l.append(lb); k.append(l, el('b', '', val)); if (sub != null) k.append(sub instanceof Node ? sub : el('small', bad ? 'bad' : '', sub)); return k; };
      const tr = el('div', 'track'); const ts = el('span'); ts.style.width = pct + '%'; tr.append(ts);
      const msN = open.filter(x => x.milestone && x.date)[0];
      const daysTo = msN ? diffDays(today, msN.date) : null;
      ks.append(kpi('trending-up', '進み具合', pct + '%', tr),
        kpi('list-todo', '残りのタスク', `${open.length}件`, `完了 ${done.length}件${late ? ` ・ 期限切れ ${late}件` : ''}`, late > 0),
        kpi('flag', '次の節目', msN ? (daysTo < 0 ? `${-daysTo}日すぎ` : daysTo === 0 ? '今日' : `あと${daysTo}日`) : '—', msN ? `${msN.title}（${sd(msN.date)}）` : '#節目 のタスクはありません', daysTo != null && daysTo < 0),
        kpi('calendar-days', '期間', s ? `${sd(s)} 〜 ${sd(e)}` : '—', next ? `次の期限 ${relDay(next.date)}：${next.title}` : '期限のあるタスクはありません', next && next.date < today));
      main.append(ks);
    }

    // タスク
    const pt = panel();
    pt.append(panelHead('list-todo', 'タスク', el('span', '', `${open.length}件`)));
    if (!all.length) pt.append(noData('まだタスクはありません'));
    const rowOf = t => (isWide() ? taskLi(t) : todoRow(t, { proj: true, inProj: true }));
    const tl = isWide() ? el('ul', 'list flat') : pt;
    open.forEach(t => tl.append(rowOf(t)));
    if (isWide()) pt.append(tl);
    if (done.length) {
      pt.append(btn('addTask', [prefs.showDoneIn ? 'chevron-down' : 'chevron-right', `完了 ${done.length}件`], () => { prefs.showDoneIn = !prefs.showDoneIn; savePrefs(); render(); }));
      if (prefs.showDoneIn) { const dl = isWide() ? el('ul', 'list flat') : pt; done.forEach(t => dl.append(rowOf(t))); if (isWide()) pt.append(dl); }
    }
    // タスクを足す（名前・開始・期限・節目）
    const f = el('form', 'ptAdd');
    const nm = el('input', 'inp'); nm.placeholder = 'タスクを足す'; nm.maxLength = 200;
    const st = el('input', 'inp'); st.type = 'date'; st.title = '開始';
    const du = el('input', 'inp'); du.type = 'date'; du.title = '期限';
    const ms = el('label', 'msChk'); const mc = el('input'); mc.type = 'checkbox'; ms.append(mc, '節目');
    const row2 = el('div', 'ptRow');
    const lab = (t, i) => { const l = el('label', 'ptDate'); l.append(el('span', '', t), i); return l; };
    row2.append(lab('開始', st), lab('期限', du), ms);
    f.append(nm, row2, btn('btn primary small', ['plus', '足す'], () => f.requestSubmit()));
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const v = nm.value.trim(); if (!v) { nm.focus(); return; }
      let line = v;
      if (st.value && !mc.checked) line += ` 🛫 ${st.value}`;
      if (du.value) line += ` 📅 ${du.value}`;
      if (mc.checked) line += ' #節目';
      const ok = await edit(p.path, t => MDParser.addTodo(t ?? '', line), `タスク: ${v}`);
      if (ok) toast('タスクを足しました');
    });
    pt.append(f);
    if (W) pjR.append(pt); else main.append(pt);

    if (p.memo) {
      const pm = panel();
      pm.append(panelHead('notebook-text', 'メモ'));
      setupMarked();
      const d = el('div', 'nt-doc memoDoc');
      d.innerHTML = window.DOMPurify.sanitize(window.marked.parse(p.memo));
      d.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
      if (W) d.classList.add('pj-memo');
      pm.append(d);
      if (W) pjL.append(pm); else main.append(pm);
    }
    if (p.links.length) {
      const pl = panel();
      pl.append(panelHead('link', 'リンク', el('span', '', `${p.links.length}件`)));
      p.links.forEach(l => {
        const go = () => (desk ? desk.openExternal(l.url) : window.open(l.url, '_blank', 'noopener'));
        if (W) {
          // Mac と同じ：頭文字の四角＋名前＋ドメイン
          const r = btn('pj-link', [], go, l.title);
          r.style.setProperty('--c', p.color);
          const tx = el('span', 'tx'); let host = ''; try { host = new URL(l.url).host; } catch {}
          tx.append(el('b', '', l.title), el('small', '', host));
          r.append(el('span', 'pj-fav', (l.title.trim()[0] || '?').toUpperCase()), tx);
          r.insertAdjacentHTML('beforeend', icon('external-link'));
          pl.append(r);
          return;
        }
        const r = btn('prow', [], go);
        r.insertAdjacentHTML('beforeend', icon('link-2'));
        r.append(el('b', '', l.title));
        r.insertAdjacentHTML('beforeend', icon('external-link'));
        pl.append(r);
      });
      if (W) pjL.append(pl); else main.append(pl);
    }
    if (W) {
      if (!p.memo && !p.links.length) { const em = panel(); em.append(panelHead('notebook-text', 'メモ・リンク')); em.append(noData('ノートの最初の見出しまでがメモ、先頭の links: がリンクになります')); em.append(btn('btn small white', ['file-text', 'ノートを開いて書く'], () => openNote(p.path))); pjL.append(em); }
      const g = el('div', 'pj-grid'); g.append(pjL, pjR); main.append(g);
    }
  }

  // 先頭のプロパティの1つを書きかえる（なければ足す）
  function setProp(text, key, value) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    const line = `${key}: ${value}`;
    if (!m) return `---\n${line}\n---\n${text}`;
    const ls = m[1].split(/\r?\n/);
    const i = ls.findIndex(l => new RegExp(`^${key}\\s*:`, 'i').test(l));
    if (i >= 0) ls[i] = line; else ls.push(line);
    return `---\n${ls.join('\n')}\n---${m[2]}` + text.slice(m[0].length);
  }
  function openProjectSheet(p) {
    const isNew = !p;
    const inn = $('#sheetIn');
    sheetHead(inn, isNew ? 'プロジェクトを追加' : 'プロジェクトの色');
    let color = p?.color || P_COLORS[projects.length % P_COLORS.length];
    const name = el('input', 'inp'); name.placeholder = '例：ほのぼの書店'; name.maxLength = 80;
    if (isNew) { const l = el('label', 'fld'); l.append(el('span', '', '名前'), name); inn.append(l); }
    const box = el('div', 'swatches');
    P_COLORS.forEach(c => {
      const b = btn('sw' + (c === color ? ' on' : ''), [], () => { box.querySelectorAll('.sw').forEach(x => x.classList.remove('on')); b.classList.add('on'); color = c; }, c);
      b.style.background = c;
      box.append(b);
    });
    const cl = el('div', 'fld'); cl.append(el('span', '', '色'), box);
    inn.append(cl);
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', isNew ? ['folder-plus', '作る'] : ['check', '保存'], async () => {
      if (!isNew) { sheet.close(); await edit(p.path, t => setProp(t, 'color', `"${color}"`), `プロジェクトの色: ${p.name}`); return; }
      const v = name.value.trim().replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim();
      if (!v) { name.focus(); return; }
      const folder = projects.find(x => isProjFolder(x.path))?.path.split('/')[0] || 'Projects';
      const rel = `${folder}/${v}.md`;
      sheet.close();
      if (S.files[rel]) { proj = rel; render(); return; }
      if (await edit(rel, () => `---\ncolor: "${color}"\n---\n\n## タスク\n`, `プロジェクトを作成: ${v}`)) { proj = rel; tab = 'proj'; render(); toast('プロジェクトを作りました'); }
    }));
    inn.append(bs);
    sheet.showModal();
    if (isNew) setTimeout(() => name.focus(), 50);
  }

  // ---------- ガントチャート（Workstation モバイルと同じ形：プロジェクトの帯の下にタスクのバー、節目は丸） ----------
  const G_BEFORE = 14, G_AFTER = 75, DW = 34;
  const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  function renderGantt(main) {
    const today = todayKey();
    const tasks = items.filter(i => i.type === 'todo' && i.project && i.date && (prefs.showDone || !i.done));
    const lastDue = tasks.reduce((m, t) => (t.date > m ? t.date : m), today);
    const firstStart = tasks.reduce((m, t) => (spanOf(t).s < m ? spanOf(t).s : m), addDays(today, -G_BEFORE));
    const from = firstStart < addDays(today, -60) ? addDays(today, -60) : firstStart;
    const days = Math.min(550, Math.max(diffDays(from, today) + G_AFTER + 1, diffDays(from, lastDue) + 8));
    const xOf = k => diffDays(from, k) * DW;
    const wrap = el('div', 'gwrap');
    const sc = el('div', 'gscroll');
    const inner = el('div', 'ginner');
    inner.style.width = days * DW + 'px';
    inner.style.setProperty('--dw', DW + 'px');
    sc.append(inner);
    wrap.append(sc);
    const head = el('div', 'ghead');
    for (let i = 0; i < days;) {
      const d = parseKey(addDays(from, i));
      const n = Math.min(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1, days - i);
      const mc = el('div', 'mcell'); mc.style.left = i * DW + 'px'; mc.style.width = n * DW + 'px';
      mc.append(el('span', '', `${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月`));
      head.append(mc);
      i += n;
    }
    for (let i = 0; i < days; i++) {
      const k = addDays(from, i), d = parseKey(k);
      const c = el('div', 'dcell' + ([0, 6].includes(d.getDay()) ? ' we' : '') + (k === today ? ' today' : ''));
      c.style.left = i * DW + 'px';
      c.append(el('span', '', String(d.getDate())));
      head.append(c);
    }
    inner.append(head);
    const body = el('div', 'gbody');
    const bg = el('div', 'gbg');
    for (let i = 0; i < days; i++) { const wd = parseKey(addDays(from, i)).getDay(); if (wd === 0 || wd === 6) { const o = el('i', 'g-we'); o.style.left = i * DW + 'px'; bg.append(o); } }
    const tl = el('i', 'g-now'); tl.style.left = (xOf(today) + DW / 2 - 1) + 'px';
    bg.append(tl);
    body.append(bg);
    const groups = projects.map(p => ({ p, list: tasks.filter(t => t.project === p.path).sort((a, b) => (spanOf(a).s < spanOf(b).s ? -1 : spanOf(a).s > spanOf(b).s ? 1 : byDate(a, b))) })).filter(g => g.list.length);
    if (!groups.length) {
      const e = el('div', 'empty');
      e.innerHTML = icon('chart-gantt');
      e.append(el('p', '', prefs.showDone ? '日付のあるタスクはありません' : '進行中のタスクはありません（📅 期限を付けるとここに出ます）'));
      body.append(e);
    }
    const label = (t, x) => {
      const lb = btn('blabel' + (t.done ? ' done' : ''), [], () => openItem(t), t.title);
      if (t.done) lb.insertAdjacentHTML('beforeend', icon('check'));
      else if (t.date < today) { lb.insertAdjacentHTML('beforeend', icon('triangle-alert')); lb.lastChild.classList.add('bad'); }
      lb.append(el('span', '', t.title));
      lb.style.left = x + 'px';
      return lb;
    };
    groups.forEach((g, gi) => {
      const closed = prefs.closed.includes(g.p.path);
      const all = g.list, dn = all.filter(t => t.done).length;
      const row = el('div', 'grow grp' + (gi ? '' : ' first') + (closed ? ' closed' : ''));
      row.style.setProperty('--c', g.p.color);
      const nb = btn('grpName', ['chevron-down'], () => { prefs.closed = closed ? prefs.closed.filter(x => x !== g.p.path) : [...prefs.closed, g.p.path]; savePrefs(); render(); });
      nb.append(el('i', 'dot'), el('span', 'nm', g.p.name), el('small', '', `${dn}/${all.length}`));
      row.append(nb);
      const s = all.map(t => spanOf(t).s).sort()[0], e = all.map(t => t.date).sort().slice(-1)[0];
      const pb = el('div', 'pbar');
      pb.style.left = xOf(s) + 'px'; pb.style.width = (diffDays(s, e) + 1) * DW + 'px';
      const pf = el('i'); pf.style.width = Math.round(dn / all.length * 100) + '%';
      pb.append(pf);
      row.append(pb);
      body.append(row);
      if (closed) return;
      for (const t of all) {
        const r = el('div', 'grow');
        r.style.setProperty('--c', g.p.color);
        const { s: ts, e: te } = spanOf(t);
        if (t.milestone) {
          const m = btn('ms' + (t.done ? ' isdone' : '') + (!t.done && te < today ? ' late' : ''), [], () => openItem(t), t.title);
          m.style.left = (xOf(te) + DW / 2 - 10) + 'px';
          r.append(m, label(t, xOf(te) + DW / 2 + 16));
        } else {
          const x = xOf(ts), w = (diffDays(ts, te) + 1) * DW;
          const b = btn('bar' + (t.done ? ' isdone' : '') + (!t.done && te < today ? ' late' : ''), [], () => openItem(t), t.title);
          b.style.left = x + 'px'; b.style.width = w + 'px';
          const pr = el('div', 'prog'); pr.style.width = (t.done ? 100 : 0) + '%'; b.append(pr);
          r.append(b, label(t, x + w + 8));
        }
        body.append(r);
      }
    });
    inner.append(body);
    main.append(wrap);
    sc.scrollLeft = ganttScroll ?? Math.max(0, xOf(today) - 2 * DW);
    let raf = 0;
    sc.addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; ganttScroll = sc.scrollLeft; }); }, { passive: true });
  }

  // ================= ノート =================
  function renderNotes(main) {
    if (ntOn()) return;   // PC の幅：旧 Workstation のノートの画面（render() が出す）
    if (note) return renderNote(main);
    if (isWide() && !noteQuery.trim()) return renderNotesWide(main);
    const q = el('input', 'inp search');
    q.placeholder = 'ノートを検索（名前・本文・#タグ）';
    q.value = noteQuery;
    q.addEventListener('input', () => { noteQuery = q.value; drawList(); });
    main.append(q);
    if (!isWide()) main.append(btn('btn white wide ngEntry', ['orbit', 'ノートのつながりを見る'], () => switchTab('graph')));
    const box = el('div');
    main.append(box);
    const paths = Object.keys(S.files).sort((a, b) => a.localeCompare(b, 'ja'));
    const openCount = p => items.filter(i => i.path === p && i.type === 'todo' && !i.done).length;
    const row = (p, opt = {}) => {
      const r = btn('prow', [], () => openNote(p));
      r.insertAdjacentHTML('beforeend', icon(isMainDaily(p) ? 'notebook-text' : 'file-text'));
      const b = el('b', '', nameOf(p));
      if (opt.date && dayOf.has(p)) b.append(el('small', '', '  ' + sd(dayOf.get(p))));
      const tg = (noteTags.get(p) || []).slice(0, 3);
      if (tg.length) { const t = el('span', 'ntags'); tg.forEach(x => t.append(el('i', '', '#' + x))); b.append(t); }
      r.append(b);
      const n = openCount(p);
      if (n) r.append(el('span', 'chip', `まだ ${n}`));
      r.insertAdjacentHTML('beforeend', icon('chevron-right'));
      return r;
    };
    // カテゴリ（タグ）で絞り込む
    const tagCount = new Map();
    for (const p of paths) for (const t of noteTags.get(p) || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    if (tagCount.size) {
      const tb = el('div', 'tagBar mobileOnly');
      [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).forEach(([t, n]) =>
        tb.append(btn('chip' + (noteTag === t ? ' ok' : ''), `#${t} ${n}`, () => { noteTag = noteTag === t ? null : t; render(); })));
      main.insertBefore(tb, box);
    }
    function drawList() {
      box.innerHTML = '';
      const s = noteQuery.trim().toLowerCase();
      if (noteDay && !s) {
        const pl = panel();
        pl.append(panelHead('calendar-days', md(noteDay), [el('span', '', `${dayFiles(noteDay).length}件`), btn('linkBtn', '＋ ノート', () => newNote({ day: noteDay }))]));
        dayFiles(noteDay).forEach(p => pl.append(row(p)));
        box.append(pl);
        return;
      }
      if (noteFolder && !s) {
        const f = noteFolder === '（いちばん上）' ? '' : noteFolder;
        const hit = paths.filter(p => !dayOf.has(p) && folderOf(p) === f);
        const pl = panel();
        pl.append(panelHead('folder', noteFolder, el('span', '', `${hit.length}件`)));
        hit.forEach(p => pl.append(row(p)));
        box.append(pl);
        return;
      }
      if (noteTag && !s) {
        const hit = paths.filter(p => (noteTags.get(p) || []).includes(noteTag)).sort((a, b) => ((dayOf.get(b) || '') > (dayOf.get(a) || '') ? 1 : (dayOf.get(b) || '') < (dayOf.get(a) || '') ? -1 : a.localeCompare(b, 'ja')));
        const pl = panel();
        pl.append(panelHead('tag', '#' + noteTag, el('span', '', `${hit.length}件`)));
        hit.forEach(p => pl.append(row(p, { date: true })));
        box.append(pl);
        return;
      }
      if (s) {
        const hit = paths.filter(p => p.toLowerCase().includes(s) || S.files[p].text.toLowerCase().includes(s.replace(/^#/, s.startsWith('#') ? '#' : '')));
        const pl = panel();
        pl.append(panelHead('search', '見つかったノート', el('span', '', `${hit.length}件`)));
        if (!hit.length) pl.append(noData('見つかりませんでした'));
        hit.slice(0, 100).forEach(p => pl.append(row(p)));
        box.append(pl);
        return;
      }
      // 日付ごと（新しい日から）
      const days = [...new Set(paths.filter(p => dayOf.has(p)).map(p => dayOf.get(p)))].sort().reverse();
      const pd = panel();
      pd.append(panelHead('calendar-days', '日付ごと', [el('span', '', `${days.length}日`), btn('linkBtn', '＋ 今日', () => newNote({ day: todayKey() }))]));
      if (!days.length) pd.append(noData('まだありません'));
      days.slice(0, showDays).forEach(k => {
        pd.append(el('div', 'hb-sep', `${relDay(k)}${relDay(k) !== md(k) ? '　' + md(k) : ''}`));
        dayFiles(k).forEach(p => pd.append(row(p)));
      });
      if (days.length > showDays) pd.append(btn('addTask', ['chevron-down', `もっと前（あと ${days.length - showDays} 日）`], () => { showDays += 14; render(); }));
      box.append(pd);
      const others = paths.filter(p => !dayOf.has(p));
      const groups = new Map();
      others.forEach(p => { const f = folderOf(p); (groups.get(f) || groups.set(f, []).get(f)).push(p); });
      const pa = panel();
      pa.append(panelHead('folder', 'ノート', el('span', '', `${others.length}件`)));
      if (!others.length) pa.append(noData('まだありません'));
      [...groups.keys()].sort((a, b) => a.localeCompare(b, 'ja')).forEach(f => {
        if (f) pa.append(el('div', 'hb-sep', f));
        groups.get(f).forEach(p => pa.append(row(p)));
      });
      box.append(pa);
    }
    drawList();
  }

  // ================= ノートのつながり（graph.js で描く） =================
  // カテゴリ：タグ（先頭の tags・本文の #タグ）か、いちばん上のフォルダ。線：[[リンク]]・[名前](ノート.md)
  let graphBy = (() => { try { return localStorage.getItem('ws-notes.graphBy') || 'tag'; } catch { return 'tag'; } })();
  let graphObj = null;
  const linkCache = new Map();
  function linksOf(p) {
    const t = S.files[p]?.text || '';
    const c = linkCache.get(p);
    if (c && c.t === t) return c.v;
    const out = new Set();
    const body = t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
    for (const m of body.matchAll(/!?\[\[([^\]|#^\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) { const r = resolve(m[1], p); if (r && r !== p) out.add(r); }
    for (const m of body.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gi)) { let u = m[1]; try { u = decodeURIComponent(u); } catch {} const r = resolve(u.replace(/^\.?\//, ''), p); if (r && r !== p) out.add(r); }
    const v = [...out];
    linkCache.set(p, { t, v });
    return v;
  }
  function graphData() {
    const NONE = NoteGraph.NONE;
    const cats = p => {
      if (graphBy === 'folder') { const f = folderOf(p).split('/')[0]; return [f ? (/^\d{4}$/.test(f) ? `${f}（日付）` : f) : 'いちばん上']; }
      const t = noteTags.get(p) || [];
      return t.length ? t : [NONE];
    };
    const nodes = [], links = [], cnt = new Map();
    for (const p of Object.keys(S.files)) {
      const g = cats(p);
      g.forEach(x => cnt.set(x, (cnt.get(x) || 0) + 1));
      nodes.push({ id: p, name: isMainDaily(p) ? `${dayOf.get(p)} ${nameOf(p)}` : nameOf(p), groups: g, folder: folderOf(p), day: dayOf.get(p) || '' });
      for (const q of linksOf(p)) links.push([p, q]);
    }
    const groups = [...cnt.entries()].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([id, count]) => ({ id, name: graphBy === 'tag' && id !== NONE ? '#' + id : id, count }));
    return { nodes, links, groups };
  }
  function graphView() {
    if (!graphObj) graphObj = NoteGraph.create({ onOpen: p => openNote(p) });
    return graphObj;
  }
  function graphBySeg() {
    const seg = el('div', 'seg ngBy');
    for (const [k, l] of [['tag', 'タグ'], ['folder', 'フォルダ']]) seg.append(btn(graphBy === k ? 'on' : '', l, () => { graphBy = k; try { localStorage.setItem('ws-notes.graphBy', k); } catch {} graphView().setData(graphData()); render(); }, `カテゴリを${l}で分ける`));
    return seg;
  }
  function renderGraph(main) {
    const g = graphView();
    g.setData(graphData());
    if (isWide()) { const st = g.stats(); $('#eyebrow').textContent = `${st.notes} ノート・${st.links} リンク・${st.groups} カテゴリ`; }
    if (isWide() && sideHidden()) g.listInto(null);
    if (!isWide()) { const top = el('div', 'ngMTop'); top.append(btn('btn white small', ['chevron-left', 'ノート'], () => switchTab('notes')), graphBySeg()); main.append(top); g.listInto(null); }
    main.append(g.el);
  }

  // ---------- Markdown → 画面（Mac の notes.js と同じ拡張） ----------
  const allPaths = () => Object.keys(S.files);
  function resolve(target, from = '') {
    const t = String(target || '').trim().replace(/\.md$/i, '').toLowerCase();
    if (!t) return null;
    const ps = allPaths();
    if (t.includes('/')) return ps.find(p => p.toLowerCase() === t + '.md') || ps.find(p => p.toLowerCase().endsWith('/' + t + '.md')) || null;
    const hits = ps.filter(p => nameOf(p).toLowerCase() === t);
    if (hits.length <= 1) return hits[0] || null;
    return hits.find(p => folderOf(p) === folderOf(from)) || hits.sort((a, b) => a.length - b.length)[0];
  }
  let markedReady = false;
  function setupMarked() {
    if (markedReady) return;
    markedReady = true;
    window.marked.use({
      gfm: true, breaks: true,
      extensions: [
        { name: 'wikilink', level: 'inline',
          start: src => { const i = src.indexOf('[['); return i < 0 ? undefined : (src[i - 1] === '!' ? i - 1 : i); },
          tokenizer(src) { const m = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src); if (!m) return; const [target, alias] = m[2].split('|'); return { type: 'wikilink', raw: m[0], embed: !!m[1], target: target.trim(), alias: (alias || '').trim() }; },
          renderer(t) {
            const n = resolve(t.target.split('#')[0], note);
            if (t.embed && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(t.target)) return `<span class="nt-imgph">${icon('image')}${esc(t.target)}</span>`;
            const label = t.alias || t.target.replace(/#/, ' › ');
            return `<a class="internal-link${t.embed ? ' nt-embed' : ''}${n ? '' : ' is-unresolved'}" data-href="${esc(t.target)}" href="#">${esc(label)}</a>`;
          } },
        { name: 'cmtBlock', level: 'block',
          start: src => { const m = /(^|\n)%%/.exec(src); return m ? m.index + m[1].length : undefined; },
          tokenizer(src) { const m = /^%%[\s\S]*?%%[^\n]*(?:\n|$)/.exec(src); if (m && /^%%[\s\S]*?%%\s*(?:\n|$)/.test(m[0])) return { type: 'cmtBlock', raw: m[0] }; },
          renderer: () => '' },
        { name: 'cmt', level: 'inline',
          start: src => { const i = src.indexOf('%%'); return i < 0 ? undefined : i; },
          tokenizer(src) { const m = /^%%[\s\S]*?%%/.exec(src); if (m) return { type: 'cmt', raw: m[0] }; },
          renderer: () => '' },
        { name: 'mark', level: 'inline',
          start: src => { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
          tokenizer(src) { const m = /^==(?=\S)([^\n]*?\S)==/.exec(src); if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) }; },
          renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; } },
        { name: 'tag', level: 'inline',
          start: src => { const m = /(^|[\s(（「、。])#[^\s#]/.exec(src); return m ? m.index + m[1].length : undefined; },
          tokenizer(src) { const m = /^#([^\s#.,;:!?()[\]{}"'`、。「」（）<>]+)/.exec(src); if (m && !/^\d+$/.test(m[1])) return { type: 'tag', raw: m[0], tag: m[1] }; },
          renderer(t) { return `<a class="tag" data-tag="${esc(t.tag)}" href="#">#${esc(t.tag)}</a>`; } },
      ],
    });
  }
  function splitFrontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
    if (!m) return { props: null, body: text };
    const props = [];
    let last = null;
    for (const line of m[1].split(/\r?\n/)) {
      const it = /^\s*-\s+(.*)$/.exec(line);
      if (it && last) { last.v.push(it[1].replace(/^["']|["']$/g, '')); continue; }
      const kv = /^([^:#\s][^:]*):\s*(.*)$/.exec(line);
      if (!kv) continue;
      const v = kv[2].trim();
      last = { k: kv[1].trim(), v: !v ? [] : /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [v.replace(/^["']|["']$/g, '')] };
      props.push(last);
    }
    return { props, body: text.slice(m[0].length) };
  }
  function propsEl(props) {
    const t = el('div', 'metadata-container');
    for (const p of props) {
      const r = el('div', 'metadata-property');
      r.append(el('span', 'k', p.k));
      const v = el('span', 'v');
      for (const x of p.v) {
        if (/^tags?$/i.test(p.k)) { const a = el('a', 'tag', '#' + x.replace(/^#/, '')); a.href = '#'; a.dataset.tag = x.replace(/^#/, ''); v.append(a); }
        else { const m = /^\[\[(.+?)(\|.*)?\]\]$/.exec(x); if (m) { const a = el('a', 'internal-link', m[1]); a.href = '#'; a.dataset.href = m[1]; v.append(a); } else v.append(el('span', 'pv', x)); }
      }
      r.append(v);
      t.append(r);
    }
    return t;
  }
  const CALLOUT_ICON = {
    note: 'pencil', info: 'info', tip: 'flame', hint: 'flame', important: 'flame', success: 'check', check: 'check', done: 'check',
    question: 'circle-help', help: 'circle-help', faq: 'circle-help', warning: 'triangle-alert', caution: 'triangle-alert', attention: 'triangle-alert',
    danger: 'zap', error: 'zap', failure: 'x', fail: 'x', missing: 'x', bug: 'bug', example: 'list', quote: 'quote', cite: 'quote',
    abstract: 'clipboard-list', summary: 'clipboard-list', tldr: 'clipboard-list', todo: 'circle-check',
  };
  function taskLines(text) {
    const out = [];
    let fence = false;
    text.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
      if (!fence && /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.test(l)) out.push(i);
    });
    return out;
  }
  function decorate(root, path, text) {
    for (const bq of [...root.querySelectorAll('blockquote')]) {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') continue;
      const m = /^\s*\[!([\w-]+)\]([+-]?)/.exec(p.textContent);
      if (!m) continue;
      const parts = p.innerHTML.split(/<br\s*\/?>\n?/i);
      const titleHtml = parts.shift().replace(/^\s*\[![\w-]+\][+-]?\s*/, '').trim();
      const type = m[1].toLowerCase();
      const c = el('div', 'callout' + (m[2] ? ' is-collapsible' : '') + (m[2] === '-' ? ' is-collapsed' : ''));
      c.dataset.callout = type;
      const head = el('div', 'callout-title');
      const ic = el('div', 'callout-icon');
      ic.innerHTML = icon(CALLOUT_ICON[type] || 'pencil');
      const inner = el('div', 'callout-title-inner');
      if (titleHtml) inner.innerHTML = titleHtml; else inner.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      head.append(ic, inner);
      if (m[2]) { const f = el('div', 'callout-fold'); f.innerHTML = icon('chevron-down'); head.append(f); head.addEventListener('click', () => c.classList.toggle('is-collapsed')); }
      const body = el('div', 'callout-content');
      const rest = parts.join('<br>').replace(/^\s*\n/, '');
      if (rest.trim()) { const np = el('p'); np.innerHTML = rest; body.append(np); }
      [...bq.children].slice(1).forEach(x => body.append(x));
      c.append(head);
      if (body.childNodes.length) c.append(body);
      bq.replaceWith(c);
    }
    // チェックリスト：押すとファイルにも反映（Mac と同じ）
    const lines = taskLines(text);
    [...root.querySelectorAll('input[type="checkbox"]')].forEach((cb, i) => {
      cb.disabled = false;
      cb.classList.add('task-list-item-checkbox');
      cb.closest('li')?.classList.add('task-list-item');
      if (cb.checked) cb.closest('li')?.classList.add('is-checked');
      cb.addEventListener('change', () => {
        const ln = lines[i];
        if (ln == null) return;
        const raw = text.split('\n')[ln];
        edit(path, t => MDParser.toggle(t, ln, raw, cb.checked), `${cb.checked ? '完了' : '未完了'}: ${MDParser.clean(raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s*/, ''))}`);
      });
    });
    root.querySelectorAll('pre').forEach(pre => {
      pre.append(btn('nt-copy', 'copy', async () => { try { await navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText); toast('コピーしました'); } catch {} }, 'コピー'));
    });
    root.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }
  function noteDoc(path, text) {
    setupMarked();
    const doc = el('div', 'nt-doc');
    const { props, body } = splitFrontmatter(text);
    const firstH1 = /^#\s+(.+?)\s*$/.exec(body.trimStart().split('\n')[0]);
    if (!(firstH1 && firstH1[1].trim() === nameOf(path))) doc.append(el('div', 'inline-title', nameOf(path)));
    if (props && props.length) doc.append(propsEl(props));
    let html = '';
    try { html = window.marked.parse(body); } catch (e) { html = `<pre>${esc(e.message)}</pre>`; }
    const content = el('div', 'nt-content');
    content.innerHTML = window.DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i, ADD_ATTR: ['target'] });
    doc.append(content);
    decorate(content, path, text);
    doc.addEventListener('click', e => {
      const a = e.target.closest('a.internal-link, a.tag');
      if (!a) return;
      e.preventDefault();
      if (a.classList.contains('tag')) { note = null; noteQuery = '#' + a.dataset.tag; render(); return; }
      const target = a.dataset.href.split('#')[0];
      const hit = resolve(target, path);
      if (hit) openNote(hit);
      else if (confirm(`「${target}」はまだありません。作りますか？`)) {
        const rel = (target.includes('/') ? target : (folderOf(path) ? folderOf(path) + '/' : '') + target).replace(/\.md$/i, '') + '.md';
        edit(rel, () => '', `ノートを作成: ${rel}`).then(ok => { if (ok) { openNote(rel); startEdit(); } });
      }
    });
    return doc;
  }
  function openNote(p) {
    if (isWide() && window.NotesApp) { note = null; editing = false; if (tab !== 'notes') { tab = 'notes'; render(); } NotesApp.open(p); return; }
    if (editing && note && draft !== (S.files[note]?.text ?? '') && !confirm('保存していない変更があります。破棄しますか？')) return;
    note = p; editing = false;
    if (tab !== 'notes') tab = 'notes';
    render(); window.scrollTo(0, 0); $('#view').scrollTop = 0;
  }
  function startEdit() { editing = true; draft = S.files[note]?.text ?? ''; render(); }
  // ---------- スマホ：ノートを書くときの Markdown のボタン（画面の上に固定） ----------
  // 押しても入力欄から外れない（キーボードが閉じない）。行の頭につけるもの（見出し・チェックなど）は、もう一度押すと外れる
  // 書きかえは execCommand('insertText') で行う（「元に戻す」が効くように）
  const MDK_ICONS = {
    indent: '<path d="M3 5h18"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="m3 9 4 3-4 3"/>',
    outdent: '<path d="M3 5h18"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="m7 9-4 3 4 3"/>',
    'keyboard-off': '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  };
  Object.entries(MDK_ICONS).forEach(([k, v]) => { window.ICONS[k] ||= v; });
  let mdTa = null;
  function mdKeys(ta) {
    mdTa = ta;
    let bar = $('#mdBar');
    if (!bar) {
      bar = el('div', 'mdBar'); bar.id = 'mdBar'; bar.hidden = true;
      const row = el('div', 'mdRow');
      const B = (ic, label, fn, txt) => {
        const b = el('button', 'mdK' + (txt ? ' txt' : '')); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
        if (txt) b.textContent = txt; else b.innerHTML = icon(ic);
        let p0 = null;
        // 押した瞬間に入力欄から外れないように。横にスクロールしたときは押したことにしない
        b.addEventListener('pointerdown', e => { e.preventDefault(); p0 = [e.clientX, e.clientY]; });
        b.addEventListener('pointerup', e => { if (p0 && Math.hypot(e.clientX - p0[0], e.clientY - p0[1]) < 10 && mdTa) { fn(mdTa); navigator.vibrate?.(5); } p0 = null; });
        b.addEventListener('pointercancel', () => { p0 = null; });
        b.addEventListener('click', e => e.preventDefault());
        return b;
      };
      const today = () => todayKey();
      const nextHour = () => { const h = Math.min(new Date().getHours() + 1, 23); return `${String(h).padStart(2, '0')}:00`; };
      row.append(
        B('square-check', 'チェック（やること）', t => mdLine(t, 'check')),
        B('list', '箇条書き', t => mdLine(t, 'bullet')),
        B('heading-1', '見出し（押すたびに # → ## → ### → なし）', t => mdLine(t, 'heading')),
        B('bold', '太字', t => mdWrap(t, '**', '**')),
        B('highlighter', 'マーカー（==  ==）', t => mdWrap(t, '==', '==')),
        B('link', 'ノートへのリンク [[ ]]', t => mdWrap(t, '[[', ']]')),
        B('hash', 'タグ', t => mdInsert(t, '#', true)),
        B('clock', '予定の時刻（- 10:00 ）', t => mdLine(t, 'time', nextHour())),
        B('calendar', '期限 📅 今日', t => mdInsert(t, ` 📅 ${today()}`, false, true)),
        B('quote', '引用', t => mdLine(t, 'quote')),
        B('code', 'コード', t => mdWrap(t, '`', '`')),
        B('outdent', '字下げを戻す', t => mdIndent(t, -1)),
        B('indent', '字下げ', t => mdIndent(t, 1)),
        B('undo-2', '元に戻す', t => document.execCommand('undo')),
        B('redo-2', 'やり直す', t => document.execCommand('redo')),
      );
      const close = B('keyboard-off', 'キーボードを閉じる', t => t.blur());
      close.classList.add('close');
      bar.append(row, close);
      document.body.append(bar);
      // キーボードの上に付いてくる
      const vv = window.visualViewport;
      // 見えている画面のいちばん上に付ける（キーボードが出て画面がずれても）
      const place = () => {
        if (bar.hidden) return;
        bar.style.transform = `translateY(${Math.round(vv ? vv.offsetTop : 0)}px)`;
      };
      if (vv) { vv.addEventListener('resize', place); vv.addEventListener('scroll', place); }
      window.addEventListener('resize', place);
      bar._place = place;
    }
    const show = () => { if (isWide()) return; bar.hidden = false; document.body.classList.add('typing'); bar._place(); setTimeout(bar._place, 300); };
    const hide = () => { setTimeout(() => { if (document.activeElement === mdTa && mdTa?.isConnected) return; bar.hidden = true; document.body.classList.remove('typing'); }, 80); };
    ta.addEventListener('focus', show);
    ta.addEventListener('blur', hide);
    // 入力欄が画面から消えたら（保存・やめる）帯も消す
    requestAnimationFrame(() => { if (document.activeElement === ta) show(); });
    new MutationObserver((_, ob) => { if (!ta.isConnected) { ob.disconnect(); if (mdTa === ta) { bar.hidden = true; document.body.classList.remove('typing'); } } }).observe(document.body, { childList: true, subtree: true });
  }
  // 範囲を置きかえる（「元に戻す」が効くように）
  function mdReplace(ta, a, b, text, selA, selB) {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(a, b);
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) { ta.setRangeText(text, a, b, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (selA != null) ta.setSelectionRange(selA, selB ?? selA);
  }
  function mdLineRange(ta) {
    const v = ta.value, s1 = ta.selectionStart, s2 = ta.selectionEnd;
    const a = v.lastIndexOf('\n', s1 - 1) + 1;
    let b = v.indexOf('\n', s2 > s1 && v[s2 - 1] === '\n' ? s2 - 1 : s2); if (b < 0) b = v.length;
    return [a, b];
  }
  // 行の頭につけるもの（つけ外し）
  function mdLine(ta, kind, arg) {
    const [a, b] = mdLineRange(ta);
    const s1 = ta.selectionStart, s2 = ta.selectionEnd;
    const lines = ta.value.slice(a, b).split('\n');
    const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
    let delta0 = 0;
    const out = lines.map((l, i) => {
      const ind = l.match(/^\s*/)[0];
      let body = l.slice(ind.length), nx;
      if (kind === 'check') nx = /^[-*+]\s+\[[ xX]\]\s?/.test(body) ? body.replace(/^[-*+]\s+\[[ xX]\]\s?/, '') : '- [ ] ' + body.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
      else if (kind === 'bullet') nx = /^[-*+]\s+(?!\[)/.test(body) ? body.replace(/^[-*+]\s+/, '') : '- ' + body.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
      else if (kind === 'quote') nx = /^>\s?/.test(body) ? body.replace(/^>\s?/, '') : '> ' + body;
      else if (kind === 'heading') { const m = body.match(/^(#{1,6})\s+/); const lv = m ? m[1].length : 0; body = body.replace(/^#{1,6}\s+/, ''); nx = lv >= 3 ? body : '#'.repeat(lv + 1) + ' ' + body; }
      else if (kind === 'time') {
        const rest = body.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
        nx = /^\d{1,2}:\d{2}(?:\s*[-~〜–]\s*\d{1,2}:\d{2})?\s/.test(rest) ? '- ' + rest.replace(/^\d{1,2}:\d{2}(?:\s*[-~〜–]\s*\d{1,2}:\d{2})?\s+/, '') : `- ${arg} ` + rest;
      }
      const r = ind + nx;
      if (i === 0) delta0 = r.length - l.length;
      return r;
    });
    const text = out.join('\n');
    const one = lines.length === 1;
    // 1行のときは、カーソルを行の中の同じ文字の位置に（行の頭より前には戻さない）
    const ns1 = a + Math.max(0, s1 - a + delta0);
    mdReplace(ta, a, b, text, one ? Math.min(ns1, a + text.length) : a, one ? Math.min(Math.max(s2 - a + delta0, 0) + a, a + text.length) : a + text.length);
  }
  // 選んだ文字を囲む（選んでいなければ、間にカーソル）
  function mdWrap(ta, l, r) {
    const a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
    if (sel && sel.startsWith(l) && sel.endsWith(r) && sel.length >= l.length + r.length) return mdReplace(ta, a, b, sel.slice(l.length, sel.length - r.length), a, b - l.length - r.length);
    mdReplace(ta, a, b, l + sel + r, a + l.length, a + l.length + sel.length);
  }
  // 文字を入れる。space：前が空白でなければ空白を足す。atEnd：行の終わりに入れる
  function mdInsert(ta, text, space, atEnd) {
    let a = ta.selectionStart, b = ta.selectionEnd;
    if (atEnd) { const [, e] = mdLineRange(ta); a = b = e; }
    const prev = ta.value[a - 1];
    const t = space && prev && !/\s/.test(prev) ? ' ' + text : text;
    mdReplace(ta, a, b, t, a + t.length);
  }
  function mdIndent(ta, dir) {
    const [a, b] = mdLineRange(ta);
    const s1 = ta.selectionStart;
    const lines = ta.value.slice(a, b).split('\n');
    let d0 = 0;
    const out = lines.map((l, i) => { const r = dir > 0 ? '  ' + l : l.replace(/^( {1,2}|\t)/, ''); if (i === 0) d0 = r.length - l.length; return r; });
    const text = out.join('\n');
    if (text === lines.join('\n')) return;
    mdReplace(ta, a, b, text, lines.length === 1 ? Math.max(a, s1 + d0) : a, lines.length === 1 ? Math.max(a, s1 + d0) : a + text.length);
  }

  function renderNote(main) {
    const f = S.files[note];
    if (!f) { note = null; return renderNotes(main); }
    const bar = el('div', 'noteBar');
    bar.append(btn('btn white small', ['chevron-left', 'ノート'], () => { if (editing && draft !== f.text && !confirm('保存していない変更があります。破棄しますか？')) return; note = null; editing = false; render(); }));
    bar.append(el('span', 'notePath', folderOf(note)));
    if (editing) {
      bar.append(btn('btn small', 'やめる', () => { if (draft !== f.text && !confirm('変更を破棄しますか？')) return; editing = false; render(); }),
        btn('btn primary small', ['check', '保存'], async e => {
          e.currentTarget.disabled = true;
          const v = draft;
          const ok = v === f.text ? true : await edit(note, () => v, `更新: ${note}`);
          if (ok) { editing = false; render(); if (v !== f.text) toast('保存しました'); if (pendingReload) { pendingReload = false; sync(true); } }
          else e.currentTarget.disabled = false;
        }));
      main.append(bar);
      const ta = el('textarea', 'nt-editor');
      ta.value = draft;
      ta.spellcheck = false;
      ta.addEventListener('input', () => { draft = ta.value; });
      if (isWide()) {
        // Mac の「ノートを並べて書く」と同じ：左に書く画面、右に見た目（書くたびに更新）
        const sp = el('div', 'ntSplit');
        const pv = panel('notePanel');
        const draw = () => { pv.innerHTML = ''; pv.append(noteDoc(note, draft)); pv.querySelectorAll('input[type="checkbox"]').forEach(c => { c.disabled = true; }); };
        let raf = 0;
        ta.addEventListener('input', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); });
        draw();
        sp.append(ta, pv);
        main.append(sp);
        requestAnimationFrame(() => ta.focus());
        return;
      }
      main.append(ta);
      mdKeys(ta);
      main.append(el('div', 'sub edHint', !connected() ? 'デモ表示中：保存はこの画面の中だけです' : desk ? (deskSt?.git?.repo && deskSt.autoGit ? '保存すると、少しあとで自動で commit・push します' : '保存すると、フォルダのファイルに書きます') : '保存すると、このノートを GitHub に commit します'));
      requestAnimationFrame(() => { ta.style.height = Math.max(window.innerHeight * 0.6, ta.scrollHeight) + 'px'; });
      return;
    }
    bar.append(btn('btn white small', ['pencil', '編集'], startEdit));
    main.append(bar);
    const p = panel('notePanel');
    p.append(noteDoc(note, f.text));
    main.append(p);
    // バックリンク（このノートへの [[リンク]]）
    const me = nameOf(note).toLowerCase();
    const back = allPaths().filter(x => x !== note && new RegExp(`\\[\\[(${me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, 'i').test(S.files[x].text));
    if (back.length) {
      const pb = panel();
      pb.append(panelHead('link', 'このノートへのリンク', el('span', '', `${back.length}件`)));
      back.forEach(x => { const r = btn('prow', [], () => openNote(x)); r.insertAdjacentHTML('beforeend', icon('file-text')); r.append(el('b', '', nameOf(x))); r.insertAdjacentHTML('beforeend', icon('chevron-right')); pb.append(r); });
      main.append(pb);
    }
  }
  function newNote(opt = {}) {
    if (isWide() && window.NotesApp) { if (tab !== 'notes') { tab = 'notes'; render(); } return NotesApp.newNote(opt.day ? dayFolder(opt.day) : undefined); }
    const inn = $('#sheetIn');
    const day = opt.day || null;
    sheetHead(inn, day ? `${relDay(day)}のノート` : '新しいノート');
    const inp = el('input', 'inp');
    inp.placeholder = '例：MTG メモ、Spring Boot の調べもの';
    // 場所：その日のフォルダ（2026/11/10）を先に。日付フォルダはその日の分だけ出す
    const t = todayKey();
    const dayOpts = [...new Set([day, t].filter(Boolean))].map(k => [dayFolder(k), `${relDay(k)}（${dayFolder(k) || 'いちばん上'}）`]);
    const folders = [...new Set(allPaths().filter(p => !dayOf.has(p)).map(folderOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    const sel = el('select', 'inp');
    dayOpts.forEach(([v, l]) => sel.append(new Option(l, v)));
    sel.append(new Option('いちばん上', ''));
    folders.filter(f => !dayOpts.some(([v]) => v === f)).forEach(f => sel.append(new Option(f, f)));
    if (!day && opt.folder != null) sel.value = opt.folder;
    const tags = el('input', 'inp');
    tags.placeholder = '例：仕事 java（スペースで区切る）';
    const known = [...new Set([...noteTags.values()].flat())].sort((a, b) => a.localeCompare(b, 'ja'));
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    inn.append(fld('名前', inp), fld('場所', sel), fld('タグ（カテゴリ）', tags));
    if (known.length) {
      const kc = el('div', 'tagPick');
      known.slice(0, 20).forEach(k => kc.append(btn('chip', '#' + k, () => { const cur = tags.value.split(/[\s,、]+/).filter(Boolean); if (!cur.includes(k)) tags.value = [...cur, k].join(' '); })));
      inn.append(kc);
    }
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['file-plus', '作る'], async () => {
      const name = inp.value.trim().replace(/\.md$/i, '').replace(/[\\:*?"<>|#^[\]]/g, ' ').trim();
      if (!name) { inp.focus(); return; }
      const rel = (name.includes('/') ? name : (sel.value ? sel.value + '/' : '') + name) + '.md';
      const tg = [...new Set(tags.value.split(/[\s,、]+/).map(x => x.replace(/^#/, '').trim()).filter(Boolean))];
      sheet.close();
      if (S.files[rel]) { openNote(rel); return; }
      const body = tg.length ? `---\ntags: [${tg.join(', ')}]\n---\n\n` : '';
      if (await edit(rel, () => body, `ノートを作成: ${rel}`)) { openNote(rel); startEdit(); }
    }));
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => inp.focus(), 50);
  }

  // ================= 同期・設定 =================
  // Mac 版の「同期」：ノートのフォルダと git
  function renderDeskSync(main) {
    const ago = ms => { if (!ms) return 'まだ'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'さっき' : m < 60 ? `${m}分前` : new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
    const p = panel();
    p.append(panelHead('folder', 'ノートのフォルダ'));
    const st = el('div', 'syncState');
    if (deskSt?.folder) st.append(el('b', '', sourceName()), el('small', 'pathLine', deskSt.folder));
    else st.append(el('b', '', 'まだ選んでいません'), el('small', '', 'いまはお試しのノートを表示しています。ナレッジの Markdown が入ったフォルダを選んでください'));
    p.append(st);
    const fb = el('div', 'shBtns');
    fb.append(btn(deskSt?.folder ? 'btn' : 'btn primary', ['folder', deskSt?.folder ? 'フォルダを変える' : 'フォルダを選ぶ'], async () => {
      deskSt = await desk.chooseFolder(); note = null; editing = false; S = { files: {}, dailyJson: null }; await sync(true);
    }));
    if (deskSt?.folder) fb.append(btn('btn', ['folder', 'Finder で開く'], () => desk.openFolder()));
    p.append(fb);
    p.append(el('div', 'foot', `ノート ${Object.keys(S.files).length} 件 ・ やること ${items.filter(i => i.type === 'todo').length} 件 ・ 予定 ${items.filter(i => i.type === 'event').length} 件`));
    main.append(p);
    if (!deskSt?.folder) return;

    const g = deskSt.git || {};
    const pg = panel();
    pg.append(panelHead('git-branch', 'GitHub との同期（git）'));
    if (!g.repo) {
      pg.append(noData('このフォルダは git のリポジトリではありません。ノートはフォルダに保存されますが、GitHub には送りません。'));
      const ol = el('ol', 'steps');
      ol.innerHTML = '<li>ターミナルでフォルダに移動して <code>git init</code></li><li>GitHub に<b>非公開</b>のリポジトリを作り <code>git remote add origin …</code></li><li><code>git add -A && git commit -m first && git push -u origin main</code></li><li>このアプリで「今すぐ同期」</li>';
      pg.append(ol);
    } else {
      const rows = [
        ['ブランチ', g.branch || '—'],
        ['送り先', g.remote || 'なし（commit だけします）'],
        ['まだ送っていない', `${(deskSt.pending || 0) + (g.changed || 0)} 件の変更${g.ahead ? ` ・ ${g.ahead} 件の commit` : ''}`],
        ['最後に取り込んだ', ago(g.lastPull)],
        ['最後に送った', ago(g.lastPush)],
      ];
      rows.forEach(([k, v]) => { const r = el('div', 'setRow'); r.append(el('span', '', k), el('small', 'sub', v)); pg.append(r); });
      if (g.error) pg.append(el('div', 'syncErr', g.error));
      const tg = el('label', 'setRow');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!deskSt.autoGit; cb.className = 'swt';
      cb.addEventListener('change', async () => { deskSt = await desk.setAuto(cb.checked); render(); });
      tg.append(el('span', '', '自動で同期する'), cb);
      pg.append(tg);
      pg.append(el('p', 'hint sub', '保存すると少しあとで commit・push し、開いたときと5分ごとに取り込みます。ほかのエディタで書きかえた分もまとめて送ります。'));
      const sb = el('div', 'syncBtns');
      sb.append(btn('btn primary', ['refresh-cw', syncing ? '同期しています…' : '今すぐ同期'], () => sync()));
      pg.append(sb);
    }
    main.append(pg);

    const t = panel();
    t.append(panelHead('sun', '表示'));
    const seg = el('div', 'seg');
    [['auto', 'Macに合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].forEach(([k, l]) =>
      seg.append(btn((cfg.theme || 'auto') === k ? 'on' : '', l, () => { cfg.theme = k; saveCfg(); applyTheme(); render(); })));
    t.append(seg);
    main.append(t);
  }

  function renderSync(main) {
    if (desk) return renderDeskSync(main);
    const p = panel();
    p.append(panelHead('folder-git-2', 'つないでいるリポジトリ'));
    const st = el('div', 'syncState');
    if (connected()) {
      st.append(el('b', '', `${cfg.owner}/${cfg.repo}`), el('small', '', `ブランチ ${branch()}${cfg.prefix ? ` ・ フォルダ ${cfg.prefix}` : ''}`));
      st.append(el('small', S.error ? 'bad' : '', S.error || (S.syncedAt ? `${new Date(S.syncedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} に同期` : 'まだ同期していません')));
    } else st.append(el('b', '', 'まだつないでいません'), el('small', '', 'いまはお試しのノートを表示しています'));
    p.append(st);
    const sb = el('div', 'syncBtns');
    if (connected()) sb.append(btn('btn primary', ['refresh-cw', syncing ? '同期しています…' : '今すぐ同期'], () => sync()));
    p.append(sb);
    p.append(el('div', 'foot', `ノート ${Object.keys(S.files).length} 件 ・ やること ${items.filter(i => i.type === 'todo').length} 件 ・ 予定 ${items.filter(i => i.type === 'event').length} 件`));
    main.append(p);

    const f = panel();
    f.append(panelHead('key-round', 'GitHub の設定'));
    const fld = (label, name, ph, type = 'text') => {
      const l = el('label', 'fld');
      const i = el('input', 'inp'); i.name = name; i.type = type; i.placeholder = ph; i.value = cfg[name] || ''; i.autocapitalize = 'off'; i.autocomplete = 'off'; i.spellcheck = false;
      l.append(el('span', '', label), i);
      return l;
    };
    const form = el('form');
    form.append(fld('オーナー（ユーザー名）', 'owner', 'keigo29'), fld('リポジトリ', 'repo', 'notes'),
      el('div', 'two'), fld('アクセストークン', 'token', 'github_pat_…', 'password'));
    form.children[2].append(fld('ブランチ', 'branch', 'main'), fld('読むフォルダ（空なら全部）', 'prefix', '例：Notes'));
    form.append(el('p', 'hint sub', 'Fine-grained token で「このリポジトリだけ」「Contents：Read and write」にしてください。トークンはこの端末の中だけに保存し、GitHub 以外には送りません。'));
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['save', '保存してつなぐ'], () => form.requestSubmit()));
    if (connected()) bs.append(btn('btn danger', ['log-out', '外す'], () => { if (!confirm('この端末からつなぐ設定を消しますか？（GitHub のノートは消えません）')) return; cfg = { theme: cfg.theme }; saveCfg(); S = { files: {}, dailyJson: null }; note = null; sync(true); }));
    form.append(bs);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form).entries());
      for (const k of ['owner', 'repo', 'branch', 'prefix', 'token']) cfg[k] = String(v[k] || '').trim();
      saveCfg();
      if (!connected()) { toast('オーナー・リポジトリ・トークンを入れてください', 'warn'); return; }
      S = (await DB.get('snap:' + cfg.owner + '/' + cfg.repo + '@' + branch() + ':' + (cfg.prefix || ''))) || { files: {}, dailyJson: null };
      note = null;
      sync();
    });
    f.append(form);
    main.append(f);

    const t = panel();
    t.append(panelHead('sun', '表示'));
    const seg = el('div', 'seg');
    [['auto', 'Macに合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].forEach(([k, l]) =>
      seg.append(btn((cfg.theme || 'auto') === k ? 'on' : '', l, () => { cfg.theme = k; saveCfg(); applyTheme(); render(); })));
    t.append(seg);
    main.append(t);

    const h = panel();
    h.append(panelHead('info', '書き方'));
    h.innerHTML += `<ul class="steps">
      <li><code>- [ ] やること</code>：やること。デイリーノートに書くとその日の分</li>
      <li><code>@due(2026-11-20)</code> か <code>📅 2026-11-20</code>：期限</li>
      <li><code>- 14:00 MTG</code> / <code>- 10:00-12:00 面談</code>：予定（日付のあるノートや <code>## 2026-11-20</code> の見出しの下）</li>
      <li><code>#タグ</code>：やることの絞り込みに使えます</li></ul>`;
    main.append(h);
  }

  // ================= 画面の切り替え =================
  // ================= PC の幅の画面（旧 Workstation と同じ形・同じ操作） =================
  const whenLabel = k => { const n = diffDays(todayKey(), k); return n < 0 ? `${-n}日すぎ` : n === 0 ? '今日' : n === 1 ? '明日' : `あと${n}日`; };
  const colorOfItem = it => (it.project && projByPath(it.project) ? projByPath(it.project).color : 'var(--g350)');
  const srcName = it => (it.project && projByPath(it.project) ? projByPath(it.project).name : isMainDaily(it.path) ? `${sd(dayOf.get(it.path))}のノート` : nameOf(it.path));
  function chk(it) {
    const c = btn('chk' + (it.done ? ' done' : ''), it.done ? 'check' : [], () => setDone(it, !it.done), it.done ? 'まだにする' : '完了にする');
    c.style.setProperty('--c', colorOfItem(it));
    return c;
  }
  // ダッシュボードのタスク1行（旧 Workstation の db-task）
  function dbTask(it) {
    const r = el('div', 'db-task');
    const nmb = btn('db-tname', [], () => openItem(it), it.title);
    nmb.append(el('span', 'nm', (it.time ? it.time + ' ' : '') + it.title));
    const meta = el('span', 'meta'); const d = el('span', 'dot'); d.style.setProperty('--c', colorOfItem(it));
    meta.append(d, srcName(it));
    if (!it.done && it.date && it.date < todayKey()) meta.append(el('span', 'late', ` ・ ${whenLabel(it.date)}`));
    nmb.append(meta);
    r.append(chk(it), nmb);
    return r;
  }
  function dbCard(cls, ic, title, more, go) {
    const c = el('section', 'db-card ' + cls);
    const h = el('div', 'db-head'); const h3 = el('h3'); h3.innerHTML = icon(ic); h3.append(title); h.append(h3);
    if (more) h.append(btn('db-more', [more, 'chevron-right'], go));
    c.append(h);
    return c;
  }
  function renderHomeWide(main, d) {
    const { t, dRel, dPaths, dTodos, sched, over, open, todayTodos } = d;
    const grid = el('div', 'db-grid');
    // 次にやること（期限切れ → 今日の時刻順 → 今日 → いちばん近い期限）
    const cand = [...over, ...todayTodos.filter(i => !i.done).sort(byTime), ...open.filter(i => i.date && i.date > t).sort(byDate), ...open.filter(i => !i.date)];
    const nx = cand[0];
    const next = el('div', 'db-next');
    const nic = el('span', 'nic'); nic.innerHTML = icon('target'); next.append(nic);
    const nt = el('div', 'ntxt'); nt.append(el('span', 'lbl', '次にやること'));
    if (nx) {
      nt.append(el('b', '', nx.title));
      const m = el('span', 'meta'); const dt = el('span', 'dot'); dt.style.setProperty('--c', colorOfItem(nx));
      m.append(dt, `${srcName(nx)}${nx.date ? ` ・ 期限 ${sd(nx.date)}(${WD[parseKey(nx.date).getDay()]})` : ''}${nx.date && nx.date < t ? `（${whenLabel(nx.date)}）` : ''}`);
      nt.append(m);
      next.append(nt, btn('btn white db-nOpen', 'file-text', () => openNote(nx.path), 'ノートを開く'), btn('btn primary db-play', ['check', '完了にする'], () => setDone(nx, true)));
    } else { nt.append(el('b', 'none', 'まだのやることはありません')); next.append(nt); }
    grid.append(next);
    // あいさつ＋数字（旧 Workstation と同じタイル）
    const hero = el('section', 'db-card db-hero');
    const ht = el('div', 'db-heroText'); const h = new Date().getHours();
    ht.append(el('div', 'db-date', md(t)), el('div', 'db-greet', h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'));
    const ks = el('div', 'db-kpis');
    const dn = todayTodos.filter(i => i.done).length, tot = todayTodos.length, C = 2 * Math.PI * 22, pct = tot ? dn / tot : 0;
    const ring = el('div', 'db-kpi ring'); const rg = el('div', 'db-ring');
    rg.innerHTML = `<svg viewBox="0 0 52 52"><circle class="bgc" cx="26" cy="26" r="22"/><circle class="fgc" cx="26" cy="26" r="22" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>`;
    rg.append(el('b', '', String(tot - dn)));
    const rl = el('div', 'kl'); rl.append(el('b', '', '今日のやること'), el('span', '', `${dn} / ${tot} 完了`)); ring.append(rg, rl);
    const tile = (ic, v, label, sub, cls) => { const k = el('div', 'db-kpi ' + (cls || '')); const kv = el('div', 'kv'); kv.innerHTML = icon(ic); kv.append(v); k.append(kv, el('div', 'kl', label)); if (sub) k.append(el('div', 'kn', sub)); return k; };
    const nxe = sched.find(i => (i.time || '') >= hhmm());
    ks.append(ring, tile('calendar-clock', `${sched.filter(i => i.type === 'event').length}件`, '今日の予定', nxe ? `次 ${nxe.time}` : ''), tile('circle-check', `${dn}件`, '今日完了したこと'),
      tile('triangle-alert', `${over.length}件`, '期限切れ', '', over.length ? 'bad' : ''), tile('list-todo', `${open.length}件`, 'まだのやること', `ノート ${Object.keys(S.files).length}件から`));
    hero.append(ht, ks);
    grid.append(hero);
    // 今日のノート
    const cd = dbCard('db-daily c3', 'notebook-text', '今日のノート', S.files[dRel] ? '開く' : null, () => openNote(dRel));
    if (!dPaths.length) {
      cd.append(el('p', 'db-empty', '今日のノートはまだありません。やることやメモを書いておく場所です。'), btn('btn primary db-dailyBtn', ['file-plus', '今日のノートを作る'], () => createDaily(t)));
    } else {
      const fc = el('div', 'fchips'); dPaths.forEach(x => fc.append(fileChip(x))); cd.append(fc);
      const ds = [...dTodos.filter(i => !i.done), ...dTodos.filter(i => i.done)];
      if (!ds.length) cd.append(el('p', 'db-empty', 'やること（- [ ] …）はまだありません'));
      ds.slice(0, 8).forEach(i => cd.append(dbTask(i)));
      if (ds.length > 8) cd.append(el('div', 'db-moreLine', `ほか ${ds.length - 8} 件`));
    }
    cd.append(addForm(t, 'やることを足して Enter'));
    // 今日のタスク（今日のノート以外も含めて、今日の分）
    const ct = dbCard('db-tasks c3', 'sun', '今日のタスク', 'すべて見る', () => { wideFilter = 'today'; switchTab('todo'); });
    const tt = [...over, ...todayTodos.filter(i => !i.done && !dPaths.includes(i.path))];
    if (!tt.length) ct.append(el('p', 'db-empty', '今日の分はほかにありません'));
    tt.slice(0, 8).forEach(i => ct.append(dbTask(i)));
    if (tt.length > 8) ct.append(el('div', 'db-moreLine', `ほか ${tt.length - 8} 件`));
    // 近い締切・節目
    const cu = dbCard('db-due c3', 'flag', '近い締切・節目', 'ガントチャート', () => { proj = null; projView = 'gantt'; switchTab('proj'); });
    const due = items.filter(i => i.type === 'todo' && !i.done && i.date && i.date >= t && (i.due || i.milestone)).sort(byDate).slice(0, 8);
    if (!due.length) cu.append(el('p', 'db-empty', '期限（📅）や節目（#節目）のあるやることはありません'));
    due.forEach(i => {
      const r = btn('db-dueRow', [], () => openItem(i), i.title);
      const n = diffDays(t, i.date);
      const nm = el('span', 'nm'); if (i.milestone) nm.insertAdjacentHTML('beforeend', icon('flag')); nm.append(i.title);
      const meta = el('span', 'meta'); const dt = el('span', 'dot'); dt.style.setProperty('--c', colorOfItem(i)); meta.append(dt, `${sd(i.date)}(${WD[parseKey(i.date).getDay()]})`);
      r.append(el('span', 'when' + (n <= 1 ? ' soon' : ''), whenLabel(i.date)), nm, meta);
      cu.append(r);
    });
    grid.append(cd, ct, cu);
    // 今日の予定・これから7日
    const cs = dbCard('c3h', 'calendar-clock', '今日の予定', '予定を追加', () => newEvent(t));
    if (!sched.length) cs.append(el('p', 'db-empty', '時刻つきの予定（- 14:00 MTG など）はありません'));
    sched.forEach(i => cs.append(planRow(i)));
    const end = addDays(t, 7);
    const soon = items.filter(i => i.date && i.date > t && i.date <= end && !i.done).sort(byDate);
    const cn = dbCard('c3h', 'calendar-days', 'これから7日', null);
    if (!soon.length) cn.append(el('p', 'db-empty', '予定もやることもありません'));
    let last = null;
    for (const i of soon.slice(0, 12)) {
      if (i.date !== last) { cn.append(el('div', 'hb-sep', relDay(i.date))); last = i.date; }
      cn.append(i.type === 'event' ? planRow(i) : dbTask(i));
    }
    grid.append(cs, cn);
    main.append(grid);
  }

  // ---------- やること（旧 Workstation の「作業計測」のタスク一覧と同じ） ----------
  let wideFilter = 'today';
  const WF = { today: '今日', tomorrow: '明日', planned: '予定', nodate: '日付なし', all: 'すべて', done: '完了' };
  function wideList(f) {
    const t = todayKey(), tm = addDays(t, 1);
    let l = items.filter(i => i.type === 'todo');
    if (todoTag) l = l.filter(i => i.tags.includes(todoTag));
    const inDay = (i, k) => i.date === k || (!i.date && dayOf.get(i.path) === k);
    if (f === 'today') return l.filter(i => (!i.done && i.date && i.date < t) || inDay(i, t));
    if (f === 'tomorrow') return l.filter(i => inDay(i, tm));
    if (f === 'planned') return l.filter(i => !i.done && i.date && i.date > t);
    if (f === 'nodate') return l.filter(i => !i.done && !i.date);
    if (f === 'done') return l.filter(i => i.done);
    return l.filter(i => !i.done);
  }
  function taskLi(it) {
    const t = todayKey();
    const li = el('li', 'task' + (it.done ? ' done' : ''));
    li.style.setProperty('--c', colorOfItem(it));
    const tm = el('div', 'tmain');
    const tt = el('div', 'ttitle'); tt.append(el('span', 'tx', (it.time ? it.time + ' ' : '') + it.title));
    if (it.milestone) tt.insertAdjacentHTML('afterbegin', icon('flag'));
    const meta = el('div', 'tmeta');
    const sp = (ic, txt, cls) => { const s = el('span', cls || ''); if (ic) s.insertAdjacentHTML('beforeend', icon(ic)); s.append(txt); return s; };
    const pj = it.project && projByPath(it.project);
    if (pj) { const s = el('span'); const d = el('i', 'dot'); d.style.setProperty('--c', pj.color); s.append(d, el('span', 'tx', pj.name)); meta.append(s); }
    if (it.date) meta.append(sp('calendar', it.start && !it.done ? `${sd(it.start)}〜${sd(it.date)}` : relDay(it.date), !it.done && it.date < t ? 'late' : ''));
    it.tags.filter(g => g !== '節目' && g !== '予定').slice(0, 3).forEach(g => meta.append(sp('tag', g)));
    const nc = btn('noteChip', 'file-text', () => openNote(it.path), `ノート「${nameOf(it.path)}」を開く`);
    nc.append(el('span', '', isMainDaily(it.path) ? `${sd(dayOf.get(it.path))}のノート` : nameOf(it.path)));
    meta.append(nc);
    tm.append(tt, meta);
    tm.addEventListener('click', e => { if (!e.target.closest('button')) openItem(it); });
    tm.style.cursor = 'pointer';
    const acts = el('div', 'acts'); acts.append(btn('iconBtn', 'pencil', () => openNote(it.path), 'ノートで直す'));
    li.append(chk(it), tm, acts, el('span'));
    return li;
  }
  function renderTodoWide(main) {
    const t = todayKey();
    // 追加欄（旧 Workstation と同じ：名前・プロジェクト・日）
    const f = el('form', 'addBar'); f.autocomplete = 'off';
    f.insertAdjacentHTML('beforeend', icon('plus'));
    const inp = el('input'); inp.placeholder = 'やることを追加…'; inp.maxLength = 200;
    const sp = el('select'); sp.title = 'プロジェクト'; sp.append(new Option('プロジェクトなし', ''));
    projects.forEach(p => sp.append(new Option(p.name, p.path)));
    const sd2 = el('select'); sd2.title = '日';
    [['today', '今日'], ['tomorrow', '明日'], ['', '日付なし']].forEach(([v, l]) => sd2.append(new Option(l, v)));
    if (wideFilter === 'tomorrow') sd2.value = 'tomorrow'; else if (wideFilter === 'nodate') sd2.value = '';
    f.append(inp, sp, sd2);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const v = inp.value.trim(); if (!v) return;
      const k = sd2.value === 'today' ? t : sd2.value === 'tomorrow' ? addDays(t, 1) : null;
      inp.value = '';
      if (sp.value) { const ok = await edit(sp.value, x => MDParser.addTodo(x ?? '', k ? `${v} 📅 ${k}` : v), `タスク: ${v}`); if (ok) toast(`${nameOf(sp.value)}に足しました`); }
      else if (k) addTodoTo(k, v);
      else { const ok = await edit('Inbox.md', x => MDParser.addTodo(x ?? '# Inbox\n', v), `やること: ${v}`); if (ok) toast('Inbox に足しました'); }
    });
    main.append(f);
    const list = wideList(wideFilter);
    const open = wideFilter === 'done' ? list : list.filter(i => !i.done);
    const done = wideFilter === 'done' ? [] : list.filter(i => i.done);
    const ul = el('ul', 'list');
    open.sort((a, b) => ((a.date && a.date < t) === (b.date && b.date < t) ? byDate(a, b) : a.date && a.date < t ? -1 : 1)).forEach(i => ul.append(taskLi(i)));
    if (open.length) main.append(ul);
    else { const e = el('div', 'empty'); e.innerHTML = icon('circle-check'); e.append(el('p', '', wideFilter === 'today' ? '今日のやることはありません' : '該当するやることはありません')); main.append(e); }
    if (done.length) {
      const db = el('details', 'doneBox');
      const sm = el('summary'); sm.innerHTML = icon('chevron-down'); sm.append(`完了 ${done.length}件`);
      const ul2 = el('ul', 'list'); done.forEach(i => ul2.append(taskLi(i)));
      db.append(sm, ul2);
      main.append(db);
    }
  }

  // ---------- ガントチャート（旧 Workstation と同じ：左に表、右にバー） ----------
  function renderGanttWide(main) {
    const today = todayKey(), DWW = 34;
    if (prefs.cards !== false && projects.length) {
      main.append(projCards(true));
    }
    const tasks = items.filter(i => i.type === 'todo' && i.project && i.date && (prefs.showDone || !i.done));
    const lastDue = tasks.reduce((m, x) => (x.date > m ? x.date : m), today);
    const firstS = tasks.reduce((m, x) => (spanOf(x).s < m ? spanOf(x).s : m), addDays(today, -14));
    const from = firstS < addDays(today, -60) ? addDays(today, -60) : firstS;
    const days = Math.min(550, Math.max(diffDays(from, today) + 75, diffDays(from, lastDue) + 14));
    const xOf = k => diffDays(from, k) * DWW;
    const g = el('div', 'gantt');
    const inner = el('div', 'g-inner');
    inner.style.setProperty('--tw', days * DWW + 'px');
    inner.style.setProperty('--gridbg', `linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to right, transparent ${5 * DWW}px, var(--weekend) ${5 * DWW}px)`);
    inner.style.setProperty('--gridsize', `${DWW}px 100%, ${7 * DWW}px 100%`);
    // 週末の帯が月曜始まりで合うように、背景の位置をずらす
    inner.style.setProperty('--gridpos', `0 0, ${-(((parseKey(from).getDay() + 6) % 7) * DWW)}px 0`);
    const head = el('div', 'g-row g-head');
    const hl = el('div', 'g-left'); hl.append(el('span'), el('span', '', 'タスク'), el('span', '', '期間'));
    const hr = el('div', 'g-right');
    for (let i = 0; i < days; i++) {
      const k = addDays(from, i), d = parseKey(k);
      if (d.getDate() === 1 || i === 0) {
        const nxt = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const m = el('div', 'mcell'); m.append(el('span', '', `${d.getFullYear() !== new Date().getFullYear() || i === 0 ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月`));
        m.style.left = i * DWW + 'px'; m.style.width = Math.min(diffDays(k, keyOf(nxt)), days - i) * DWW + 'px';
        hr.append(m);
      }
      const c = el('div', 'dcell' + ([0, 6].includes(d.getDay()) ? ' we' : '') + (k === today ? ' today' : ''));
      c.append(el('span', '', String(d.getDate()))); c.style.left = i * DWW + 'px'; c.style.width = DWW + 'px';
      hr.append(c);
    }
    head.append(hl, hr);
    inner.append(head);
    const groups = projects.map(p => ({ p, all: items.filter(i => i.type === 'todo' && i.project === p.path), list: tasks.filter(x => x.project === p.path) })).filter(x => x.list.length || x.all.length);
    let first = true, unplanned = 0;
    for (const { p, all, list } of groups) {
      unplanned += all.filter(x => !x.date && !x.done).length;
      const closed = prefs.closed.includes(p.path);
      const row = el('div', 'g-row grp' + (first ? ' first' : '')); first = false;
      row.style.setProperty('--c', p.color);
      const gl = el('div', 'g-left');
      gl.append(btn('fold' + (closed ? ' closed' : ''), 'chevron-down', () => { prefs.closed = closed ? prefs.closed.filter(x => x !== p.path) : [...prefs.closed, p.path]; savePrefs(); render(); }, closed ? '開く' : '閉じる'));
      const gn = btn('grpName', [], () => { proj = p.path; render(); }, p.name);
      const dt = el('span', 'dot'); gn.append(dt, el('span', 'nm', p.name), el('small', '', `${all.filter(x => x.done).length}/${all.length}`));
      gl.append(gn, btn('iconBtn', 'plus', () => { proj = p.path; render(); requestAnimationFrame(() => document.querySelector('.ptAdd .inp')?.focus()); }, 'このプロジェクトにタスクを追加'));
      const gr = el('div', 'g-right');
      if (list.length) {
        const s = list.map(x => spanOf(x).s).sort()[0], e = list.map(x => x.date).sort().slice(-1)[0];
        const sb = el('div', 'sumbar'); sb.style.left = xOf(s) + 'px'; sb.style.width = (diffDays(s, e) + 1) * DWW + 'px';
        const sf = el('span'); sf.style.width = (all.length ? Math.round(all.filter(x => x.done).length / all.length * 100) : 0) + '%'; sb.append(sf); gr.append(sb);
      }
      row.append(gl, gr);
      inner.append(row);
      if (closed) continue;
      list.sort((a, b) => (spanOf(a).s < spanOf(b).s ? -1 : spanOf(a).s > spanOf(b).s ? 1 : byDate(a, b)));
      for (const x of list) {
        const r = el('div', 'g-row gtask' + (x.done ? ' done' : ''));
        r.style.setProperty('--c', p.color);
        const l = el('div', 'g-left');
        const tn = btn('tname', [], () => openItem(x), x.title); if (x.milestone) tn.insertAdjacentHTML('beforeend', icon('flag')); tn.append(el('span', '', x.title));
        const { s, e } = spanOf(x);
        l.append(chk(x), tn, el('span', 'tdate' + (!x.done && e < today ? ' bad' : ''), s === e ? `${sd(e)}` : `${sd(s)}〜${sd(e)}`));
        const rr = el('div', 'g-right');
        if (x.milestone) {
          const m = btn('ms' + (x.done ? ' isdone' : '') + (!x.done && e < today ? ' late' : ''), [], () => openItem(x), x.title);
          m.style.left = (xOf(e) + DWW / 2 - 10) + 'px'; rr.append(m);
          const lb = el('div', 'blabel' + (x.done ? ' done' : '')); lb.append(x.title); lb.style.left = (xOf(e) + DWW / 2 + 16) + 'px'; rr.append(lb);
        } else {
          const w = (diffDays(s, e) + 1) * DWW;
          const b = btn('bar' + (x.done ? ' isdone' : '') + (!x.done && e < today ? ' late' : ''), [], () => openItem(x), x.title);
          b.style.left = xOf(s) + 'px'; b.style.width = w + 'px';
          const pr = el('div', 'prog'); pr.style.width = (x.done ? 100 : 0) + '%'; b.append(pr);
          if (w >= 50) { const pc = el('div', 'pct' + (x.done ? '' : ' lo'), x.done ? '完了' : ''); b.append(pc); }
          rr.append(b);
          const lb = el('div', 'blabel' + (x.done ? ' done' : '')); if (x.done) lb.insertAdjacentHTML('beforeend', icon('check')); lb.append(x.title); lb.style.left = (xOf(s) + w + 8) + 'px'; rr.append(lb);
        }
        r.append(l, rr);
        inner.append(r);
      }
      const ar = el('div', 'g-row addRow'); const al = el('div', 'g-left');
      al.append(btn('addTask', ['plus', 'タスクを追加'], () => { proj = p.path; render(); requestAnimationFrame(() => document.querySelector('.ptAdd .inp')?.focus()); }));
      ar.append(al, el('div', 'g-right')); inner.append(ar);
    }
    if (!groups.length) { const e = el('div', 'ganttNote'); e.innerHTML = icon('info'); e.append('Projects/ にノートを作り、タスクに 📅 期限を付けるとここに出ます'); inner.append(e); }
    if (unplanned) { const e = el('div', 'ganttNote'); e.innerHTML = icon('info'); e.append(`期限のないタスクが ${unplanned} 件あります（📅 を付けると表示されます）`); inner.append(e); }
    const tl = el('div', 'todayLine'); tl.style.left = `calc(var(--lw) + ${xOf(today) + DWW / 2}px)`; inner.append(tl);
    g.append(inner);
    main.append(g);
    const toToday = smooth => g.scrollTo({ left: Math.max(0, xOf(today) - 3 * DWW), behavior: smooth ? 'smooth' : 'auto' });
    ganttToToday = () => toToday(true);
    requestAnimationFrame(() => { if (ganttScroll != null) g.scrollLeft = ganttScroll; else toToday(false); });
    let raf = 0;
    g.addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; ganttScroll = g.scrollLeft; }); }, { passive: true });
  }
  let ganttToToday = () => {};

  // ---------- ノート：最近のノート（旧 Workstation と同じカード） ----------
  function snippet(text) {
    const { body } = splitFrontmatter(text);
    return body.replace(/```[\s\S]*?```/g, ' ').replace(/^#+\s*/gm, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[.\]\s*)?/gm, '').replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`=~>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
  }
  function noteCards(paths) {
    const box = el('div', 'nt-cards');
    paths.forEach(p => {
      const c = btn('nt-card', [], () => openNote(p), nameOf(p));
      c.append(el('b', '', isMainDaily(p) ? `${md(dayOf.get(p))}` : nameOf(p)), el('p', '', snippet(S.files[p].text) || '（まだ何も書いていません）'));
      const tg = (noteTags.get(p) || []).slice(0, 3).map(x => '#' + x).join(' ');
      c.append(el('small', '', `${folderOf(p) || 'いちばん上'}${dayOf.has(p) ? '・' + dayOf.get(p).replace(/-/g, '/') : ''}${tg ? '・' + tg : ''}`));
      box.append(c);
    });
    return box;
  }
  function renderNotesWide(main) {
    const paths = Object.keys(S.files);
    const byRecent = (a, b) => ((dayOf.get(b) || '') > (dayOf.get(a) || '') ? 1 : (dayOf.get(b) || '') < (dayOf.get(a) || '') ? -1 : a.localeCompare(b, 'ja'));
    const home = el('div', 'nt-home');
    let title = '最近のノート', list;
    if (noteDay) { title = md(noteDay); list = dayFiles(noteDay); }
    else if (noteTag) { title = '#' + noteTag; list = paths.filter(p => (noteTags.get(p) || []).includes(noteTag)).sort(byRecent); }
    else if (noteFolder) { const f = noteFolder === '（いちばん上）' ? '' : noteFolder; title = noteFolder; list = paths.filter(p => folderOf(p) === f || folderOf(p).startsWith(f + '/')).sort(byRecent); }
    else list = paths.sort(byRecent).slice(0, 40);
    home.append(el('p', 'nt-homeHead', `${title}（${list.length}件）`));
    if (!list.length) home.append(el('p', 'db-empty', 'ノートはありません'));
    home.append(noteCards(list));
    main.append(home);
  }
  // ノートのサイドバー：フォルダの木（旧 Workstation と同じ）
  let ntSideTab = 'files';
  const openFolders = new Set();
  function noteTree() {
    const tree = el('nav', 'navCard nt-tree');
    const sc = el('div', 'nt-treeScroll');
    const root = { dirs: new Map(), files: [] };
    for (const p of Object.keys(S.files).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))) {
      const parts = p.split('/'); let n = root;
      for (const d of parts.slice(0, -1)) { if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), files: [] }); n = n.dirs.get(d); }
      n.files.push(p);
    }
    const count = n => n.files.length + [...n.dirs.values()].reduce((a, x) => a + count(x), 0);
    // 今日のノートと開いているノートの場所は開いておく
    for (const p of [note, dailyPathOf(todayKey())].filter(Boolean)) { const ps = p.split('/'); for (let i = 1; i < ps.length; i++) openFolders.add(ps.slice(0, i).join('/')); }
    const walk = (n, prefix, depth) => {
      const dirNames = [...n.dirs.keys()].sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? b.localeCompare(a, 'ja', { numeric: true }) : a.localeCompare(b, 'ja')));
      for (const d of dirNames) {
        const key = prefix ? prefix + '/' + d : d, open = openFolders.has(key);
        const r = btn('nav nt-folder' + (open ? ' open' : ''), [], () => { open ? openFolders.delete(key) : openFolders.add(key); renderSide(); }, key);
        r.style.paddingLeft = (10 + depth * 14) + 'px';
        r.insertAdjacentHTML('beforeend', icon('chevron-right')); r.insertAdjacentHTML('beforeend', icon(open ? 'folder-open' : 'folder'));
        r.append(el('span', 'name', d), el('small', '', String(count(n.dirs.get(d)))));
        sc.append(r);
        if (open) walk(n.dirs.get(d), key, depth + 1);
      }
      for (const p of n.files) {
        const r = btn('nav nt-file' + (note === p ? ' on' : ''), [], () => openNote(p), p);
        r.style.paddingLeft = (10 + depth * 14 + 18) + 'px';
        r.insertAdjacentHTML('beforeend', icon(isMainDaily(p) ? 'notebook-text' : 'file-text'));
        r.append(el('span', 'name', nameOf(p)));
        sc.append(r);
      }
    };
    walk(root, '', 0);
    tree.append(sc);
    return tree;
  }

  // ================= PC の幅：レール・サイドバー（Mac の Workstation と同じ並び） =================
  // タブレット（縦でも）から PC と同じ並びにする。スマホを横にしたとき（高さが低い）はスマホのまま
  const WIDE_Q = '(min-width: 700px) and (min-height: 500px)';
  const mq = window.matchMedia(WIDE_Q);
  const isWide = () => mq.matches;
  document.documentElement.classList.toggle('wide', mq.matches);
  mq.addEventListener('change', () => { if (window.NotesApp) NotesApp.flush(); document.documentElement.classList.toggle('wide', mq.matches); render(); });
  const TAB_ICON = { home: 'house', todo: 'list-todo', proj: 'folder-kanban', cal: 'calendar-days', notes: 'notebook-text', graph: 'orbit', sync: 'refresh-cw' };
  let noteDay = null, noteFolder = null;   // ノート一覧の絞り込み（サイドバーから）

  function railBtn(t) {
    const b = btn('railBtn' + (tab === t ? ' on' : ''), [], () => switchTab(t), TITLES[t]);
    const ric = el('span', 'ric'); ric.innerHTML = icon(TAB_ICON[t]);
    if (t === 'sync') { const bd = $('#syncBadge'); if (bd && !bd.hidden) ric.append(el('i', 'badge', bd.textContent)); }
    b.append(ric, el('span', 'rname', TITLES[t]));
    return b;
  }
  function renderRail() {
    const a = $('#railApps'); a.innerHTML = '';
    ['home', 'todo', 'proj', 'cal', 'notes', 'graph'].forEach(t => a.append(railBtn(t)));
    const bt = $('#railBottom'); bt.innerHTML = '';
    bt.append(railBtn('sync'));
  }
  const sideTitle = (t, right) => { const p = el('p', 'sideTitle', t); if (right) p.append(right); return p; };
  function nav(ic, name, small, on, go, cls = '') {
    const b = btn('nav' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), [], go, name);
    if (ic && ic.startsWith('#')) { const d = el('i', 'dot'); d.style.setProperty('--c', ic); b.append(d); }
    else if (ic) b.insertAdjacentHTML('beforeend', icon(ic));
    b.append(el('span', 'name', name));
    if (small != null && small !== '') { const s = el('small', '', String(small)); if (String(small).startsWith('!')) { s.textContent = String(small).slice(1); s.className = 'bad'; } b.append(s); }
    return b;
  }
  function stRow(ic, nm, b, small, go, bad) {
    const r = btn('stRow', [], go, nm);
    const ri = el('span', 'ric'); ri.innerHTML = icon(ic);
    const tx = el('span', 'tx');
    tx.append(el('span', 'nm', nm), el('b', '', b), el('small', bad ? 'bad' : '', small));
    r.append(ri, tx);
    r.insertAdjacentHTML('beforeend', icon('chevron-right'));
    return r;
  }
  function renderSide() {
    $('#sideTitle').innerHTML = icon(TAB_ICON[tab]);
    $('#sideTitle').append(TITLES[tab]);
    const sb = $('#sideBody');
    if (ntOn()) {
      // ノートのサイドバーは旧ノート画面が自分で描きかえる（入力中の検索欄などを消さないため、作るのは最初だけ）
      if (!sb.contains(Nt.side)) { sb.innerHTML = ''; sb.append(Nt.side); NotesApp.renderSide(Nt.side); }
      return;
    }
    sb.innerHTML = '';
    const t = todayKey();
    const todos = items.filter(i => i.type === 'todo');
    const over = todos.filter(i => !i.done && i.date && i.date < t);
    if (tab === 'home') {
      const tt = todos.filter(i => i.date === t || dayOf.get(i.path) === t);
      const ev = items.filter(i => i.date === t && (i.type === 'event' || i.time)).sort(byTime);
      const nx = ev.find(i => (i.time || '') >= hhmm());
      const ms = todos.filter(i => i.project && i.milestone && !i.done && i.date).sort(byDate)[0];
      sb.append(sideTitle('アプリ'));
      const st = el('div', 'stList');
      st.append(
        stRow('list-todo', 'やること', `今日 ${tt.filter(i => i.done).length} / ${tt.length}`, over.length ? `期限切れ ${over.length}件` : `まだ ${todos.filter(i => !i.done).length}件`, () => switchTab('todo'), over.length > 0),
        stRow('folder-kanban', 'プロジェクト', `${projects.length}件`, ms ? `次の節目：${ms.title}（${sd(ms.date)}）` : '節目はありません', () => switchTab('proj')),
        stRow('calendar-days', 'カレンダー', `今日の予定 ${ev.filter(i => i.type === 'event').length}件`, nx ? `次 ${nx.time} ${nx.title}` : 'このあとの予定はありません', () => switchTab('cal')),
        stRow('notebook-text', 'ノート', `${Object.keys(S.files).length}件`, `今日のノート ${dayFiles(t).length}件`, () => switchTab('notes')));
      sb.append(st, sideTitle('すぐにやる'));
      const q = el('nav', 'navCard');
      const dRel = dailyPathOf(t);
      q.append(nav(S.files[dRel] ? 'notebook-text' : 'file-plus', S.files[dRel] ? '今日のノートを開く' : '今日のノートを作る', '', false, () => createDaily(t)),
        nav('file-plus', 'ノートを書く', '', false, () => newNote({ day: t })),
        nav('folder-plus', 'プロジェクトを追加', '', false, () => openProjectSheet(null)),
        nav('refresh-cw', '同期する', '', false, () => sync()));
      sb.append(q);
    } else if (tab === 'todo') {
      // 旧 Workstation と同じ：上に今日のまとめ、下に「今日・明日・予定…」
      const tl = wideList('today'), dn = tl.filter(i => i.done).length;
      const sc = el('div', 'summaryCard');
      const top = el('div', 'sumTop'); const big = el('div', 'sumBig'); big.append(el('b', '', String(dn)), el('span', '', `/ ${tl.length}`)); top.append(big);
      const bar = el('div', 'sumBar'); const bs = el('span'); bs.style.width = (tl.length ? Math.round(dn / tl.length * 100) : 0) + '%'; bar.append(bs);
      const bd = el('div', 'badges');
      const badge = (cls, ic, tx) => { const x = el('span', 'badge ' + cls); x.innerHTML = icon(ic); x.append(tx); return x; };
      bd.append(over.length ? badge('bad', 'triangle-alert', `期限切れ ${over.length}`) : badge('ok', 'circle-check', '期限切れなし'));
      const dueToday = todos.filter(i => !i.done && i.date === t).length;
      if (dueToday) bd.append(badge('soon', 'clock', `今日が期限 ${dueToday}`));
      sc.append(top, el('div', 'sumLabel', `今日のやること・完了 ${dn}件`), bar, bd);
      sb.append(sc, sideTitle('やること'));
      const n = el('nav', 'navCard');
      [['today', 'sun'], ['tomorrow', 'sunrise'], ['planned', 'calendar-days'], ['nodate', 'inbox'], ['all', 'layers'], ['done', 'circle-check']].forEach(([k, ic]) => {
        const l = wideList(k); const c = k === 'done' ? l.length : l.filter(i => !i.done).length;
        n.append(nav(ic, WF[k], c, wideFilter === k, () => { wideFilter = k; render(); }));
      });
      sb.append(n);
      const tags = [...new Set(todos.flatMap(i => i.tags))].filter(x => x !== '節目').sort((a, b) => a.localeCompare(b, 'ja'));
      if (tags.length) {
        sb.append(sideTitle('タグ'));
        const tn = el('nav', 'navCard');
        tn.append(nav('list', 'すべて', '', !todoTag, () => { todoTag = null; render(); }));
        tags.forEach(g => tn.append(nav('tag', '#' + g, todos.filter(i => !i.done && i.tags.includes(g)).length, todoTag === g, () => { todoTag = todoTag === g ? null : g; render(); })));
        sb.append(tn);
      }
      if (projects.length) {
        sb.append(sideTitle('プロジェクト'));
        const pn = el('nav', 'navCard');
        projects.forEach(p => pn.append(nav(p.color, p.name, tasksOf(p).filter(x => !x.done).length, false, () => { proj = p.path; switchTab('proj'); })));
        sb.append(pn);
      }
    } else if (tab === 'proj') {
      const v = el('nav', 'navCard');
      v.append(nav('folder-kanban', '一覧', '', !proj && projView === 'list', () => { proj = null; projView = 'list'; render(); }),
        nav('chart-gantt', 'ガントチャート', '', !proj && projView === 'gantt', () => { proj = null; projView = 'gantt'; render(); }));
      sb.append(v, sideTitle('プロジェクト'));
      const pn = el('nav', 'navCard');
      projects.forEach(p => {
        const all = tasksOf(p), dn = all.filter(x => x.done).length, pct = all.length ? Math.round(dn / all.length * 100) : 0;
        const b = btn('nav gpNav' + (proj === p.path ? ' on' : ''), [], () => { proj = p.path; render(); }, p.name);
        b.style.setProperty('--c', p.color);
        const top = el('span', 'gpTop'); const d = el('i', 'dot'); d.style.setProperty('--c', p.color);
        top.append(d, el('span', 'name', p.name), el('small', '', pct + '%'));
        const tr = el('span', 'gpTrack'); const sp = el('span'); sp.style.width = pct + '%'; tr.append(sp);
        b.append(top, tr);
        pn.append(b);
      });
      if (!projects.length) pn.append(el('div', 'noData', 'まだありません'));
      pn.append(btn('dashBtn', ['folder-plus', 'プロジェクトを追加'], () => openProjectSheet(null)));
      sb.append(pn, sideTitle('まとめ'));
      const pt = todos.filter(i => i.project);
      const info = el('nav', 'navCard gpInfo');
      const line = (ic, tx) => { const d = el('div'); d.innerHTML = icon(ic); d.append(tx); return d; };
      info.append(line('calendar-days', `期限のあるタスク ${pt.filter(i => i.date && !i.done).length}件`), line('flag', `節目 ${pt.filter(i => i.milestone && !i.done).length}件`), line('triangle-alert', `期限切れ ${pt.filter(i => !i.done && i.date && i.date < t).length}件`));
      sb.append(info);
    } else if (tab === 'cal') {
      sb.append(btn('btn primary wide', ['calendar-plus', '予定を追加'], () => newEvent(calSel)), miniCal());
      sb.append(sideTitle(`${relDay(calSel)}に入れる`));
      const q = el('div', 'navCard calSideQ'); const qb = quickEventBox(calSel); qb.querySelector('.inp').placeholder = '14時 MTG（Enter で入れる）'; q.append(qb); sb.append(q);
      sb.append(sideTitle('これから'));
      const up = items.filter(i => i.date && i.date >= t && !i.done && (i.type === 'event' || i.time || i.milestone)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byTime(a, b))).slice(0, 10);
      const n = el('nav', 'navCard');
      if (!up.length) n.append(el('div', 'noData', '予定はありません'));
      up.forEach(i => n.append(nav(i.milestone ? 'flag' : 'clock', i.title, `${sd(i.date)}${i.time ? ' ' + i.time : ''}`, false, () => calGo(i.date))));
      sb.append(n);
    } else if (tab === 'graph') {
      sb.append(sideTitle('カテゴリ'));
      const ls = el('nav', 'navCard ngSide');
      sb.append(ls);
      graphView().listInto(ls);
      sb.append(el('p', 'hint sub ngHelp', '玉を押す：そのカテゴリのノートとリンク。点を押す：ノートのくわしいこと（ダブルクリックで開く）。ドラッグで動かす・ホイールで拡大'));
    } else if (tab === 'notes') {
      // 旧 Workstation と同じ：新しいノート・今日のノート、ファイル／検索／タグ、フォルダの木
      const top = el('div', 'nt-sideTop');
      const nb = btn('btn primary', ['file-plus'], () => newNote({ day: t }), '新しいノート'); nb.append(el('span', 'lbl-long', '新しいノート'), el('span', 'lbl-short', '新規'));
      top.append(nb, btn('btn white', 'calendar', () => createDaily(t), '今日のノート'));
      sb.append(top);
      const tagCount = new Map();
      for (const p of Object.keys(S.files)) for (const g of noteTags.get(p) || []) tagCount.set(g, (tagCount.get(g) || 0) + 1);
      const seg = el('div', 'seg nt-sideSeg');
      const tb = (k, ic, l, n) => { const b2 = btn(ntSideTab === k ? 'on' : '', [ic], () => { ntSideTab = k; renderSide(); if (k === 'search') $('#side .ntSearch')?.focus(); }, l); b2.append(el('span', 'lbl', l)); if (n != null) b2.append(el('small', '', String(n))); return b2; };
      seg.append(tb('files', 'files', 'ファイル', Object.keys(S.files).length), tb('search', 'search', '検索'), tb('tags', 'hash', 'タグ', tagCount.size));
      sb.append(seg);
      if (ntSideTab === 'files') {
        const hd = el('div', 'nt-sideHead'); hd.append(sideTitle('ノート'));
        const hb = el('span', 'nt-headBtns');
        hb.append(btn('nt-rowBtn', 'file-plus', () => newNote({}), 'ノートを作る'), btn('nt-rowBtn', 'chevrons-down-up', () => { openFolders.clear(); renderSide(); }, 'フォルダをすべて閉じる'));
        hd.append(hb);
        sb.append(hd, noteTree());
      } else if (ntSideTab === 'search') {
        const q = el('input', 'inp ntSearch'); q.placeholder = '名前・本文・#タグ'; q.value = noteQuery;
        q.addEventListener('input', () => { noteQuery = q.value; note = null; redrawMain(); });
        sb.append(q, el('div', 'sideFoot', '入力すると、中央に見つかったノートが出ます'));
      } else {
        const tn = el('nav', 'navCard');
        tn.append(nav('notebook-text', 'すべてのノート', Object.keys(S.files).length, !noteTag && !noteDay && !noteFolder && !note, () => { noteDay = noteTag = noteFolder = null; note = null; render(); }));
        [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).forEach(([g, c]) =>
          tn.append(nav('tag', '#' + g, c, noteTag === g && !note, () => { noteTag = g; noteDay = noteFolder = null; noteQuery = ''; note = null; render(); })));
        sb.append(tn);
      }
    } else if (tab === 'sync') {
      const sc = el('div', 'summaryCard');
      sc.append(el('div', 'sumLabel', desk ? 'ノートのフォルダ' : 'GitHub のリポジトリ'));
      sc.querySelector('.sumLabel').style.margin = '0 0 4px';
      sc.append(el('b', 'sideSrc', connected() ? (desk ? sourceName() : `${cfg.owner}/${cfg.repo}`) : 'まだつないでいません'));
      sb.append(sc);
      const n = el('nav', 'navCard gpInfo');
      const line = (ic, tx) => { const d = el('div'); d.innerHTML = icon(ic); d.append(tx); return d; };
      n.append(line('notebook-text', `ノート ${Object.keys(S.files).length}件`), line('list-todo', `やること ${todos.length}件`), line('calendar-clock', `予定 ${items.filter(i => i.type === 'event').length}件`), line('folder-kanban', `プロジェクト ${projects.length}件`));
      sb.append(n);
    }
    const foot = el('div', 'sideFoot', connected() ? `${desk ? sourceName() : cfg.owner + '/' + cfg.repo}${S.syncedAt ? ` ・ ${new Date(S.syncedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} に読み込み` : ''}` : 'お試しのノートを表示中');
    sb.append(foot);
  }
  function focusSearch() {
    if (isWide() && window.NotesApp) { if (tab !== 'notes') { tab = 'notes'; render(); } NotesApp.searchAll(); return; }
    if (editing && note && draft !== (S.files[note]?.text ?? '') && !confirm('保存していない変更があります。破棄しますか？')) return;
    editing = false; note = null; noteDay = noteTag = noteFolder = null; tab = 'notes';
    if (isWide()) ntSideTab = 'search';
    render();
    const q = document.querySelector(isWide() ? '#side .ntSearch' : '#view .search'); if (q) q.focus();
  }
  // 中央だけ描き直す（サイドバーの入力欄のフォーカスを残すため）
  function redrawMain() {
    const main = $('#view'); main.innerHTML = '';
    ({ home: renderHome, todo: renderTodo, proj: renderProj, cal: renderCal, notes: renderNotes, graph: renderGraph, sync: renderSync })[tab](main);
  }
  $('#sideSearch').addEventListener('click', focusSearch);
  // サイドバーを隠す・出す（タブごとに覚える）
  const sideHidden = () => isWide() && !!(prefs.sideHidden || {})[tab];
  function setSideHidden(h) {
    prefs.sideHidden = { ...(prefs.sideHidden || {}), [tab]: h };
    if (!h) delete prefs.sideHidden[tab];
    savePrefs();
    render();
  }
  $('#sideHide').addEventListener('click', () => setSideHidden(true));
  $('#sideShow').addEventListener('click', () => setSideHidden(false));
  document.addEventListener('keydown', e => {
    if (ntOn() && NotesApp.onKey(e)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusSearch(); }
    if (ntOn() && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); NotesApp.newNote(); }
  });

  const TITLES = { home: 'ホーム', todo: 'やること', proj: 'プロジェクト', cal: 'カレンダー', notes: 'ノート', graph: 'つながり', sync: '同期' };
  function switchTab(t) {
    if (editing && note && draft !== (S.files[note]?.text ?? '') && !confirm('保存していない変更があります。破棄しますか？')) return;
    if (t === 'notes' && tab === 'notes') { note = null; noteQuery = ''; }
    if (t === 'proj' && tab === 'proj') proj = null;
    if (t !== 'notes') editing = false;
    if (t !== 'cal' && calDraft) clearDraft();
    if (tab === 'notes' && t !== 'notes' && window.NotesApp) NotesApp.flush();
    tab = t;
    render();
    window.scrollTo(0, 0); $('#view').scrollTop = 0;
  }
  // 同期のタブの印：つながらない・ぶつかった（!）、Mac 版でまだ送っていない変更の数
  function updateBadge() {
    const badge = $('#syncBadge');
    const err = connected() && (S.error || (desk && deskSt?.git?.error));
    const n = desk && deskSt?.git?.repo ? (deskSt.pending || 0) + (deskSt.git.ahead || 0) : 0;
    badge.hidden = !(err || n);
    badge.textContent = err ? '!' : n > 99 ? '99+' : String(n);
  }
  let pendingReload = false;
  // ---- PC の幅のノート：旧 Workstation のノートの画面 ----
  const ntOn = () => isWide() && tab === 'notes' && !!window.NotesApp;
  const Nt = { side: null, view: null, queued: false };
  const ntDark = () => (cfg.theme === 'dark' || (cfg.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches));
  const mk2 = (cls, ic, label, fn, title) => { const b = el('button', cls); b.type = 'button'; b.innerHTML = icon(ic); b.append(label); if (title) b.title = title; b.addEventListener('click', fn); return b; };
  function ntChrome() {
    if (!ntOn()) return;
    $('#title').textContent = NotesApp.title();
    $('#eyebrow').textContent = NotesApp.sub() || (connected() ? sourceName() : 'お試しのノート');
    const acts = $('#topActs'); acts.innerHTML = '';
    NotesApp.toolbar(acts, mk2);
    NotesApp.syncSide();
  }
  function ntRender() {
    $('#view').classList.add('ntMode');
    document.body.dataset.app = 'notes';
    Nt.view.dataset.ntTheme = ntDark() ? 'dark' : 'light';
    const main = $('#view');
    if (main.firstChild !== Nt.view || main.childNodes.length !== 1) { main.innerHTML = ''; main.append(Nt.view); }
    NotesApp.show(Nt.view);
    ntChrome();
  }
  function ntSetup() {
    if (!window.NotesApp || Nt.view) return;
    Nt.side = el('div', 'sideApp'); Nt.side.id = 'sideNotes'; Nt.side.dataset.app = 'notes';
    Nt.view = el('div', 'nt-view'); Nt.view.id = 'notesView';
    // 旧ノート画面からの「描き直して」：まとめて1フレームに1回
    const refresh = () => { if (Nt.queued) return; Nt.queued = true; requestAnimationFrame(() => { Nt.queued = false; if (ntOn()) { renderRail(); ntRender(); } else if (tab === 'home' || tab === 'todo' || tab === 'proj' || tab === 'cal') render(); }); };
    Bridge.onSettings = refresh;
    NotesApp.init({
      api: Bridge.api,
      get: () => ({ settings: Bridge.settings, projects: projects.map(p => ({ id: p.path, name: p.name, color: p.color })), tasks: [] }),
      go: () => { if (tab !== 'notes') switchTab('notes'); else if (ntOn()) ntRender(); },
      refresh,
      view: () => (ntOn() ? 'notes' : tab),
      chrome: ntChrome,
      showSide: () => {},
      fileUrl: Bridge.fileUrl,
    });
    NotesApp.start();
  }
  function render() {
    if (!ntOn()) { $('#view').classList.remove('ntMode'); delete document.body.dataset.app; }
    $('#view').classList.toggle('gMode', tab === 'graph');
    $('#view').classList.remove('calMode');
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (tab === 'graph' ? 'notes' : tab)));
    const d = new Date();
    $('#eyebrow').textContent = tab === 'notes' && note ? (connected() ? sourceName() : 'デモ').toUpperCase() : `${d.getMonth() + 1}月${d.getDate()}日 ${WD[d.getDay()]}曜日`;
    $('#title').textContent = tab === 'notes' && note ? nameOf(note) : tab === 'proj' && proj && projByPath(proj) ? projByPath(proj).name : TITLES[tab];
    $('#title').classList.toggle('long', $('#title').textContent.length > 12);
    if (tab === 'proj' && proj) $('#eyebrow').textContent = 'プロジェクト';
    const acts = $('#topActs');
    acts.innerHTML = '';
    if (tab === 'notes' && !note) acts.append(btn('btn primary small', ['plus', 'ノート'], () => newNote({ day: todayKey() })));
    if (tab === 'proj' && !proj && projView === 'list') acts.append(btn('btn primary small', ['plus', 'プロジェクト'], () => openProjectSheet(null)));
    if (tab === 'cal') acts.append(btn('btn primary small', ['calendar-plus', '予定'], () => newEvent(calSel)));
    if (tab !== 'sync') {
      const sb = btn('iconBtn' + (syncing ? ' spin' : ''), 'refresh-cw', () => sync(), '同期');
      acts.append(sb);
    }
    updateBadge();
    document.documentElement.classList.toggle('noSide', sideHidden());
    if (isWide()) {
      renderRail(); renderSide();
      // ツールバーの右のボタン（Mac と同じ）・見出しの横の説明
      const ey = $('#eyebrow');
      if (tab === 'home') { ey.textContent = ''; $('#title').textContent = 'ダッシュボード'; }
      if (tab === 'todo') { $('#title').textContent = WF[wideFilter]; ey.textContent = md(todayKey()); }
      if (tab === 'proj' && !proj && projView === 'gantt') {
        $('#title').textContent = 'ガントチャート'; ey.textContent = '📅 期限・🛫 開始日のあるタスク';
        acts.querySelector('.btn.primary')?.remove();
        const tg = (label, on, set) => { const l = el('label', 'toggle', label); const i = el('input'); i.type = 'checkbox'; i.className = 'switch'; i.checked = on; i.addEventListener('change', () => set(i.checked)); l.append(i); return l; };
        acts.prepend(btn('btn white', ['locate-fixed', '今日'], () => ganttToToday()),
          tg('カード', prefs.cards !== false, v => { prefs.cards = v; savePrefs(); render(); }),
          tg('完了を隠す', !prefs.showDone, v => { prefs.showDone = !v; savePrefs(); render(); }));
      }
      if (tab === 'notes' && !note) {
        acts.querySelector('.btn.primary')?.remove();
        acts.prepend(btn('btn white', ['calendar', '今日のノート'], () => createDaily(todayKey())), btn('btn primary', ['file-plus', '新しいノート'], () => newNote({ day: todayKey() })));
      }
      if (tab === 'proj' && proj) ey.textContent = 'メモ・リンク・タスク';
      if (tab === 'notes' && note) ey.textContent = folderOf(note) || '';
      if (tab === 'home') acts.prepend(btn('btn white', ['file-plus', 'ノートを書く'], () => newNote({ day: todayKey() })));
      if (tab === 'graph') acts.prepend(graphBySeg());
      if (tab === 'cal') { acts.querySelector('.btn.primary')?.remove(); acts.prepend(btn('btn primary', ['calendar-plus', '予定を追加'], () => newEvent(calSel))); }
      if (tab === 'proj' && proj && projByPath(proj)) {
        acts.prepend(btn('btn white', ['chart-gantt', 'ガントで見る'], () => { proj = null; projView = 'gantt'; render(); }),
          btn('btn white', ['palette', '色'], () => openProjectSheet(projByPath(proj))),
          btn('btn white', ['file-text', 'ノート'], () => openNote(proj)),
          btn('btn primary', ['plus', 'タスクを追加'], () => { const i = document.querySelector('.ptAdd .inp'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); } }));
      }
    }
    if (ntOn()) return ntRender();
    const main = $('#view');
    main.innerHTML = '';
    if (!connected() && tab !== 'sync') {
      const b = btn('demoBar', [], () => switchTab('sync'));
      b.innerHTML = icon('info');
      b.append(desk ? 'お試しのノートを表示中。「同期」からノートのフォルダを選ぶと、自分のノートになります' : 'お試しのノートを表示中。「同期」から GitHub につなぐと、自分のノートになります');
      main.append(b);
    }
    ({ home: renderHome, todo: renderTodo, proj: renderProj, cal: renderCal, notes: renderNotes, graph: renderGraph, sync: renderSync })[tab](main);
  }
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-icon]').forEach(e => e.insertAdjacentHTML('afterbegin', icon(e.dataset.icon)));

  // アプリに戻ってきたとき：日付が変わっていれば今日に、1分以上たっていれば読み直す
  let lastDay = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = todayKey();
    if (t !== lastDay) { if (calSel === lastDay) calSel = t; lastDay = t; render(); }
    if (!desk && connected() && !editing && Date.now() - (S.syncedAt || 0) > 60000) sync(true);
  });
  window.addEventListener('beforeunload', e => { if (editing && draft !== (S.files[note]?.text ?? '')) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- はじめ ----------
  (async () => {
    applyTheme();
    try { await DB.open(); } catch {}
    if (desk) {
      deskSt = await desk.status();
      desk.onChanged(() => { if (!editing) sync(true); else pendingReload = true; });
      desk.onStatus(st => { deskSt = st; if (tab === 'sync') render(); else updateBadge(); });
      desk.onToast(m => m && toast(m, 'warn'));
      document.documentElement.classList.add('desk');
    } else if (connected()) {
      const snap = await DB.get('snap:' + cfg.owner + '/' + cfg.repo + '@' + branch() + ':' + (cfg.prefix || ''));
      if (snap) S = snap;
    }
    recompute();
    ntSetup();
    render();
    sync(true);
    try { navigator.storage?.persist?.(); } catch {}
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      // 新しい版を公開したら：裏で取ってきて入れかわったときに1回だけ読み直す（書いている途中なら、次に開いたとき）
      const hadCtl = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadCtl || reloaded) return;
        const busy = editing || document.querySelector('#notesView .nt-editor:focus') || $('#sheet').open;
        if (busy) { toast('新しい版があります。アプリを開き直すと入れかわります'); return; }
        reloaded = true; location.reload();
      });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => {
        r.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
      }).catch(() => {});
    }
  })();
})();
