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
  let S = { files: {}, dailyJson: null, syncedAt: null, error: null };
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
  const ignored = p => p.split('/').some(s => s.startsWith('.')) || p.includes('node_modules/');
  async function pull() {
    if (desk) {
      const r = await desk.scan();
      if (r.error) { const e = new Error(r.error); e.status = 400; throw e; }
      S = { files: r.files, dailyJson: r.dailyJson, syncedAt: Date.now(), error: null };
      if (r.truncated) toast('ファイルが多すぎて、一部しか読めていません', 'warn');
      return;
    }
    const tree = await gh(`${repoBase()}/git/trees/${encodeURIComponent(branch())}?recursive=1`);
    const pre = (cfg.prefix || '').replace(/^\/+|\/+$/g, '');
    const inPre = p => !pre || p === pre || p.startsWith(pre + '/');
    const strip = p => (pre ? p.slice(pre.length + 1) : p);
    const blobs = tree.tree.filter(t => t.type === 'blob' && inPre(t.path) && /\.md$/i.test(t.path) && !ignored(strip(t.path)));
    const dj = tree.tree.find(t => t.type === 'blob' && t.path === (pre ? pre + '/' : '') + '.obsidian/daily-notes.json');
    const next = {};
    await pool(blobs, 6, async b => {
      const rel = strip(b.path);
      const old = S.files[rel];
      if (old && old.sha === b.sha) { next[rel] = old; return; }
      const blob = await gh(`${repoBase()}/git/blobs/${b.sha}`);
      next[rel] = { sha: b.sha, text: b64ToText(blob.content) };
    });
    let dailyJson = null;
    if (dj) { try { dailyJson = b64ToText((await gh(`${repoBase()}/git/blobs/${dj.sha}`)).content); } catch {} }
    S = { files: next, dailyJson, syncedAt: Date.now(), error: null };
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
      S.error = e.status === 401 ? 'トークンが使えません' : e.status === 404 ? 'リポジトリかブランチが見つかりません' : 'つながりませんでした（オフライン？）';
      if (!quiet || e.status) toast(S.error, 'warn');
      console.error(e);
    } finally { syncing = false; recompute(); render(); }
  }

  // ファイルを書きかえて commit（失敗したら元に戻す）。fn(今の本文) → 新しい本文（変えないなら null）
  async function edit(rel, fn, message) {
    const f = S.files[rel];
    const before = f ? f.text : null;
    const next = fn(before);
    if (next == null || next === before) return false;
    const prev = f ? { ...f } : null;
    S.files[rel] = { sha: f ? f.sha : null, text: next };
    recompute(); render();
    if (!connected()) { S.files[rel].sha = S.files[rel].sha || 'demo'; return true; }
    try {
      S.files[rel].sha = await putFile(rel, next, prev && prev.sha, message);
      await persist();
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
    main.append(kp);

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
    main.append(p);

    const ps = panel();
    ps.append(panelHead('calendar-clock', '今日の予定', el('span', '', `${sched.length}件`)));
    if (!sched.length) ps.append(noData('時刻つきの予定（- 14:00 MTG など）はありません'));
    sched.forEach(i => ps.append(planRow(i)));
    main.append(ps);

    if (over.length) {
      const po = panel();
      po.append(panelHead('triangle-alert', '期限切れ', el('span', '', `${over.length}件`)));
      over.slice(0, 8).forEach(i => po.append(todoRow(i)));
      if (over.length > 8) po.append(btn('addTask', ['chevron-right', `ほか ${over.length - 8} 件`], () => { todoFilter = 'over'; switchTab('todo'); }));
      main.append(po);
    }
    const other = todayAll.filter(i => i.type === 'todo' && !i.time);
    if (other.length) {
      const pt = panel();
      pt.append(panelHead('list-todo', 'ほかのノートの今日の分', el('span', '', `${other.length}件`)));
      other.forEach(i => pt.append(todoRow(i, { noDate: true })));
      main.append(pt);
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
    main.append(pn);
  }
  const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  // ================= やること =================
  function renderTodo(main) {
    const t = todayKey();
    const seg = el('div', 'seg');
    [['open', '未完了'], ['over', '期限切れ'], ['nodate', '日付なし'], ['done', '完了']].forEach(([k, l]) =>
      seg.append(btn(todoFilter === k ? 'on' : '', l, () => { todoFilter = k; render(); })));
    const bar = el('div', 'gtool'); bar.append(seg);
    main.append(bar);
    const all = items.filter(i => i.type === 'todo');
    const tags = [...new Set(all.flatMap(i => i.tags))].sort();
    if (tags.length) {
      const tg = el('div', 'tagBar');
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
  const LANES = 3;
  function renderCal(main) {
    const today = todayKey();
    const nav = el('div', 'mnav');
    nav.append(btn('iconBtn', 'chevron-left', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); }, '前の月'),
      el('b', '', `${calMonth.getFullYear()}年${calMonth.getMonth() + 1}月`),
      btn('iconBtn', 'chevron-right', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); }, '次の月'),
      btn('btn white small', ['locate-fixed', '今月'], () => { const d = new Date(); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); calSel = today; render(); }));
    main.append(nav);
    const cal = el('div', 'cal-month');
    const wd = el('div', 'cal-wd');
    [1, 2, 3, 4, 5, 6, 0].forEach(i => wd.append(el('span', i === 0 || i === 6 ? 'we' : '', WD[i])));
    cal.append(wd);
    const first = keyOf(calMonth);
    const start = addDays(first, -((calMonth.getDay() + 6) % 7));
    const days = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((((calMonth.getDay() + 6) % 7) + days) / 7);
    const byDay = new Map();
    for (const i of items) if (i.date && !(i.type === 'todo' && i.done && i.path !== dailyPathOf(i.date))) (byDay.get(i.date) || byDay.set(i.date, []).get(i.date)).push(i);
    for (const arr of byDay.values()) arr.sort((a, b) => (a.type === b.type ? byTime(a, b) : a.type === 'event' ? -1 : 1));
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(start, w * 7);
      const row = el('div', 'cal-week');
      let lanesUsed = 1, anyMore = false;
      for (let i = 0; i < 7; i++) {
        const k = addDays(ws, i), d = parseKey(k);
        const c = btn('cal-day' + (d.getMonth() !== calMonth.getMonth() ? ' out' : '') + ([0, 6].includes(d.getDay()) ? ' we' : '') + (k === today ? ' today' : '') + (k === calSel ? ' sel' : ''),
          [], () => { calSel = k; if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1); render(); }, md(k));
        c.style.gridColumn = String(i + 1);
        c.append(el('span', 'cal-dnum', String(d.getDate())));
        if (dayFiles(k).length) c.append(el('i', 'cal-hb'));
        row.append(c);
        // やることは日付の下に点（まだの分。期限切れは赤）、予定はバー
        const tds = (byDay.get(k) || []).filter(x => x.type === 'todo' && !x.done);
        if (tds.length) {
          const dots = el('span', 'cal-dots');
          tds.slice(0, 4).forEach(() => dots.append(el('i', k < today ? 'late' : '')));
          c.append(dots);
        }
        const arr = (byDay.get(k) || []).filter(x => x.type === 'event');
        arr.slice(0, LANES).forEach((it, lane) => {
          const b = btn('cal-bar', [], () => openItem(it), it.title);
          b.style.setProperty('--c', '#005cff');
          b.style.gridColumn = String(i + 1);
          b.style.gridRow = String(lane + 2);
          b.append(el('span', '', (it.time ? it.time + ' ' : '') + it.title));
          row.append(b);
          lanesUsed = Math.max(lanesUsed, lane + 1);
        });
        if (arr.length > LANES) {
          anyMore = true;
          const m = btn('cal-more', `+${arr.length - LANES}`, () => { calSel = k; render(); }, `ほか${arr.length - LANES}件`);
          m.style.gridColumn = String(i + 1); m.style.gridRow = String(LANES + 2);
          row.append(m);
        }
      }
      row.style.gridTemplateRows = `28px repeat(${anyMore ? LANES : lanesUsed}, 17px)${anyMore ? ' 14px' : ''}`;
      cal.append(row);
    }
    const lg = el('div', 'legend');
    lg.innerHTML = '<span><i class="cal-hb"></i>その日のノートあり</span><span><i class="sq ev"></i>予定</span><span><i class="cal-dot"></i>まだのやること</span><span><i class="cal-dot late"></i>期限切れ</span>';
    cal.append(lg);
    main.append(cal);

    const k = calSel;
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
    p.append(panelHead('calendar-clock', '予定', el('span', '', `${ev.length}件`)));
    if (!ev.length) p.append(noData('この日の予定はありません'));
    ev.forEach(i => p.append(planRow(i)));
    p.append(panelHead('list-todo', 'やること', el('span', '', `${td.filter(i => i.done).length}/${td.length}`)));
    if (!td.length) p.append(noData('この日のやることはありません'));
    td.forEach(i => p.append(todoRow(i, { noDate: true })));
    p.append(addForm(k, `${relDay(k)}のノートにやることを足す`));
    main.append(p);
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

  function projCard(p) {
    const today = todayKey();
    const all = tasksOf(p), done = all.filter(t => t.done).length;
    const next = all.filter(t => !t.done && t.date).sort(byDate)[0];
    const c = btn('pcard', [], () => { proj = p.path; render(); window.scrollTo(0, 0); }, p.name);
    c.style.setProperty('--c', p.color);
    const f = el('div', 'pcFront');
    f.append(el('div', 'pcName', p.name));
    const meta = el('div', 'pcMeta');
    meta.append(el('span', '', `残り ${all.length - done}件`), el('span', '', `完了 ${done}/${all.length}`));
    if (next) { const s = el('span'); s.innerHTML = icon('clock'); s.append(next.date === today ? '今日' : next.date < today ? '期限切れ' : sd(next.date)); meta.append(s); }
    f.append(meta);
    const pr = el('div', 'pcBar'); const pf = el('i');
    pf.style.width = (all.length ? Math.round(done / all.length * 100) : 0) + '%';
    pr.append(pf); f.append(pr);
    c.append(f);
    return c;
  }

  function renderProj(main) {
    if (proj && projByPath(proj)) return renderProjDetail(main, projByPath(proj));
    proj = null;
    const tool = el('div', 'gtool');
    const seg = el('div', 'seg');
    seg.append(btn(projView === 'list' ? 'on' : '', '一覧', () => { projView = 'list'; render(); }),
      btn(projView === 'gantt' ? 'on' : '', 'ガント', () => { projView = 'gantt'; render(); }));
    tool.append(seg);
    if (projView === 'gantt') {
      const s2 = el('div', 'seg');
      s2.append(btn(prefs.showDone ? '' : 'on', '進行中', () => { prefs.showDone = false; savePrefs(); render(); }),
        btn(prefs.showDone ? 'on' : '', 'すべて', () => { prefs.showDone = true; savePrefs(); render(); }));
      tool.append(s2);
    }
    main.append(tool);
    if (projView === 'gantt') return renderGantt(main);

    const box = el('div', 'pcards pgrid');
    projects.forEach(p => box.append(projCard(p)));
    box.append(btn('pcAdd', ['folder-plus', 'プロジェクトを追加'], () => openProjectSheet(null)));
    main.append(box);
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
    soon.forEach(i => ps.append(todoRow(i, { proj: true })));
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
    main.append(bar);

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
    main.append(sm);

    // タスク
    const pt = panel();
    pt.append(panelHead('list-todo', 'タスク', el('span', '', `${open.length}件`)));
    if (!all.length) pt.append(noData('まだタスクはありません'));
    open.forEach(t => pt.append(todoRow(t, { proj: true, inProj: true })));
    if (done.length) {
      pt.append(btn('addTask', [prefs.showDoneIn ? 'chevron-down' : 'chevron-right', `完了 ${done.length}件`], () => { prefs.showDoneIn = !prefs.showDoneIn; savePrefs(); render(); }));
      if (prefs.showDoneIn) done.forEach(t => pt.append(todoRow(t, { proj: true, inProj: true })));
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
    main.append(pt);

    if (p.memo) {
      const pm = panel();
      pm.append(panelHead('notebook-text', 'メモ'));
      setupMarked();
      const d = el('div', 'nt-doc memoDoc');
      d.innerHTML = window.DOMPurify.sanitize(window.marked.parse(p.memo));
      d.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
      pm.append(d);
      main.append(pm);
    }
    if (p.links.length) {
      const pl = panel();
      pl.append(panelHead('link', 'リンク', el('span', '', `${p.links.length}件`)));
      p.links.forEach(l => {
        const r = btn('prow', [], () => (desk ? desk.openExternal(l.url) : window.open(l.url, '_blank', 'noopener')));
        r.insertAdjacentHTML('beforeend', icon('link-2'));
        r.append(el('b', '', l.title));
        r.insertAdjacentHTML('beforeend', icon('external-link'));
        pl.append(r);
      });
      main.append(pl);
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
    if (note) return renderNote(main);
    const q = el('input', 'inp search');
    q.placeholder = 'ノートを検索（名前・本文・#タグ）';
    q.value = noteQuery;
    q.addEventListener('input', () => { noteQuery = q.value; drawList(); });
    main.append(q);
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
      const tb = el('div', 'tagBar');
      [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).forEach(([t, n]) =>
        tb.append(btn('chip' + (noteTag === t ? ' ok' : ''), `#${t} ${n}`, () => { noteTag = noteTag === t ? null : t; render(); })));
      main.insertBefore(tb, box);
    }
    function drawList() {
      box.innerHTML = '';
      const s = noteQuery.trim().toLowerCase();
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
    if (editing && note && draft !== (S.files[note]?.text ?? '') && !confirm('保存していない変更があります。破棄しますか？')) return;
    note = p; editing = false;
    if (tab !== 'notes') tab = 'notes';
    render(); window.scrollTo(0, 0);
  }
  function startEdit() { editing = true; draft = S.files[note]?.text ?? ''; render(); }
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
      main.append(ta);
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
  const TITLES = { home: 'ホーム', todo: 'やること', proj: 'プロジェクト', cal: 'カレンダー', notes: 'ノート', sync: '同期' };
  function switchTab(t) {
    if (editing && note && draft !== (S.files[note]?.text ?? '') && !confirm('保存していない変更があります。破棄しますか？')) return;
    if (t === 'notes' && tab === 'notes') { note = null; noteQuery = ''; }
    if (t === 'proj' && tab === 'proj') proj = null;
    if (t !== 'notes') editing = false;
    tab = t;
    render();
    window.scrollTo(0, 0);
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
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const d = new Date();
    $('#eyebrow').textContent = tab === 'notes' && note ? (connected() ? sourceName() : 'デモ').toUpperCase() : `${d.getMonth() + 1}月${d.getDate()}日 ${WD[d.getDay()]}曜日`;
    $('#title').textContent = tab === 'notes' && note ? nameOf(note) : tab === 'proj' && proj && projByPath(proj) ? projByPath(proj).name : TITLES[tab];
    if (tab === 'proj' && proj) $('#eyebrow').textContent = 'プロジェクト';
    const acts = $('#topActs');
    acts.innerHTML = '';
    if (tab === 'notes' && !note) acts.append(btn('btn primary small', ['plus', 'ノート'], () => newNote({ day: todayKey() })));
    if (tab === 'proj' && !proj && projView === 'list') acts.append(btn('btn primary small', ['plus', 'プロジェクト'], () => openProjectSheet(null)));
    if (tab !== 'sync') {
      const sb = btn('iconBtn' + (syncing ? ' spin' : ''), 'refresh-cw', () => sync(), '同期');
      acts.append(sb);
    }
    updateBadge();
    const main = $('#view');
    main.innerHTML = '';
    if (!connected() && tab !== 'sync') {
      const b = btn('demoBar', [], () => switchTab('sync'));
      b.innerHTML = icon('info');
      b.append(desk ? 'お試しのノートを表示中。「同期」からノートのフォルダを選ぶと、自分のノートになります' : 'お試しのノートを表示中。「同期」から GitHub につなぐと、自分のノートになります');
      main.append(b);
    }
    ({ home: renderHome, todo: renderTodo, proj: renderProj, cal: renderCal, notes: renderNotes, sync: renderSync })[tab](main);
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
    render();
    sync(true);
    try { navigator.storage?.persist?.(); } catch {}
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
