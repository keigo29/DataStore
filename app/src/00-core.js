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

  let filesVersion = 0;           // recompute のたびに増える（作り直しのいらない計算の目印）
  function recompute() {
    filesVersion++;
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
        'Inbox.md': f(`# Inbox\n\n- [ ] 資格の問題集 3章 @due(${d(3)}) #資格\n- [ ] ポートフォリオの README を書く #個人開発\n- [x] AWS の請求を確認 #仕事\n- [ ] 💸 68,000 家賃 #住まい 📅 ${d(13)}\n- [ ] 💸 4,980 スマホ代 #通信 📅 ${d(6)}\n- [ ] 💸 5,000 飲み会 📅 ${d(2)}\n- [x] 💸 1,200 本 #学び 📅 ${d(-2)}\n`),
        'Projects/ほのぼの書店.md': f(`---\ncolor: "#005cff"\nlinks:\n  - GitLab https://gitlab.com/\n  - 設計書 https://example.com/design\n---\nSpring Boot のグループ開発。EC2（Tomcat・MySQL）にデプロイする。\n\n## タスク\n- [x] 要件のまとめ 🛫 ${d(-9)} 📅 ${d(-6)}\n- [x] 画面設計 🛫 ${d(-5)} 📅 ${d(-2)}\n- [ ] 注文画面の実装 🛫 ${d(-1)} 📅 ${d(4)}\n- [ ] テスト 🛫 ${d(5)} 📅 ${d(9)}\n- [ ] 発表 📅 ${d(12)} #節目\n`),
        'Projects/資格の勉強.md': f(`---\ncolor: "#00c230"\n---\n基本情報技術者試験。\n\n## タスク\n- [x] 1章 🛫 ${d(-12)} 📅 ${d(-8)}\n- [ ] 2章 🛫 ${d(-7)} 📅 ${d(-1)}\n- [ ] 3章 🛫 ${d(0)} 📅 ${d(6)}\n- [ ] 試験日 📅 ${d(20)} #節目\n`),
        'Projects/引越し貯金.md': f(`---\ncolor: "#1a9e5c"\ntags: [お金]\ntarget: 400000\nsaved: 170000\ndue: ${d(170)}\n---\n引越しのための貯金。\n\n## タスク\n- [ ] 毎月の積立額を決める 📅 ${d(9)}\n- [ ] 貯金 20万円\n- [ ] 引越し 📅 ${d(190)} #節目\n`),
        ...Object.fromEntries(Array.from({ length: 24 }, (_, j) => j + 1).filter(j => j % 5 !== 2).map(j => [`${d(-j).replace(/-/g, '/')}/気分.md`, f(`---\ntags: [日誌]\n---\n## メモ\n- 気分 ${[4, 3, 5, 3, 2, 4, 4, 3][j % 8]}/5 ${['よく眠れた', '', '筋トレのあと すっきり', '', '寝不足', '散歩した', '', '仕事が多い'][j % 8]}\n`)])),
        'Projects/減量.md': f(`---\ncolor: "#ff7a1a"\ntags: [筋トレ]\ngoal_weight: 67\ngoal_due: ${d(110)}\n---\n筋肉を落とさずに、体脂肪を落とす。\n\n## タスク\n- [ ] 毎朝体重をはかってデイリーに書く\n`),
        'Spring Boot メモ.md': f(`---\nproject: 研修\ntags: [java, spring]\n---\n## よく使うアノテーション\n- \`@RestController\` … JSON を返す\n- \`@Transactional\` … まとめてコミット／ロールバック\n\n## 予定\n### ${d(5)}\n- 13:00 Spring 勉強会（社内）\n- [ ] 勉強会の資料を準備 #仕事\n\n> [!tip] ==大事==\n> Bean のスコープは基本シングルトン\n`),
      },
      dailyJson: JSON.stringify({ folder: '', format: 'YYYY/MM/DD/[デイリー]' }),
      cfg: { 'Data/kakei.json': demoKakei(t), ...demoHealth(t) },
    };
  }
  // お試しの家計データ（家計アプリのバックアップと同じ形）
  function demoKakei(t) {
    let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const txs = []; let n = 0;
    const add = (type, amount, date, category, accountId, memo) => txs.push({ id: 'demo' + ++n, type, amount, date, category, accountId, memo, createdAt: date + 'T12:00:00' });
    for (let i = -48; i <= 0; i++) {
      const k = addDays(t, i), d = +k.slice(8);
      if (d === 25) add('income', 230000, k, 'salary', 'a1', '給料');
      if (d === 27) add('expense', 68000, k, 'housing', 'a1', '家賃');
      if (d === 5) add('expense', 3300, k, 'phone', 'a2', 'スマホ');
      if (d === 10) add('expense', 1490, k, 'subscription', 'a2', '動画サブスク');
      if (d === 28) add('transfer', 40000, k, null, 'a1', '貯金へ'), txs[txs.length - 1].toAccountId = 'a2';
      if (rnd() < .8) add('expense', Math.round((600 + rnd() * 900) / 10) * 10, k, 'food', 'a2', rnd() < .5 ? 'ランチ' : 'スーパー');
      if (rnd() < .25) add('expense', Math.round((300 + rnd() * 400) / 10) * 10, k, 'cafe', 'a2', 'カフェ');
      if (rnd() < .2) add('expense', Math.round((200 + rnd() * 900) / 10) * 10, k, 'transport', 'a2', '電車');
      if (rnd() < .08) add('expense', Math.round((800 + rnd() * 3000) / 10) * 10, k, 'daily', 'a2', '日用品');
      if (rnd() < .05) add('expense', Math.round((2000 + rnd() * 5000) / 10) * 10, k, 'hobby', 'a2', '本・ゲーム');
    }
    return JSON.stringify({ version: 1, settings: { budget: 120000 }, accounts: [{ id: 'a1', name: '楽天銀行', type: 'bank', initial: 120000, order: 1 }, { id: 'a2', name: 'PayPay銀行', type: 'bank', initial: 30000, order: 2 }], txs });
  }

  // お試しの体の記録（ヘルスケアの CSV・筋トレメモの CSV と同じ形）
  function demoHealth(t) {
    let seed = 11; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const h = ['date,weight_kg,body_fat_pct,sleep_min,steps,resting_hr,active_kcal,sleep_deep_min,sleep_core_min,sleep_rem_min,sleep_awake_min,bed_time,wake_time'];
    const hm2 = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
    const z = ['date,start,end,stage'];
    const s = ['date,start,session_id,effort,exercise,muscle_group,bodyweight,set_no,kind,weight_kg,reps,rir,assisted,e1rm_kg,volume_kg,note'];
    const menu = [[['ベンチプレス', '胸', 72.5, 5], ['懸垂', '背中', 0, 8], ['ショルダープレス', '肩', 30, 8]], [['スクワット', '脚', 90, 5], ['ルーマニアンデッドリフト', '脚', 80, 8], ['プランク', '体幹', 0, 1]]];
    let n = 0;
    for (let i = -44; i <= 0; i++) {
      const k = addDays(t, i), w = 70.2 - i * 0.032 + (rnd() - .5) * .8;
      if (rnd() < .85) {
        const sl = Math.round(330 + rnd() * 140), deep = Math.round(sl * (.1 + rnd() * .12)), rem = Math.round(sl * (.16 + rnd() * .1)), aw = Math.round(5 + rnd() * 35);
        const bed = 23 * 60 + Math.round((rnd() - .4) * 90), wake = bed + sl + aw;
        if (i > -21) {   // 1晩の流れ：5つの周期（はじめは深いが多く、朝に近いほどレムが多い）
          const core = sl - deep - rem, wD = [.34, .28, .2, .12, .06], wR = [.08, .14, .2, .26, .32];
          let c = bed; const at = m => `${addDays(k, -1 + Math.floor(m / 1440))}T${hm2(m)}`;
          const seg = (len, st) => { len = Math.round(len); if (len > 0) { z.push([k, at(c), at(c + len), st].join(',')); c += len; } };
          for (let j = 0; j < 5; j++) { seg(core * .12, 'core'); seg(deep * wD[j], 'deep'); seg(core * .08, 'core'); seg(rem * wR[j], 'rem'); if (j === 1 || j === 3) seg(aw / 2, 'awake'); }
        }
        h.push([k, w.toFixed(1), (19.0 - i * 0.02 + (rnd() - .5)).toFixed(1), sl, Math.round(5000 + rnd() * 6000), Math.round(56 + rnd() * 6), Math.round(250 + rnd() * 250), deep, sl - deep - rem, rem, aw, hm2(bed), hm2(wake)].join(','));
      }
      const wd = parseKey(k).getDay();
      if (i < 0 && (wd === 1 || wd === 3 || wd === 5)) {
        const m = menu[n++ % 2], prog = (44 + i) / 44;
        m.forEach(([ex, g, kg0, reps]) => [1, 2, 3].forEach(no => {
          const wt = kg0 ? Math.round((kg0 + prog * 2.5) / 2.5) * 2.5 : 0, r = reps + (kg0 ? 0 : Math.round(prog * 3));
          const e1 = wt ? (wt * (1 + r / 30)).toFixed(1) : '';
          s.push([k, '19:00', 'demo' + n, '', ex, g, kg0 ? 0 : 70, no, 'normal', wt, r, '', 0, e1, wt * r, ''].join(','));
        }));
      }
    }
    return { 'Data/health/sleep.csv': z.join('\n') + '\n', 'Data/health/health.csv': h.join('\n') + '\n', 'Data/kintore/sets.csv': s.join('\n') + '\n' };
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
    // 家計のデータ（家計アプリのバックアップと同じ形。マネーフォワードから作る）
    await pool(DATA_FILES, 2, async f => {
      const t = mine.find(x => x.type === 'blob' && strip(x.path) === f);
      if (t) { try { cfgFiles[f] = (S.cfg?.[f + '#sha'] === t.sha && S.cfg[f]) || b64ToText((await gh(`${repoBase()}/git/blobs/${t.sha}`)).content); cfgFiles[f + '#sha'] = t.sha; } catch {} }
    });
    if (mine.some(t => strip(t.path) === '.obsidian')) isVault = true;
    S = { files: next, dailyJson: cfgFiles['daily-notes.json'] || null, cfg: cfgFiles, bins, dirs: [...new Set([...dirs, ...(S.dirs || []).filter(d => Bridge.virtualDir(d))])], isVault, syncedAt: Date.now(), error: null };
    if (tree.truncated) toast('ファイルが多すぎて、一部しか読めていません', 'warn');
  }
  const DATA_FILES = ['Data/kakei.json', 'Data/health/health.csv', 'Data/health/sleep.csv', 'Data/kintore/sets.csv'];
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
    await Bridge.settle(rel);   // 同じノートを送っている最中なら、終わってから
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
