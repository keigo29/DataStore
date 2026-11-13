// ※ このファイルは app/src/ をつなげて作ったもの（npm run build）。直すときは app/src/ のほうを直してください
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
        ...Object.fromEntries(Array.from({ length: 24 }, (_, j) => j + 1).filter(j => j % 5 !== 2).map(j => [`${d(-j).replace(/-/g, '/')}/気分.md`, f(`---\ntags: [日誌]\nexercise: ${j % 3 ? 1 : 0}\n読書: ${j % 4 === 1 ? 0 : 1}\n水: ${j % 7 === 3 ? 0 : 1}\n---\n## メモ\n- 気分 ${[4, 3, 5, 3, 2, 4, 4, 3][j % 8]}/5 ${['よく眠れた', '', '筋トレのあと すっきり', '', '寝不足', '散歩した', '', '仕事が多い'][j % 8]}\n`)])),
        'Notes/毎日確認.md': f(`---\ntags: [習慣]\n---\n# 毎日確認\n\nMD Workstation の「毎日確認」のタブで使う項目です。\n\n## 項目\n\n| 項目 | アイコン | 色 | 曜日 | プロパティ | 休みの日 | 始めた日 |\n|---|---|---|---|---|---|---|\n| 運動 | dumbbell | #00c230 | 毎日 | exercise | 休む | ${d(-40)} |\n| 読書 | book-open | #005cff | 毎日 | 読書 | 続ける | ${d(-40)} |\n| 水を2L | glass-water | #1fb8cc | 平日 | 水 | 休む | ${d(-40)} |\n\n## 休みの日\n\n- ${d(-9)} 有給\n`),
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
    // 送るのは1つのノートにつき1つずつ（重なると、古い版の印で送ってしまい「ほかで書きかえられた」になる）
    const queue = new Map(), busy = new Map(), lastSent = new Map();
    function enqueue(rel, fn) {
      busy.set(rel, (busy.get(rel) || 0) + 1);
      const run = (queue.get(rel) || Promise.resolve()).then(fn);
      const done = run.catch(() => {}).then(() => { const n = (busy.get(rel) || 1) - 1; if (n) busy.set(rel, n); else { busy.delete(rel); queue.delete(rel); } });
      queue.set(rel, done);
      return run;
    }
    // 送る：送っているあいだに書き足されていても、返ってきた最新の印（sha）を、いまのノートにつける
    async function sendNow(rel) {
      const f = S.files[rel];
      if (!f || !connected()) return;
      const text = f.text;
      if (lastSent.get(rel) === text + '\u0000' + f.sha) return;   // 同じ中身はもう一度送らない
      const sha = await putFile(rel, text, f.sha && f.sha !== 'demo' ? f.sha : null, `ノート: ${baseName(rel)}`);
      if (S.files[rel]) { S.files[rel].sha = sha; if (desk && S.files[rel].text === text) S.files[rel].mtime = parseInt(sha, 10) || S.files[rel].mtime; }
      lastSent.set(rel, text + '\u0000' + sha);
    }
    async function pushNow(rel) {
      try {
        await enqueue(rel, () => sendNow(rel));
        await persist();
      } catch (e) {
        console.error(e);
        toast(e.status === 409 || e.status === 422 ? `「${baseName(rel)}」はほかで書きかえられていました。同期してから書き直してください` : `「${baseName(rel)}」を送れませんでした`, 'warn');
      }
    }
    // 送り終わるまで待つ（待っているタイマーもすぐ送る）
    async function settle(rel) { await flush(rel); try { await queue.get(rel); } catch {} }
    // 書く（新しく作るときも）。now = すぐ送る
    async function putText(rel, text, now) {
      const old = S.files[rel];
      S.files[rel] = { sha: old ? old.sha : null, text, mtime: Date.now() };
      recompute();
      if (!connected()) { S.files[rel].sha = S.files[rel].sha || 'demo'; return; }
      if (desk) { await enqueue(rel, () => sendNow(rel)); return; }
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
      api, fileUrl, flushAll, settle,
      get settings() { return settings; },
      set onSettings(fn) { onSet = fn; },
      // 送るのを待っている・送っている最中のノートは、同期で上書きしない
      pending: rel => timers.has(rel) || busy.has(rel),
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
    if (it.type === 'todo' && it.money?.kind === 'out' && it.date) return planSheet(it);   // 出費の予定は直す画面へ
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
    { const hp = hbStrip(panel()); if (hp) put('right', hp); }
    {
      const pmd = panel();
      pmd.append(panelHead('smile', '今日の気分', btn('linkBtn', 'ひとこと', () => moodSheet())));
      put('right', moodWidget(pmd));
    }
    if (showPlanWidget()) {
      const pm = panel();
      pm.append(panelHead('wallet', '出費の予定', btn('linkBtn', '＋ 予定', () => planSheet(t))));
      put('right', planWidget(pm));
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

  // ================= 毎日確認（旧 Workstation の「毎日確認」と同じ画面） =================
  // 項目と休みの日：Notes/毎日確認.md（表と「## 休みの日」のリスト）
  // チェック：その日のデイリーノートの先頭のプロパティ（例 運動: 1）。外すと 0。TEDDY が書いても同じ
  const HB_FILE = 'Notes/毎日確認.md';
  const HB_COLORS = ['#005cff', '#00c230', '#ff5a00', '#8600ff', '#1fb8cc', '#f2280d', '#ffae00', '#717680'];
  // アイコンは Lucide（表の「アイコン」の列に名前を書く。例 dumbbell）
  const HB_ICONS = ['dumbbell', 'footprints', 'bike', 'activity', 'heart-pulse', 'droplet', 'glass-water', 'coffee', 'apple', 'salad', 'utensils', 'pill', 'book-open', 'notebook-pen', 'pen-line', 'languages', 'graduation-cap', 'code', 'laptop', 'brain', 'mountain', 'waves', 'wind', 'leaf', 'sprout', 'flower-2', 'sun', 'sunrise', 'moon', 'bed', 'alarm-clock', 'timer', 'shower-head', 'bath', 'sparkles', 'smile', 'heart', 'users', 'phone-off', 'smartphone', 'cigarette-off', 'wine-off', 'piggy-bank', 'wallet', 'music', 'guitar', 'palette', 'camera', 'gamepad-2', 'dog', 'cat', 'house', 'briefcase', 'clipboard-list', 'target', 'star', 'zap'];
  const HB_ORDER = [1, 2, 3, 4, 5, 6, 0];   // 月曜はじまり
  const HB_HEAT = 18;                        // カレンダーの週の数
  const OFF_KINDS = ['有給', '祝日', '夏休み', '冬休み', '代休', '休み'];
  const HB_HEAD = ['項目', 'アイコン', '色', '曜日', 'プロパティ', '休みの日', '始めた日'];
  let hbFocus = null, hbMonth = 0, hbWeek = 0;
  let hbCache = { v: -1, d: null };

  // ---------- 読む・書く ----------
  const hbDaysText = days => {
    const s = HB_ORDER.filter(d => days.includes(d));
    if (s.length === 7) return '毎日';
    if (s.join() === '1,2,3,4,5') return '平日';
    if (s.join() === '6,0') return '週末';
    return s.map(d => WD[d]).join('');
  };
  function hbDaysParse(s) {
    s = (s || '').trim();
    if (!s || /毎日/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
    if (/平日/.test(s)) return [1, 2, 3, 4, 5];
    if (/週末|土日/.test(s)) return [0, 6];
    const d = [...new Set([...s].map(c => WD.indexOf(c)).filter(i => i >= 0))];
    return d.length ? d : [0, 1, 2, 3, 4, 5, 6];
  }
  const cellsOf = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  function hbParse(text) {
    const habits = [], off = new Map();
    const L = (text || '').split(/\r?\n/);
    const hi = L.findIndex(l => /^\s*\|/.test(l) && cellsOf(l)[0] === '項目');
    if (hi >= 0) {
      const head = cellsOf(L[hi]), col = n => head.indexOf(n);
      for (let i = hi + 1; i < L.length && /^\s*\|/.test(L[i]); i++) {
        const c = cellsOf(L[i]);
        if (c.every(x => /^:?-+:?$/.test(x)) || !c[0]) continue;
        const g = n => (col(n) >= 0 ? c[col(n)] || '' : '');
        const name = c[0].replace(/\\\|/g, '|');
        const color = /^#[0-9a-f]{3,8}$/i.test(g('色')) ? g('色') : HB_COLORS[habits.length % HB_COLORS.length];
        habits.push({ name, icon: g('アイコン'), color, days: hbDaysParse(g('曜日')), prop: g('プロパティ') || name, keep: /続ける/.test(g('休みの日')), start: /^\d{4}-\d{2}-\d{2}$/.test(g('始めた日')) ? g('始めた日') : null });
      }
    }
    const oi = L.findIndex(l => /^#{1,6}\s+休みの日\s*$/.test(l));
    if (oi >= 0) for (let i = oi + 1; i < L.length && !/^#{1,6}\s/.test(L[i]); i++) {
      const m = L[i].match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:\s*[〜~～]\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/);
      if (!m) continue;
      const to = m[2] && m[2] >= m[1] ? m[2] : m[1];
      for (let k = m[1], n = 0; k <= to && n < 400; k = addDays(k, 1), n++) off.set(k, m[3].trim() || '休み');
    }
    return { habits, off };
  }
  // 続いている同じ種類の休みは1行にまとめる（例：2026-12-29〜2027-01-03 冬休み）
  function offRanges(off) {
    const out = [];
    for (const k of [...off.keys()].sort()) {
      const last = out[out.length - 1];
      if (last && off.get(k) === last.label && addDays(last.to, 1) === k) { last.to = k; last.days.push(k); }
      else out.push({ from: k, to: k, label: off.get(k), days: [k] });
    }
    return out;
  }
  function hbText(text, d) {
    const esc = s => String(s).replace(/\|/g, '\\|');
    const table = [`| ${HB_HEAD.join(' | ')} |`, `|${HB_HEAD.map(() => '---').join('|')}|`,
      ...d.habits.map(h => `| ${[esc(h.name), h.icon || '', h.color, hbDaysText(h.days), esc(h.prop), h.keep ? '続ける' : '休む', h.start || ''].join(' | ')} |`)];
    const offs = offRanges(d.off).map(r => `- ${r.from}${r.to !== r.from ? '〜' + r.to : ''} ${r.label}`);
    if (!text) text = `---\ntags: [習慣]\n---\n# 毎日確認\n\nMD Workstation の「毎日確認」のタブで使う項目です。チェックは、その日のデイリーノートの先頭のプロパティ（例 \`運動: 1\`）に入ります。外すと 0 です。\n\n## 項目\n\n## 休みの日\n`;
    let L = text.split('\n');
    const hi = L.findIndex(l => /^\s*\|/.test(l) && cellsOf(l)[0] === '項目');
    if (hi >= 0) { let e = hi; while (e + 1 < L.length && /^\s*\|/.test(L[e + 1])) e++; L.splice(hi, e - hi + 1, ...table); }
    else {
      let h = L.findIndex(l => /^#{1,6}\s+項目\s*$/.test(l));
      if (h < 0) { L.push('', '## 項目'); h = L.length - 1; }
      L.splice(h + 1, 0, '', ...table);
    }
    let oi = L.findIndex(l => /^#{1,6}\s+休みの日\s*$/.test(l));
    if (oi < 0) { while (L.length && !L[L.length - 1].trim()) L.pop(); L.push('', '## 休みの日'); oi = L.length - 1; }
    let e = oi + 1; while (e < L.length && !/^#{1,6}\s/.test(L[e])) e++;
    L.splice(oi + 1, e - oi - 1, '', ...offs, ...(e < L.length ? [''] : []));
    return L.join('\n').replace(/\n*$/, '\n');
  }
  const hbWrite = (fn, msg) => edit(HB_FILE, t => { const d = hbParse(t || ''); if (fn(d) === false) return null; return hbText(t || '', d); }, msg);

  const HB_YES = /^(1|true|yes|y|x|✓|✔|o|◯|○|はい|済|できた|done)$/i;
  function hbData() {
    if (hbCache.v === filesVersion) return hbCache.d;
    const d = hbParse(S.files[HB_FILE]?.text || '');
    const byProp = new Map();
    for (const h of d.habits) { h.done = new Set(); byProp.set(h.prop, h); }
    if (d.habits.length) for (const [p, f] of Object.entries(S.files)) {
      if (!f.text.startsWith('---')) continue;
      const fm = p.match(/^(\d{4})\/(\d{2})\/(\d{2})\//), day = Daily.dateOf(p, dailyCfg) || (fm ? `${fm[1]}-${fm[2]}-${fm[3]}` : null);
      if (!day) continue;
      const { props } = splitFrontmatter(f.text);
      for (const x of props || []) { const h = byProp.get(x.k); if (h && HB_YES.test((x.v[0] || '').trim())) h.done.add(day); }
    }
    hbCache = { v: filesVersion, d };
    return d;
  }

  // ---------- 集計 ----------
  const hbIsOff = k => hbData().off.has(k);
  const hbDow = k => parseKey(k).getDay();
  const hbSched = (h, k) => h.days.includes(hbDow(k)) && (h.keep || !hbIsOff(k));
  const hbRest = (h, k) => h.days.includes(hbDow(k)) && !h.keep && hbIsOff(k);
  function hbStart(h) { let s = h.start || todayKey(); for (const k of h.done) if (k < s) s = k; return s; }
  function hbStreak(h) {   // 予定のない日（休み）は飛ばす。今日がまだでも切れない
    const tk = todayKey(), st = hbStart(h);
    let n = 0;
    for (let k = tk, i = 0; k >= st && i < 3000; k = addDays(k, -1), i++) {
      if (h.done.has(k)) { n++; continue; }
      if (!hbSched(h, k) || i === 0) continue;
      break;
    }
    return n;
  }
  function hbBest(h) {
    const tk = todayKey(); let best = 0, cur = 0;
    for (let k = hbStart(h), i = 0; k <= tk && i < 3000; k = addDays(k, 1), i++) {
      if (h.done.has(k)) best = Math.max(best, ++cur);
      else if (hbSched(h, k) && k !== tk) cur = 0;
    }
    return best;
  }
  function hbRate30(h) {
    const tk = todayKey(); let from = addDays(tk, -29); const st = hbStart(h); if (st > from) from = st;
    const to = h.done.has(tk) ? tk : addDays(tk, -1);
    let s = 0, dn = 0;
    for (let k = from; k <= to; k = addDays(k, 1)) if (hbSched(h, k)) { s++; if (h.done.has(k)) dn++; }
    return s ? Math.round((dn / s) * 100) : null;
  }
  const hbYm = o => { const t = parseKey(todayKey()); const d = new Date(t.getFullYear(), t.getMonth() + o, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  function hbDay(hs, k, tk) {
    let target = 0, done = 0, extra = 0;
    for (const h of hs) {
      if (k < hbStart(h)) continue;
      const dn = h.done.has(k);
      if (hbSched(h, k)) { if (dn) { target++; done++; } else if (k !== tk) target++; }
      else if (dn) extra++;
    }
    return { target, done, extra };
  }
  function hbMonthStat(hs, ym) {
    const tk = todayKey();
    let target = 0, done = 0, total = 0, perfect = 0, offDays = 0;
    const days = [];
    for (let i = 1; i <= daysIn(ym); i++) {
      const k = `${ym}-${String(i).padStart(2, '0')}`;
      if (hbIsOff(k) && k <= tk) offDays++;
      if (k > tk) { days.push(null); continue; }
      const s = hbDay(hs, k, tk);
      days.push(s);
      target += s.target; done += s.done; total += s.done + s.extra;
      if (s.target > 0 && s.done === s.target) perfect++;
    }
    return { target, done, total, perfect, offDays, days, rate: target ? Math.round((done / target) * 100) : null };
  }
  function hbToday() {
    const d = hbData(), tk = todayKey();
    const list = d.habits.filter(h => hbSched(h, tk) || h.done.has(tk));
    return { list, done: list.filter(h => h.done.has(tk)).length, total: list.length, off: d.off.get(tk) ?? null };
  }

  // ---------- 操作 ----------
  async function hbToggle(h, k) {
    if (k > todayKey()) return;
    const on = !h.done.has(k);
    const ok = await edit(dailyPathOf(k), t => setProp(t == null ? newDailyText(k) : t, h.prop, on ? 1 : 0), `毎日確認: ${h.name}${on ? ' できた' : ' を外す'}（${k}）`);
    if (ok && on && k === todayKey()) { const s = hbToday(); if (s.total && s.done === s.total) toast('今日は全部できました！'); }
  }
  const hbToggleOff = k => hbWrite(d => { if (d.off.has(k)) d.off.delete(k); else d.off.set(k, '休み'); }, `毎日確認：休みの日 ${k}`);

  // ---------- 部品 ----------
  function hbIcon(h, cls = 'hb-icon') {
    const i = el('span', cls);
    const n = (h.icon || '').replace(/^lucide:/, '');
    if (window.ICONS[n]) i.innerHTML = icon(n); else i.textContent = h.icon || h.name.trim()[0] || '•';   // 名前が Lucide にないときは、その文字のまま
    i.style.setProperty('--c', h.color);
    return i;
  }
  const tbtn = (...a) => { const b = btn(...a); if (a[3]) b.title = a[3]; return b; };   // 乗せると説明が出るボタン
  const withIc = (tag, cls, ic, text) => { const e = el(tag, cls); e.innerHTML = icon(ic); e.append(text); return e; };
  function hbVChart(cols, { color, labels }) {
    const wrap = el('div', 'hb-vchart');
    const y = el('div', 'yaxis'), plot = el('div', 'plot');
    plot.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
    for (const p of [0, 50, 100]) { const s = el('span', '', p + '%'); s.style.bottom = p + '%'; y.append(s); if (p) { const g = el('div', 'gl'); g.style.bottom = p + '%'; plot.append(g); } }
    for (const c of cols) {
      const col = el('button', 'hcol' + (c.dim ? ' dim' : '') + (c.rest ? ' rest' : '')); col.type = 'button';
      if (c.onClick) col.addEventListener('click', c.onClick); else col.tabIndex = -1;
      col.title = c.tip; col.style.setProperty('--c', c.color || color);
      if (c.value != null) {
        const bar = el('span', 'hbar' + (c.value === 0 ? ' zero' : '')); bar.style.height = c.value + '%'; col.append(bar);
        if (c.label) { const v = el('span', 'vlabel', c.label); v.style.bottom = c.value + '%'; col.append(v); }
      } else if (c.rest) col.append(el('span', 'restMark', '休'));
      plot.append(col);
    }
    const x = el('div', 'xaxis'); x.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
    labels.forEach(l => x.append(el('span', l.now ? 'now' : '', l.text)));
    wrap.append(y, plot, x);
    return wrap;
  }

  // 今日：リング＋項目の一覧（サイドバー・スマホの上）
  function hbTodayPanel() {
    const d = hbData(), tk = todayKey(), s = hbToday();
    const p = el('section', 'hb-panel hb-today');
    const top = el('div', 'hb-todayTop' + (s.total && s.done === s.total ? ' all' : ''));
    const C = 2 * Math.PI * 27, ring = el('div', 'hb-ring');
    ring.innerHTML = `<svg viewBox="0 0 64 64"><circle class="bgc" cx="32" cy="32" r="27"/><circle class="fgc" cx="32" cy="32" r="27" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - (s.total ? s.done / s.total : 0))}"/></svg>`;
    ring.append(el('b', '', s.total ? `${s.done}/${s.total}` : '—'));
    const tx = el('div', 'hb-todayText');
    tx.append(el('div', 'date', md(tk)),
      s.off != null ? withIc('div', 'msg', 'tree-palm', `今日は${s.off}。「休みの日も続ける」項目だけが予定です`)
        : !s.total ? el('div', 'msg', d.habits.length ? '今日の予定はなし' : '項目を足して始めます')
        : s.done === s.total ? withIc('div', 'msg', 'party-popper', '今日は全部達成！')
        : el('div', 'msg', `あと ${s.total - s.done} つ`));
    top.append(ring, tx);
    p.append(top);
    const ob = tbtn('btn white hb-offBtn', [s.off != null ? 'undo-2' : 'tree-palm', s.off != null ? '休みを取り消す' : '今日を休みにする'], () => hbToggleOff(tk), '休みの日は予定から外れます（達成率や連続日数が下がりません）');
    p.append(ob);
    const list = el('div', 'hb-list');
    if (d.habits.length) {
      const all = el('div', 'hb-row allRow' + (!hbFocus ? ' focused' : ''));
      const an = btn('hb-name', [], () => { hbFocus = null; render(); });
      const ai = el('span', 'hb-icon'); ai.innerHTML = icon('chart-column');
      const at = el('span', 'txt'); at.append(el('span', 'nm', 'すべての項目'), el('small', '', `${d.habits.length}件`));
      an.append(ai, at); all.append(an); list.append(all);
    }
    for (const h of d.habits) {
      const row = el('div', 'hb-row' + (hbFocus === h.name ? ' focused' : ''));
      const done = h.done.has(tk), sc = hbSched(h, tk), rest = hbRest(h, tk);
      const chk = tbtn('hb-chk' + (done ? ' done' : '') + (sc ? '' : ' off'), done ? 'check' : null, () => hbToggle(h, tk),
        done ? '今日のチェックを外す' : sc ? '今日できた！' : rest ? '今日は休み（押すとできたことになる）' : '今日は予定なし（押すとできたことになる）');
      chk.style.setProperty('--c', h.color);
      const nm = btn('hb-name', [], () => { hbFocus = hbFocus === h.name ? null : h.name; render(); }, 'グラフをこの項目に絞り込む');
      const sk = hbStreak(h);
      const t2 = el('span', 'txt');
      t2.append(el('span', 'nm', h.name), sk > 0 ? withIc('small', 'hot', 'flame', `${sk}日連続`) : el('small', '', rest ? '今日は休み' : sc ? '今日の予定' : '今日は予定なし'));
      nm.append(hbIcon(h), t2);
      row.append(chk, nm, btn('hb-edit', 'pencil', () => hbSheet(h), '編集'));
      list.append(row);
    }
    list.append(btn('hb-add', ['plus', '確認項目を追加'], () => hbSheet(null)));
    p.append(list);
    return p;
  }

  function renderHabits(main) {
    const d = hbData();
    const box = el('div', 'hb-view');
    if (!isWide()) box.append(hbTodayPanel());
    if (!d.habits.length) {
      const e = el('div', 'hb-panel hb-empty');
      e.innerHTML = icon('calendar-check');
      e.append(el('b', '', '毎日確認の項目はまだありません'), el('p', '', '「確認項目を追加」から始めます。項目は Notes/毎日確認.md の表に、チェックはその日のデイリーノートのプロパティ（例 運動: 1）に入ります。'));
      e.append(btn('btn primary', ['plus', '確認項目を追加'], () => hbSheet(null)));
      box.append(e); main.append(box); return;
    }
    const f = d.habits.find(h => h.name === hbFocus) || null;
    if (!f) hbFocus = null;
    const hs = f ? [f] : d.habits, ym = hbYm(hbMonth), st = hbMonthStat(hs, ym);
    // 月の切りかえ
    const bar = el('div', 'hb-monthBar');
    const nx = btn('btn white hb-sq', 'chevron-right', () => { if (hbMonth < 0) { hbMonth++; render(); } }, '次の月'); nx.disabled = hbMonth >= 0;
    bar.append(btn('btn white hb-sq', 'chevron-left', () => { hbMonth--; render(); }, '前の月'), el('b', 'hb-month', `${ym.slice(0, 4)}年${+ym.slice(5)}月`), nx);
    if (hbMonth) bar.append(btn('btn white', [], () => { hbMonth = 0; render(); }, '今月に戻る')), bar.lastChild.textContent = '今月に戻る';
    const chip = el('div', 'hb-focusChip' + (f ? '' : ' solo'));
    if (f) { const lab = el('span'); lab.style.setProperty('--c', f.color); lab.append(hbIcon(f, 'hb-miniIcon'), f.name); chip.append(lab, btn('', 'x', () => { hbFocus = null; render(); }, '絞り込みを解除')); }
    else chip.append(withIc('span', '', 'chart-column', 'すべての項目'));
    bar.append(chip, btn('btn white', ['tree-palm', '休みの日'], () => offSheet(), '休みの日を登録する'));
    box.append(bar);
    // 数字
    const prev = hbMonthStat(hs, hbYm(hbMonth - 1)), diff = st.rate != null && prev.rate != null ? st.rate - prev.rate : null;
    const ks = el('div', 'hb-kpis');
    for (const [ic, label, value, note] of [
      ['target', '達成率', st.rate == null ? '—' : st.rate + '%', diff == null ? el('div', 'note', `${st.done} / ${st.target} 回`) : withIc('div', 'note', diff > 0 ? 'trending-up' : diff < 0 ? 'trending-down' : 'minus', `先月比 ${diff > 0 ? '+' : ''}${diff}pt`)],
      ['repeat', '達成回数', st.total + '回', el('div', 'note', `予定 ${st.target} 回`)],
      ['trophy', f ? 'できた日' : '全部できた日', st.perfect + '日', el('div', 'note', '予定がすべて達成できた日')],
      ['tree-palm', '休みの日', st.offDays + '日', el('div', 'note', '予定から外して計算')],
    ]) { const t = el('div', 'hb-kpi'); t.append(withIc('div', 'label', ic, label), el('div', 'value', value), note); ks.append(t); }
    box.append(ks);
    // 日ごとの達成率
    const color = f ? f.color : 'var(--accent)', tk = todayKey();
    const dp = el('section', 'hb-panel'); dp.append(withIc('h3', '', 'chart-column', '日ごとの達成率'));
    const cols = st.days.map((s, i) => {
      const k = `${ym}-${String(i + 1).padStart(2, '0')}`, head = `${+ym.slice(5)}/${i + 1}(${WD[hbDow(k)]})`, ol = hbIsOff(k) ? `\n${d.off.get(k)}（予定から外しています）` : '';
      if (!s) return { value: null, rest: hbIsOff(k), tip: `${head}\nまだ先の日${ol}` };
      if (!s.target) return { value: null, rest: hbIsOff(k), tip: `${head}${ol || '\n予定なし'}${s.extra ? `\n予定外に${s.extra}回できた` : ''}` };
      const v = Math.round((s.done / s.target) * 100);
      return { value: v, rest: hbIsOff(k), tip: `${head}\n${s.done} / ${s.target} できた（${v}%）${s.extra ? `\n＋予定外 ${s.extra}回` : ''}${ol}` };
    });
    const labels = st.days.map((_, i) => { const day = i + 1, now = `${ym}-${String(day).padStart(2, '0')}` === tk; return { text: day === 1 || day % 5 === 0 || now ? String(day) : '', now }; });
    dp.append(st.target || st.total || st.offDays ? hbVChart(cols, { color, labels }) : el('p', 'hb-noData', 'この月の記録はまだありません。'));
    box.append(dp);
    // 項目ごと（絞り込み中は連続記録）＋月ごとの推移
    const cs = el('div', 'hb-cols');
    const lp = el('section', 'hb-panel');
    if (f) { lp.append(withIc('h3', '', 'flame', '連続記録とカレンダー')); hbStreakCard(f, lp); }
    else {
      lp.append(withIc('h3', '', 'chart-bar', '項目ごとの達成率'));
      const hc = el('div', 'hb-hchart');
      for (const h of d.habits) {
        const s = hbMonthStat([h], ym);
        const lb = btn('hl', [], () => { hbFocus = h.name; render(); }, 'この項目に絞り込む'); lb.append(hbIcon(h), el('span', '', h.name));
        const tr = el('div', 'track'), fill = el('span'); fill.style.width = (s.rate || 0) + '%'; fill.style.setProperty('--c', h.color); tr.append(fill);
        tr.title = `${h.name}\n${s.done} / ${s.target} 回できた${s.rate == null ? '' : `（${s.rate}%）`}`;
        const v = el('div', 'hv', s.rate == null ? '—' : s.rate + '%'); v.append(el('small', '', `${s.done}/${s.target}`));
        hc.append(lb, tr, v);
      }
      lp.append(hc);
    }
    const tp = el('section', 'hb-panel');
    const h3 = withIc('h3', '', 'calendar-range', '月ごとの推移'); h3.append(el('span', 'right', '棒を押すとその月へ')); tp.append(h3);
    const end = hbMonth < -11 ? hbMonth : 0, tc = [], tl = [];
    for (let o = end - 11; o <= end; o++) {
      const m2 = hbYm(o), s = hbMonthStat(hs, m2), sel = o === hbMonth;
      tc.push({ value: s.rate, dim: !sel, label: sel && s.rate != null ? s.rate + '%' : '', tip: `${m2.slice(0, 4)}年${+m2.slice(5)}月\n${s.rate == null ? '記録なし' : `達成率 ${s.rate}%（${s.done} / ${s.target} 回）`}${s.offDays ? `\n休み ${s.offDays}日` : ''}`, onClick: () => { hbMonth = o; render(); } });
      tl.push({ text: `${+m2.slice(5)}月`, now: sel });
    }
    tp.append(hbVChart(tc, { color, labels: tl }));
    cs.append(lp, tp);
    box.append(cs, hbWeekPanel());
    if (!f) {
      const g = el('div', 'hb-streaks');
      for (const h of d.habits) { const c = el('section', 'hb-panel'); const hd = el('div', 'hb-statHead'); hd.append(hbIcon(h), el('span', '', h.name)); c.append(hd); hbStreakCard(h, c); g.append(c); }
      box.append(g);
    }
    main.append(box);
  }

  // 週のチェック表（日付を押すとその日を休みに切りかえ）
  function hbWeekPanel() {
    const d = hbData(), tk = todayKey();
    const mon = addDays(addDays(tk, -((hbDow(tk) + 6) % 7)), hbWeek * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    const p = el('section', 'hb-panel');
    const h3 = withIc('h3', '', 'list-checks', '週のチェック表');
    const nav = el('span', 'right hb-weekNav');
    const nx = btn('btn white hb-sq', 'chevron-right', () => { if (hbWeek < 0) { hbWeek++; render(); } }, '次の週'); nx.disabled = hbWeek >= 0;
    nav.append(btn('btn white hb-sq', 'chevron-left', () => { hbWeek--; render(); }, '前の週'), el('span', 'lbl', `${sd(days[0])}〜${sd(days[6])}`), nx);
    if (hbWeek) { const b = btn('btn white', [], () => { hbWeek = 0; render(); }); b.textContent = '今週'; nav.append(b); }
    h3.append(nav); p.append(h3);
    const wrap = el('div', 'hb-gridWrap'), grid = el('div', 'hb-grid');
    grid.append(el('div', 'gh'));
    for (const k of days) {
      const o = d.off.has(k), w = hbDow(k);
      const g = tbtn('gh' + (k === tk ? ' is-today' : '') + (w === 6 ? ' sat' : w === 0 ? ' sun' : '') + (o ? ' rest' : ''), [], () => hbToggleOff(k),
        o ? `${md(k)} は${d.off.get(k)}。押すと休みを取り消します` : `${md(k)}。押すとこの日を休みにします`);
      g.append(el('span', 'wd', WD[w]), el('span', 'md', sd(k)));
      if (o) g.append(el('span', 'restTag', d.off.get(k)));
      grid.append(g);
    }
    grid.append(el('div', 'gh', '週'));
    for (const h of d.habits) {
      const nm = el('div', 'hname' + (hbFocus === h.name ? ' focused' : '')); nm.append(hbIcon(h), el('span', 'nm', h.name)); grid.append(nm);
      let sch = 0, dn = 0;
      for (const k of days) {
        const done = h.done.has(k), sc = hbSched(h, k), fut = k > tk, rest = hbRest(h, k);
        if (sc) sch++; if (done) dn++;
        const c = tbtn('cell' + (done ? ' done' : '') + (sc ? '' : ' off') + (rest ? ' rest' : ''), done ? 'check' : null, () => hbToggle(h, k),
          `${md(k)}\n${fut ? 'まだ先の日' : done ? 'できた' : sc ? 'まだ' : rest ? `${d.off.get(k)}のため予定なし` : '予定なし'}`);
        c.style.setProperty('--c', h.color); c.disabled = fut;
        grid.append(c);
      }
      const r = el('div', 'wrate' + (sch && dn >= sch ? ' full' : ''), `${dn}/${sch}`); r.title = 'この週のできた数 / 予定の数'; grid.append(r);
    }
    wrap.append(grid); p.append(wrap);
    const lg = el('div', 'hb-legend');
    lg.innerHTML = '<span><i class="d"></i>できた</span><span><i></i>まだ</span><span><i class="o"></i>予定のない曜日（押すとできたことになる）</span><span><i class="r"></i>休み（日付を押して切りかえ）</span>';
    p.append(lg);
    return p;
  }
  function hbStreakCard(h, parent) {
    const r = hbRate30(h);
    const nums = el('div', 'hb-nums');
    for (const [v, l] of [[hbStreak(h) + '日', '現在の連続'], [hbBest(h) + '日', '最長の連続'], [r == null ? '—' : r + '%', '直近30日']]) { const n = el('div', 'hnum'); n.append(el('b', '', v), el('span', '', l)); nums.append(n); }
    parent.append(nums);
    const tk = todayKey(), first = addDays(addDays(tk, -((hbDow(tk) + 6) % 7)), -(HB_HEAT - 1) * 7);
    const heat = el('div', 'hb-heat'); heat.style.setProperty('--c', h.color);
    for (let i = 0; i < HB_HEAT * 7; i++) {
      const k = addDays(first, i), fut = k > tk, done = h.done.has(k), sc = hbSched(h, k), rest = hbRest(h, k);
      const b = el('button', fut ? 'fut' : done ? 'on' : rest ? 'rest' : sc ? '' : 'off'); b.type = 'button'; b.tabIndex = -1;
      if (!fut) b.addEventListener('click', () => hbToggle(h, k));
      if (k === tk) b.classList.add('today');
      b.title = `${k.replace(/-/g, '/')}(${WD[hbDow(k)]})\n${done ? 'できた' : sc ? 'まだ' : rest ? hbData().off.get(k) : '予定なし'}`;
      heat.append(b);
    }
    parent.append(heat);
    const lab = el('div', 'hb-heatLabel'); lab.append(el('span', '', first.replace(/-/g, '/')), el('span', '', '今日')); parent.append(lab);
  }

  // ---------- 追加・編集 ----------
  function hbSheet(h) {
    const d = hbData();
    const inn = $('#sheetIn');
    sheetHead(inn, h ? '確認項目を編集' : '確認項目を追加');
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const name = el('input', 'inp'); name.placeholder = '例：運動・読書・水を2L'; name.maxLength = 40; name.value = h?.name || '';
    let ic = h ? h.icon.replace(/^lucide:/, '') : HB_ICONS[d.habits.length % HB_ICONS.length], color = h ? h.color : HB_COLORS[d.habits.length % HB_COLORS.length];
    let days = h ? [...h.days] : [0, 1, 2, 3, 4, 5, 6];
    const icBox = el('div', 'hb-iconPick');
    const drawIc = () => { icBox.style.setProperty('--c', color); icBox.replaceChildren(...HB_ICONS.map(n => { const b = btn(n === ic ? 'on' : '', [n], () => { ic = n; drawIc(); }, n); b.title = n; return b; })); };
    drawIc();
    const sw = el('div', 'swatches');
    const drawSw = () => sw.replaceChildren(...HB_COLORS.map(c => { const b = btn('sw' + (c === color ? ' on' : ''), [], () => { color = c; drawSw(); drawIc(); }, c); b.style.background = c; return b; }));
    drawSw();
    const dw = el('div', 'hb-daysPick');
    const drawDays = () => {
      dw.replaceChildren();
      const pre = el('div', 'hb-presets');
      [['毎日', [0, 1, 2, 3, 4, 5, 6]], ['平日', [1, 2, 3, 4, 5]], ['週末', [0, 6]]].forEach(([l, v]) => { const b = btn(hbDaysText(days) === l ? 'on' : '', [], () => { days = v; drawDays(); }); b.textContent = l; pre.append(b); });
      const wk = el('div', 'hb-wds');
      HB_ORDER.forEach(n => { const b = btn(days.includes(n) ? 'on' : '', [], () => { days = days.includes(n) ? days.filter(x => x !== n) : [...days, n]; if (!days.length) days = [n]; drawDays(); }); b.textContent = WD[n]; wk.append(b); });
      dw.append(pre, wk);
    };
    drawDays();
    const keep = el('input'); keep.type = 'checkbox'; keep.checked = !!h?.keep;
    const kl = el('label', 'hb-keep'); kl.append(keep, '休みの日も続ける（休みでも予定に残す）');
    const prop = el('input', 'inp'); prop.placeholder = '例：exercise（空なら名前と同じ）'; prop.value = h ? h.prop : ''; prop.setAttribute('list', 'hbPropList');
    const dl = el('datalist'); dl.id = 'hbPropList';
    const keys = new Set();
    for (const [p, f] of Object.entries(S.files)) if (Daily.dateOf(p, dailyCfg) && f.text.startsWith('---')) (splitFrontmatter(f.text).props || []).forEach(x => { if (!/^(tags?|aliases|date|project|cssclass)$/i.test(x.k)) keys.add(x.k); });
    [...keys].sort().forEach(k => { const o = el('option'); o.value = k; dl.append(o); });
    inn.append(fld('名前', name));
    const icf = el('div', 'fld'); icf.append(el('span', '', 'アイコン'), icBox); inn.append(icf);
    const cf = el('div', 'fld'); cf.append(el('span', '', '色'), sw); inn.append(cf);
    const df = el('div', 'fld'); df.append(el('span', '', '実施する曜日'), dw); inn.append(df, kl);
    inn.append(fld('今日のノートのプロパティ', prop), dl, el('div', 'hint sub', 'チェックすると、その日のデイリーノートの先頭に「プロパティ: 1」と書きます（外すと 0）。ノートや TEDDY で 1 にしても、チェックが付きます'));
    const bs = el('div', 'shBtns');
    if (h) {
      const i = d.habits.findIndex(x => x.name === h.name);
      if (d.habits.length > 1) {
        const mv = dir => { sheet.close(); hbWrite(dd => { const a = dd.habits.findIndex(x => x.name === h.name), b = a + dir; if (a < 0 || b < 0 || b >= dd.habits.length) return false; [dd.habits[a], dd.habits[b]] = [dd.habits[b], dd.habits[a]]; }, `毎日確認：並び順 ${h.name}`); };
        const up = btn('btn white', ['arrow-up', '上へ'], () => mv(-1)); up.disabled = i === 0;
        const dn = btn('btn white', ['arrow-down', '下へ'], () => mv(1)); dn.disabled = i === d.habits.length - 1;
        bs.append(up, dn);
      }
      let armed = false;
      const del = btn('btn danger', ['trash-2', '削除'], () => {
        if (!armed) { armed = true; del.lastChild.textContent = 'もう一度押すと削除'; return; }
        sheet.close(); if (hbFocus === h.name) hbFocus = null;
        hbWrite(dd => { dd.habits = dd.habits.filter(x => x.name !== h.name); }, `毎日確認：${h.name} を削除`);
        toast(`「${h.name}」を削除しました（ノートのチェックの記録は残っています）`);
      });
      bs.append(del);
    }
    const save = () => {
      const nm = name.value.replace(/\s+/g, ' ').trim();
      if (!nm) { name.focus(); return; }
      if (d.habits.some(x => x.name === nm && x !== h && x.name !== h?.name)) { toast('同じ名前の項目があります', 'warn'); name.focus(); return; }
      const pr = (prop.value.trim() || nm).replace(/[:#\s]/g, '_');
      sheet.close();
      hbWrite(dd => {
        const v = { name: nm, icon: ic || '', color, days: days.slice().sort(), prop: pr, keep: keep.checked };
        if (h) { const x = dd.habits.find(y => y.name === h.name); if (!x) return false; Object.assign(x, v); }
        else dd.habits.push({ ...v, start: todayKey() });
      }, `毎日確認：${h ? '編集' : '追加'} ${nm}`);
      if (hbFocus === h?.name) hbFocus = nm;
    };
    bs.append(btn('btn primary', ['check', h ? '保存' : '追加'], save));
    name.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) save(); });
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => name.focus(), 50);
  }

  // ---------- 休みの日 ----------
  function offSheet() {
    const inn = $('#sheetIn');
    sheetHead(inn, '休みの日');
    const tk = todayKey();
    const from = el('input', 'inp'); from.type = 'date'; from.value = tk;
    const to = el('input', 'inp'); to.type = 'date'; to.value = tk;
    const q = el('div', 'hb-presets');
    [['今日', 0], ['昨日', -1], ['明日', 1]].forEach(([l, n]) => { const b = btn('', [], () => { from.value = to.value = addDays(tk, n); }); b.textContent = l; q.append(b); });
    const lab = el('input', 'inp'); lab.value = '有給'; lab.placeholder = '種類';
    const kinds = el('div', 'hb-presets');
    const mark = () => kinds.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === lab.value));
    OFF_KINDS.forEach(k => { const b = btn('', [], () => { lab.value = k; mark(); }); b.textContent = k; kinds.append(b); });
    lab.addEventListener('input', mark); mark();
    const row = el('div', 'hb-offDates'); row.append(from, el('span', '', '〜'), to);
    const f1 = el('div', 'fld'); f1.append(el('span', '', '日にち'), q, row);
    const f2 = el('div', 'fld'); f2.append(el('span', '', '種類'), kinds, lab);
    inn.append(f1, f2, el('div', 'hint sub', '登録した日は、毎日確認の予定から外れます。達成率や連続日数が下がりません（Notes/毎日確認.md の「休みの日」に書きます）'));
    const list = el('div', 'hb-offList');
    const draw = () => {
      list.replaceChildren(el('p', 'hLbl', '登録済み'));
      const rs = offRanges(hbData().off).reverse();
      if (!rs.length) list.append(el('p', 'hb-noData', 'まだ登録はありません。'));
      for (const r of rs) {
        const rw = el('div', 'hb-offRow');
        rw.append(withIc('span', 'when', 'calendar-days', r.from === r.to ? md(r.from) : `${md(r.from)} 〜 ${md(r.to)}（${r.days.length}日）`), el('span', 'lab', r.label),
          btn('iconBtn', 'x', async () => { await hbWrite(dd => { r.days.forEach(k => dd.off.delete(k)); }, `毎日確認：休みを取り消す ${r.from}`); draw(); }, '取り消す'));
        list.append(rw);
      }
    };
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['plus', '休みとして登録'], async () => {
      const a = from.value, b = to.value && to.value >= from.value ? to.value : from.value;
      if (!a) { from.focus(); return; }
      const l = lab.value.replace(/\s+/g, '').trim() || '休み';
      await hbWrite(dd => { for (let k = a, n = 0; k <= b && n < 400; k = addDays(k, 1), n++) dd.off.set(k, l); }, `毎日確認：休みの日 ${a}${b !== a ? '〜' + b : ''}`);
      draw();
    }));
    inn.append(bs, list);
    draw();
    sheet.showModal();
  }

  // ---------- ホームの「今日の毎日確認」 ----------
  function hbStrip(box) {
    const d = hbData();
    if (!d.habits.length) return null;
    const tk = todayKey(), s = hbToday();
    box.classList.add('hb-strip');
    const head = btn('hb-stripHead', ['calendar-check'], () => switchTab('habits'), '毎日確認を開く');
    head.append(el('span', '', '今日の毎日確認'), el('b', s.total && s.done === s.total ? 'all' : '', s.total ? `${s.done}/${s.total}` : '—'));
    box.append(head);
    if (s.off != null) box.append(withIc('span', 'hb-pill rest', 'tree-palm', `今日は${s.off}`));
    for (const h of s.list) {
      const done = h.done.has(tk);
      const p = btn('hb-pill' + (done ? ' done' : ''), [], () => hbToggle(h, tk), done ? 'チェックを外す' : 'できた！');
      p.style.setProperty('--c', h.color);
      const c = el('span', 'hb-chk' + (done ? ' done' : '')); if (done) c.innerHTML = icon('check');
      const nm = el('span', 'nm'); nm.append(hbIcon(h, 'hb-miniIcon'), h.name);
      p.append(c, nm);
      box.append(p);
    }
    if (!s.list.length && s.off == null) box.append(el('span', 'hb-none', '今日の予定はありません'));
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
    const ek = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const i = ls.findIndex(l => new RegExp(`^${ek}\\s*:`, 'i').test(l));
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

  // ================= お金（finance） =================
  // 書き方：- 💸 1,200 ランチ #食費（出費）／- 💰 250,000 給料（収入）／- 🏦 30,000 [[引越し資金]]（貯金目標へ）
  // 貯金目標：ノートの先頭に type: 目標・target: 500000・due: 2027-03-31（Finance/引越し資金.md など）
  let moneyMonth = null;        // 'YYYY-MM'
  let moneyCat = null;
  let moneyDay = null;          // カレンダーで選んだ日          // 記録の一覧をカテゴリでしぼる
  const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const ymOf = k => k.slice(0, 7);
  const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  // 家計アプリと同じカテゴリ（名前・色）
  const KAKEI_CATS = { food: ['食費', '#f76b15'], daily: ['日用品', '#12a594'], transport: ['交通', '#0090ff'], housing: ['住まい', '#6e56cf'], utility: ['水道光熱', '#e2a336'], phone: ['通信', '#05a2c2'],
    hobby: ['趣味', '#8e4ec6'], social: ['交際', '#d6409f'], clothes: ['衣服', '#e54666'], beauty: ['美容', '#ab4aba'], medical: ['医療', '#e5484d'], study: ['教育', '#30a46c'],
    subscription: ['サブスク', '#3e63dd'], cafe: ['カフェ', '#a07553'], 'other-ex': ['その他', '#8b8b93'], salary: ['給与', '#30a46c'], side: ['副業', '#12a594'], bonus: ['臨時収入', '#d6409f'], 'other-in': ['その他', '#8b8b93'] };
  const ACCT_TYPES = { cash: '現金', bank: '銀行', card: 'クレジットカード', emoney: '電子マネー' };
  let kakeiCache = { text: null, v: null };
  function kakei() {
    const t = S.cfg?.['Data/kakei.json'];
    if (!t) return null;
    if (kakeiCache.text === t) return kakeiCache.v;
    let v = null;
    try {
      const d = JSON.parse(t);
      const accounts = (d.accounts || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      const txs = (d.txs || []).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.amount > 0).map(x => {
        const c = KAKEI_CATS[x.category] || [x.category || 'その他', '#8b8b93'];
        const acc = accounts.find(a => a.id === x.accountId);
        return { type: 'money', src: 'kakei', kind: x.type === 'income' ? 'in' : x.type === 'expense' ? 'out' : 'move', amount: x.amount, date: x.date, title: x.memo || c[0], cat: c[0], color: c[1], account: acc?.name || '', tx: x, line: 0, tags: [], links: [] };
      });
      v = { accounts, txs, budget: d.settings?.budget || 0 };
    } catch (e) { console.error(e); v = { error: true, accounts: [], txs: [], budget: 0 }; }
    kakeiCache = { text: t, v };
    return v;
  }
  // 口座の残高（家計アプリと同じ：はじめの残高 ＋ 収入 − 出費 ± 振替）。until までの分
  function balanceOf(a, until) {
    let b = a.initial || 0;
    for (const t of kakei()?.txs || []) {
      if (until && t.date > until) continue;
      const x = t.tx;
      if (x.type === 'income' && x.accountId === a.id) b += x.amount;
      if (x.type === 'expense' && x.accountId === a.id) b -= x.amount;
      if (x.type === 'transfer') { if (x.accountId === a.id) b -= x.amount; if (x.toAccountId === a.id) b += x.amount; }
    }
    return b;
  }
  // 家計のデータ ＋ ノートに書いた 💸💰🏦
  const moneyItems = () => [...(kakei()?.txs || []), ...items.filter(i => i.type === 'money' && i.date)];
  const catOf = i => i.cat || (i.tags && i.tags[0]) || (i.kind === 'in' ? '収入' : i.kind === 'save' ? '貯金' : 'その他');
  function goals() {
    const out = [];
    for (const [p, f] of Object.entries(S.files)) {
      const { props } = splitFrontmatter(f.text);
      const get = k => (props || []).find(x => x.k.toLowerCase() === k)?.v[0];
      if (!/^(目標|貯金|goal|savings?)$/i.test(get('type') || '') && !get('target')) continue;
      const target = parseFloat(String(get('target') || get('目標') || '0').replace(/[,¥￥円]/g, '')) || 0;
      const base = parseFloat(String(get('saved') || '0').replace(/[,¥￥円]/g, '')) || 0;
      const due = /^\d{4}-\d{2}-\d{2}$/.test(get('due') || '') ? get('due') : null;
      out.push({ path: p, name: nameOf(p), target, base, due, color: get('color') || null, saved: base });
    }
    for (const it of moneyItems()) {
      if (it.kind !== 'save') continue;
      for (const l of it.links || []) { const r = resolve(l, it.path); const g = out.find(x => x.path === r); if (g) { g.saved += it.amount; break; } }
    }
    const cols = ['#4ade80', '#a78bfa', '#fb923c', '#38bdf8', '#f472b6'];
    out.forEach((g, i) => { if (!g.color) g.color = cols[i % cols.length]; });
    return out.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  }
  // その月の数字
  function monthStats(ym) {
    const list = moneyItems().filter(i => ymOf(i.date) === ym);
    const n = daysIn(ym), day = Array.from({ length: n }, () => ({ in: 0, out: 0, save: 0 }));
    let tin = 0, tout = 0, tsave = 0;
    for (const i of list) { if (i.kind === 'move') continue; const d = +i.date.slice(8) - 1; day[d][i.kind] += i.amount; if (i.kind === 'in') tin += i.amount; else if (i.kind === 'out') tout += i.amount; else tsave += i.amount; }
    return { list, day, tin, tout, tsave, rest: tin - tout };
  }
  const cum = arr => { let s = 0; return arr.map(v => (s += v)); };

  // なめらかな線（Catmull-Rom → ベジェ）
  function smoothPath(pts) {
    if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
    // 曲げるための点が、データの上下（いちばん大きい・小さい）をはみ出さないように（0 より下に見えないように）
    const ys = pts.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), cy = y => Math.max(lo, Math.min(hi, y));
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, cy(p1[1] + (p2[1] - p0[1]) / 6)], c2 = [p2[0] - (p3[0] - p1[0]) / 6, cy(p2[1] - (p3[1] - p1[1]) / 6)];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }
  let svgId = 0;
  // 小さな線のグラフ（下を色でうすくぬる）
  function spark(vals, color, w = 120, h = 56, fromZero = true) {
    const id = 'sg' + ++svgId, max = fromZero ? Math.max(1, ...vals) : Math.max(...vals), min = fromZero ? Math.min(0, ...vals) : Math.min(...vals);
    const pts = vals.map((v, i) => [vals.length < 2 ? w : (i / (vals.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 8)]);
    const line = smoothPath(pts);
    return `<svg class="fSpark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".38"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line} L${w},${h} L0,${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" class="fGlow" style="--g:${color}"/></svg>`;
  }
  // 大きな線のグラフ：押す・マウスを乗せると、その日の額
  function bigChart(vals, keys, color, fmt) {
    const W = 600, H = 200, id = 'bg' + ++svgId, max = Math.max(1, ...vals) * 1.12;
    const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * W, H - 6 - (v / max) * (H - 18)]);
    const box = el('div', 'fBig');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <g class="fGrid">${[0.25, 0.5, 0.75].map(y => `<line x1="0" x2="${W}" y1="${H * y}" y2="${H * y}"/>`).join('')}</g>
      <path d="${smoothPath(pts)} L${W},${H} L0,${H} Z" fill="url(#${id})"/>
      <path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke" class="fGlow" style="--g:${color}"/></svg>`;
    const tip = el('div', 'fTip'); tip.hidden = true;
    const dot = el('i', 'fDot'); dot.hidden = true; dot.style.setProperty('--g', color);
    const vl = el('i', 'fVline'); vl.hidden = true;
    box.append(vl, dot, tip);
    const at = x => {
      const r = box.getBoundingClientRect(), i = Math.max(0, Math.min(vals.length - 1, Math.round(((x - r.left) / r.width) * (vals.length - 1))));
      const px = (pts[i][0] / W) * r.width, py = (pts[i][1] / H) * r.height;
      dot.hidden = tip.hidden = vl.hidden = false;
      dot.style.left = px + 'px'; dot.style.top = py + 'px'; vl.style.left = px + 'px'; vl.style.top = py + 'px';
      tip.textContent = `${md(keys[i])}  ${fmt(vals[i])}`;
      tip.style.left = Math.max(50, Math.min(r.width - 50, px)) + 'px'; tip.style.top = Math.max(0, py - 38) + 'px';
    };
    box.addEventListener('pointermove', e => at(e.clientX));
    box.addEventListener('pointerdown', e => at(e.clientX));
    box.addEventListener('pointerleave', () => { dot.hidden = tip.hidden = vl.hidden = true; });
    return box;
  }

  function renderMoney(main) {
    const tk = todayKey(), ym = moneyMonth || ymOf(tk);
    const K = kakei();
    const cur = monthStats(ym), prev = monthStats(ymAdd(ym, -1));
    const wrap = el('div', 'fin');
    const [yy, mm] = ym.split('-').map(Number);
    const isNow = ym === ymOf(tk), upto = isNow ? +tk.slice(8) : ym > ymOf(tk) ? 0 : daysIn(ym);
    // 月を変える
    const bar = el('div', 'fBar');
    bar.append(btn('iconBtn', 'chevron-left', () => { moneyMonth = ymAdd(ym, -1); render(); }, '前の月'),
      el('h2', 'fTtl', `${yy}年${mm}月`), btn('iconBtn', 'chevron-right', () => { moneyMonth = ymAdd(ym, 1); render(); }, '次の月'));
    if (!isNow) bar.append(btn('btn small white', '今月', () => { moneyMonth = null; render(); }));
    bar.append(el('span', 'fPill', `${cur.list.filter(i => i.kind !== 'move').length}件`));
    const last = K?.txs.reduce((m, t) => (t.date > m ? t.date : m), '') || '';
    if (last) bar.append(el('span', 'fSub fLast', `家計のデータ：${md(last)} まで`));
    wrap.append(bar);
    if (!K && !moneyItems().length) {
      const c = el('div', 'fCard fEmptyCard');
      c.append(el('h3', '', '家計のデータがまだありません'));
      c.insertAdjacentHTML('beforeend', '<p class="fSub">リポジトリの <code>Data/kakei.json</code>（家計アプリのバックアップと同じ形）を読みます。ノートに <code>- 💸 1,200 ランチ #食費</code>・<code>- 💰 250,000 給料</code> と書いた分も入ります。</p>');
      wrap.append(c, moneyCalendar(ym, cur, tk)); main.append(wrap); return;
    }
    // 上の数字のカード
    const delta = (a, b, good) => {
      if (!b) return el('span', 'fDelta', a ? '先月の記録はなし' : '');
      const r = ((a - b) / Math.abs(b)) * 100, up = r >= 0;
      const s2 = el('span', 'fDelta');
      s2.append(el('b', up === good ? 'g' : 'r', `${up ? '+' : ''}${r.toFixed(1)}%`), ' 先月から');
      return s2;
    };
    const kpi = (title, sub, val, color, vals, dl, extra) => {
      const c = el('div', 'fCard fKpi');
      c.style.setProperty('--k', color);
      c.append(el('h3', '', title), el('p', 'fSub', sub));
      const v = el('div', 'fVal');
      v.append(el('small', '', val < 0 ? '−¥' : '¥'), Math.round(Math.abs(val)).toLocaleString('ja-JP'));
      c.append(v, dl);
      if (extra) c.append(extra);
      const sp = el('div', 'fSpk'); sp.innerHTML = spark(vals, color); c.append(sp);
      return c;
    };
    let budgetEl = null;
    if (K?.budget) {
      const pct = (cur.tout / K.budget) * 100;
      budgetEl = el('div', 'fBudget' + (pct > 100 ? ' over' : ''));
      const pb = el('i'); pb.style.width = Math.min(100, pct) + '%';
      const bb = el('span', 'bar'); bb.append(pb);
      budgetEl.append(bb, el('small', '', `予算 ${yen(K.budget)} の ${Math.round(pct)}%`));
    }
    const ks = el('div', 'fKpis');
    ks.append(
      kpi('収入', `${mm}月に入ったお金`, cur.tin, '#4ade80', cum(cur.day.map(d => d.in)), delta(cur.tin, prev.tin, true)),
      kpi('出費', `${mm}月につかったお金`, cur.tout, '#fb923c', cum(cur.day.map(d => d.out)), delta(cur.tout, prev.tout, false), budgetEl),
      kpi('のこり', '収入 − 出費', cur.rest, '#a78bfa', cum(cur.day.map(d => d.in - d.out)), delta(cur.rest, prev.rest, true)));
    wrap.append(ks);

    // 出費の推移 ＋ 口座
    const row = el('div', 'fRow');
    const ch = el('div', 'fCard fChart');
    const n1 = Math.max(upto, 1);
    const dvals = cur.day.slice(0, n1).map(d => d.out), dkeys = dvals.map((_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
    ch.append(el('h3', '', '出費の推移'), el('p', 'fSub', `1日ごとの出費・${mm}月1日〜${n1}日`));
    ch.append(dvals.length > 1 && cur.tout ? bigChart(dvals, dkeys, '#4ade80', yen) : el('div', 'fEmpty', 'この月の出費はまだありません'));
    const ft = el('div', 'fFoot');
    const f1 = el('div'); f1.append(el('small', '', '1日あたり'), el('b', '', yen(cur.tout / n1)));
    const f2 = el('div', 'r'); f2.append(el('small', '', '期間'), el('span', '', `${yy}/${mm}/1 – ${yy}/${mm}/${n1}`));
    ft.append(f1, f2); ch.append(ft);
    row.append(ch);
    if (K?.accounts.length) {
      const ac = el('div', 'fCard fAccts');
      ac.append(el('h3', '', '口座'), el('p', 'fSub', `${isNow ? 'いま' : mm + '月末'}の残高（家計のデータから）`));
      const end = isNow ? tk : `${ym}-${String(daysIn(ym)).padStart(2, '0')}`;
      let total = 0;
      const AC = { bank: '#0090ff', card: '#f76b15', emoney: '#8e4ec6', cash: '#30a46c' };
      for (const a of K.accounts) {
        const bal = balanceOf(a, end); total += bal;
        const series = Array.from({ length: Math.max(n1, 2) }, (_, i) => balanceOf(a, `${ym}-${String(Math.min(i + 1, daysIn(ym))).padStart(2, '0')}`));
        const r = el('div', 'fCat fAcct');
        const ic = el('span', 'fIc', a.name.slice(0, 1)); ic.style.background = AC[a.type] || '#8b8b93';
        const nm = el('span', 'fNm'); nm.append(el('b', '', a.name), el('small', '', `${ACCT_TYPES[a.type] || ''}・${yen(bal)}`));
        const sp = el('span', 'fCs'); sp.innerHTML = spark(series, '#4ade80', 90, 26);
        r.append(ic, nm, sp); ac.append(r);
      }
      const f = el('div', 'fFoot'); const a1 = el('div'); a1.append(el('small', '', '合計'), el('b', '', yen(total))); f.append(a1); ac.append(f);
      row.append(ac);
    }
    wrap.append(row);

    // お金のカレンダー（使った額と出費の予定）
    wrap.append(moneyCalendar(ym, cur, tk));

    // カテゴリ ＋ 貯金の目標
    const row2 = el('div', 'fRow');
    const cats = el('div', 'fCard fCats');
    cats.append(el('h3', '', 'カテゴリ'), el('p', 'fSub', '出費の多い順（押すと記録をしぼる）'));
    const byCat = new Map();
    for (const i of cur.list.filter(i => i.kind === 'out')) { const c = catOf(i); const o = byCat.get(c) || { sum: 0, color: i.color, day: Array(daysIn(ym)).fill(0) }; o.sum += i.amount; o.day[+i.date.slice(8) - 1] += i.amount; byCat.set(c, o); }
    const CC = ['#fb923c', '#38bdf8', '#a78bfa', '#4ade80', '#f472b6', '#facc15'];
    const top = [...byCat.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 7);
    if (!top.length) cats.append(el('div', 'fEmpty', '出費がまだありません'));
    top.forEach(([name, o], i) => {
      const r = btn('fCat' + (moneyCat === name ? ' on' : ''), [], () => { moneyCat = moneyCat === name ? null : name; render(); }, name);
      const ic = el('span', 'fIc', name.slice(0, 1)); ic.style.background = o.color || CC[i % CC.length];
      const nm = el('span', 'fNm'); nm.append(el('b', '', name), el('small', '', `${yen(o.sum)}・${Math.round((o.sum / cur.tout) * 100)}%`));
      const sp = el('span', 'fCs'); sp.innerHTML = spark(cum(o.day.slice(0, Math.max(n1, 2))), '#4ade80', 90, 26);
      r.append(ic, nm, sp); cats.append(r);
    });
    row2.append(cats);
    const gs = goals();
    const gc = el('div', 'fCard fGoals');
    const gh2 = el('div', 'fHead'); gh2.append(el('h3', '', '貯金の目標'), btn('iconBtn fPlus', 'plus', () => newGoal(), '目標をつくる'));
    gc.append(gh2, el('p', 'fSub', 'ノートの先頭の target（目標の金額）・saved（貯めた額）・due（期限）'));
    if (!gs.length) gc.append(el('div', 'fEmpty', '目標はまだありません。＋ でつくるか、プロジェクトのノートの先頭に target: を書きます'));
    for (const g of gs) {
      const r = el('div', 'fGoal');
      const pct = g.target ? Math.min(100, (g.saved / g.target) * 100) : 0;
      const t2 = el('div', 'fGTop');
      t2.append(btn('fGName', g.name, () => openNote(g.path)), el('span', 'fGPct', `${Math.round(pct)}%`));
      const pb = el('div', 'fProg'); const pi = el('i'); pi.style.width = pct + '%'; pi.style.setProperty('--g', g.color); pb.append(pi);
      const sub = el('div', 'fGSub');
      sub.append(el('span', '', `${yen(g.saved)} / ${yen(g.target)}`));
      if (g.due) {
        const left = Math.round((parseKey(g.due) - parseKey(tk)) / 864e5), rest = Math.max(0, g.target - g.saved);
        const months = Math.max(1, Math.ceil(left / 30.4));
        sub.append(el('span', '', left >= 0 ? (rest ? `あと${left}日・月に${yen(rest / months)}` : `あと${left}日・達成`) : `期限を${-left}日すぎています`));
      }
      r.append(t2, pb, sub);
      gc.append(r);
    }
    row2.append(gc);
    wrap.append(row2);

    // 記録の一覧
    const lc = el('div', 'fCard fList');
    const lh = el('div', 'fHead'); lh.append(el('h3', '', moneyCat ? `記録・${moneyCat}` : '記録'));
    if (moneyCat) lh.append(btn('btn small white', ['x', 'しぼりこみを外す'], () => { moneyCat = null; render(); }));
    lc.append(lh);
    const rows = cur.list.filter(i => i.kind !== 'move' && (!moneyCat || catOf(i) === moneyCat)).sort((a, b) => b.date.localeCompare(a.date) || (b.tx?.createdAt || '').localeCompare(a.tx?.createdAt || '')).slice(0, 60);
    if (!rows.length) lc.append(el('div', 'fEmpty', '記録はまだありません'));
    for (const i of rows) {
      const r = el(i.src === 'kakei' ? 'div' : 'button', 'fRec');
      if (i.src !== 'kakei') { r.type = 'button'; r.addEventListener('click', () => openNote(i.path)); }
      const ic = el('span', 'fIc sm', catOf(i).slice(0, 1)); ic.style.background = i.color || (i.kind === 'in' ? '#30a46c' : '#8b8b93');
      const nm = el('span', 'fRn'); nm.append(el('b', '', i.title || catOf(i)), el('small', '', [md(i.date), catOf(i), i.account || (i.src ? '' : 'ノート')].filter(Boolean).join('・')));
      r.append(ic, nm, el('span', 'fRa ' + i.kind, (i.kind === 'in' ? '+' : i.kind === 'out' ? '−' : '') + yen(i.amount)));
      lc.append(r);
    }
    wrap.append(lc);
    main.append(wrap);
  }

  // ---------- お金のカレンダー ----------
  // 使った額：家計のデータ（kakei.json）とノートの 💸。出費の予定：やることの行の - [ ] 💸 80,000 家賃 📅 2026-11-25
  const plansOf = ym => items.filter(i => i.type === 'todo' && i.money?.kind === 'out' && i.date && i.date.startsWith(ym));
  const yenS = n => n >= 100000 ? `${Math.round(n / 10000)}万` : n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : Math.round(n).toLocaleString('ja-JP');
  function moneyCalendar(ym, cur, tk) {
    const card = el('div', 'fCard mCal');
    const plans = plansOf(ym);
    const spent = new Map(), plan = new Map();
    for (const i of cur.list) if (i.kind === 'out') spent.set(i.date, (spent.get(i.date) || 0) + i.amount);
    for (const p of plans) { const a = plan.get(p.date) || []; a.push(p); plan.set(p.date, a); }
    const open = plans.filter(p => !p.done), openSum = open.reduce((a, p) => a + p.money.amount, 0);
    const later = open.filter(p => p.date >= tk).reduce((a, p) => a + p.money.amount, 0), late = open.filter(p => p.date < tk);
    const hd = el('div', 'fHead');
    hd.append(el('h3', '', 'お金のカレンダー'), btn('btn small white', ['plus', '出費の予定'], () => planSheet(moneyDay && moneyDay.startsWith(ym) ? moneyDay : ym === ymOf(tk) ? tk : ym + '-01'), '出費の予定を足す'));
    card.append(hd);
    const sub = el('p', 'fSub');
    sub.append(el('span', 'mLeg out', '使った'), el('span', 'mLeg plan', '出費の予定'), document.createTextNode(plans.length ? `・まだ払っていない予定 ${yen(openSum)}${later !== openSum ? `（今日から先 ${yen(later)}）` : ''}` : '・予定はまだありません'));
    if (late.length) sub.append(el('b', 'mLate', `・期日をすぎた予定 ${late.length}件`));
    card.append(sub);
    const g = el('div', 'mGrid');
    ['月', '火', '水', '木', '金', '土', '日'].forEach((w, i) => g.append(el('span', 'mW' + (i === 5 ? ' sat' : i === 6 ? ' sun' : ''), w)));
    const first = ym + '-01', lead = (parseKey(first).getDay() + 6) % 7, n = daysIn(ym);
    for (let i = 0; i < lead; i++) g.append(el('span', 'mD blank'));
    const sel = moneyDay && moneyDay.startsWith(ym) ? moneyDay : ym === ymOf(tk) ? tk : null;
    for (let d = 1; d <= n; d++) {
      const k = `${ym}-${String(d).padStart(2, '0')}`, wd = (lead + d - 1) % 7;
      const c = btn('mD' + (k === tk ? ' today' : '') + (k === sel ? ' sel' : '') + (k > tk ? ' fut' : '') + (wd === 5 ? ' sat' : wd === 6 ? ' sun' : ''), [], () => { moneyDay = k; render(); }, `${md(k)}`);
      c.append(el('span', 'n', String(d)));
      if (spent.get(k)) c.append(el('span', 'o', '−' + yenS(spent.get(k))));
      const ps = plan.get(k) || [];
      const po = ps.filter(p => !p.done), pd = ps.filter(p => p.done);
      if (po.length) {
        const sp = el('span', 'p' + (k < tk ? ' late' : ''), yenS(po.reduce((a, p) => a + p.money.amount, 0)));
        sp.append(el('em', '', po.map(p => p.money.title).join('・')));
        c.title = `${md(k)}  予定：${po.map(p => `${p.money.title} ${yen(p.money.amount)}`).join('、')}`;
        c.append(sp);
      }
      else if (pd.length) c.append(el('span', 'p done', '払った'));
      g.append(c);
    }
    card.append(g);
    if (sel) card.append(moneyDayList(sel, cur, plan.get(sel) || []));
    return card;
  }
  // 選んだ日の中身：出費の予定（チェックで「払った」）と使った記録
  function moneyDayList(k, cur, ps) {
    const box = el('div', 'mDay');
    const out = cur.list.filter(i => i.date === k && i.kind === 'out');
    const hd = el('div', 'mDayHd');
    hd.append(el('b', '', `${md(k)}${k === todayKey() ? '（今日）' : ''}`), el('span', 'fSub', out.length ? `使った ${yen(out.reduce((a, i) => a + i.amount, 0))}` : '使った記録なし'));
    box.append(hd);
    for (const p of ps.sort((a, b) => a.done - b.done)) box.append(planMoneyRow(p, { noDate: true }));
    for (const i of out) {
      const r = el(i.src === 'kakei' ? 'div' : 'button', 'fRec');
      if (i.src !== 'kakei') { r.type = 'button'; r.addEventListener('click', () => openNote(i.path)); }
      const ic = el('span', 'fIc sm', catOf(i).slice(0, 1)); ic.style.background = i.color || '#8b8b93';
      const nm = el('span', 'fRn'); nm.append(el('b', '', i.title || catOf(i)), el('small', '', [catOf(i), i.account || (i.src ? '' : 'ノート')].filter(Boolean).join('・')));
      r.append(ic, nm, el('span', 'fRa out', '−' + yen(i.amount)));
      box.append(r);
    }
    if (!ps.length && !out.length) box.append(el('div', 'fEmpty', 'この日はなにもありません'));
    return box;
  }
  // 出費の予定の1行（チェックで「払った」、押すと直す）
  function planMoneyRow(p, opt = {}) {
    const tk = todayKey();
    const r = el('div', 'fRec mPlan' + (p.done ? ' done' : ''));
    r.append(btn('tchk' + (p.done ? ' on' : ''), 'check', () => setDone(p, !p.done), p.done ? 'まだ払っていないにする' : '払った'));
    const nm = btn('fRn', [], () => planSheet(p), `「${p.money.title}」を直す`);
    const when = p.done ? '払った' : p.date < tk ? `期日をすぎています（${sd(p.date)}）` : opt.noDate ? '' : relDay(p.date);
    nm.append(el('b', '', p.money.title || '出費の予定'), el('small', '', [when, p.tags[0], nameOf(p.path)].filter(Boolean).join('・')));
    r.append(nm, el('span', 'fRa plan' + (!p.done && p.date < tk ? ' late' : ''), yen(p.money.amount)));
    return r;
  }
  // 出費の予定の行をつくる
  function planLine({ indent = '', done = false, amount, name, tag, extra = '', date }) {
    return `${indent}- [${done ? 'x' : ' '}] 💸 ${Math.round(amount).toLocaleString('ja-JP')} ${name}${tag ? ' #' + tag : ''}${extra ? ' ' + extra : ''} 📅 ${date}`;
  }
  // 出費の予定を足す・直す。k：日にち（足すとき）か、出費の予定のやること（直すとき）
  function planSheet(k) {
    const it = typeof k === 'object' ? k : null;
    const inn = $('#sheetIn');
    sheetHead(inn, it ? '出費の予定を直す' : '出費の予定を足す');
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const nm = el('input', 'inp'); nm.placeholder = '例：家賃・スマホ代・飲み会';
    const am = el('input', 'inp'); am.inputMode = 'numeric'; am.placeholder = '例：80000';
    const du = el('input', 'inp'); du.type = 'date';
    const tg = el('input', 'inp'); tg.placeholder = '例：住まい（なくても可）';
    // 直すとき：カテゴリ（はじめのタグ）以外のタグ・リンクはそのまま残す
    const keep = it ? [...it.links.map(l => `[[${l}]]`), ...it.tags.slice(1).map(g => '#' + g)].join(' ') : '';
    if (it) { nm.value = it.money.title; am.value = String(it.money.amount); du.value = it.date; tg.value = it.tags[0] || ''; }
    else du.value = k;
    inn.append(fld('なにに', nm), fld('金額（円）', am), fld('日にち', du), fld('カテゴリ', tg));
    inn.append(el('div', 'hint sub', it ? `「${nameOf(it.path)}」の行を書きかえます` : 'Inbox.md に「- [ ] 💸 金額 なにに 📅 日にち」と書きます。払ったらチェックを付けます'));
    const bs = el('div', 'shBtns');
    const save = async () => {
      const name = nm.value.replace(/\s+/g, ' ').trim(), amount = parseFloat(am.value.replace(/[,¥￥円\s]/g, ''));
      if (!name) { nm.focus(); return; }
      if (!(amount > 0)) { am.focus(); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(du.value)) { du.focus(); return; }
      const tag = tg.value.trim().replace(/^#/, '').replace(/\s+/g, '-');
      sheet.close();
      moneyDay = du.value; moneyMonth = du.value.slice(0, 7) === ymOf(todayKey()) ? null : du.value.slice(0, 7);
      if (it) {
        const line = planLine({ indent: it.raw.match(/^\s*/)[0], done: it.done, amount, name, tag, extra: keep, date: du.value });
        const ok = await edit(it.path, t => (t == null ? null : MDParser.replaceLine(t, it.line, it.raw, line)), `出費の予定を直す: ${name}`);
        if (ok) toast(`「${name}」を直しました`);
      } else {
        const v = planLine({ amount, name, tag, date: du.value }).replace(/^- \[ \] /, '');
        if (await edit('Inbox.md', t => MDParser.addTodo(t == null ? '# Inbox\n' : t, v), `出費の予定: ${name}`)) toast(`${md(du.value)}に「${name}」の予定を足しました`);
      }
    };
    if (it) {
      let armed = false;
      const del = btn('btn danger', ['trash-2', '消す'], async () => {
        if (!armed) { armed = true; del.lastChild.textContent = 'もう一度押すと消します'; return; }
        sheet.close();
        const ok = await edit(it.path, t => (t == null ? null : MDParser.removeLine(t, it.line, it.raw)), `出費の予定を消す: ${it.money.title}`);
        if (ok) toast(`「${it.money.title}」を消しました`);
      });
      bs.append(del, btn('btn white', ['file-text', 'ノート'], () => { sheet.close(); openNote(it.path); }));
    }
    bs.append(btn('btn primary', ['check', it ? '保存' : '足す'], save));
    [nm, am].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) save(); }));
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => (it ? am : nm).focus(), 50);
  }
  // ホームの「出費の予定」：期日をすぎた分と、これから30日のまだ払っていない予定
  function upcomingPlans() {
    const tk = todayKey(), end = addDays(tk, 30);
    return items.filter(i => i.type === 'todo' && i.money?.kind === 'out' && !i.done && i.date && i.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  }
  function planWidget(wrapCard) {
    const ps = upcomingPlans(), tk = todayKey();
    const sum = ps.reduce((a, p) => a + p.money.amount, 0), late = ps.filter(p => p.date < tk).length;
    const sub = el('p', 'mWSub');
    sub.append(el('b', '', yen(sum)), ` これから30日${late ? '' : 'の予定'}`);
    if (late) sub.append(el('span', 'mLate', `・期日すぎ ${late}件`));
    wrapCard.append(sub);
    if (!ps.length) wrapCard.append(el('p', 'db-empty', 'これから30日の出費の予定はありません'));
    let last = null;
    for (const p of ps.slice(0, 8)) {
      const g = p.date < tk ? '期日をすぎた分' : relDay(p.date);
      if (g !== last) { wrapCard.append(el('div', 'hb-sep', g)); last = g; }
      wrapCard.append(planMoneyRow(p, { noDate: true }));
    }
    if (ps.length > 8) wrapCard.append(btn('addTask', ['chevron-right', `ほか ${ps.length - 8} 件`], () => switchTab('money')));
    wrapCard.classList.add('mWidget');
    return wrapCard;
  }
  const showPlanWidget = () => !!kakei() || items.some(i => i.type === 'todo' && i.money);

  // 貯金の目標をつくる（Finance/名前.md）
  function newGoal() {
    const inn = $('#sheetIn');
    sheetHead(inn, '貯金の目標をつくる');
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const nm = el('input', 'inp'); nm.placeholder = '例：引越し資金';
    const tg = el('input', 'inp'); tg.inputMode = 'numeric'; tg.placeholder = '例：500000';
    const du = el('input', 'inp'); du.type = 'date';
    inn.append(fld('名前', nm), fld('目標の金額（円）', tg), fld('期限（なくても可）', du), el('div', 'hint sub', 'Finance/名前.md に書きます'));
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['target', 'つくる'], async () => {
      const name = nm.value.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim(), target = parseFloat(tg.value.replace(/[,¥￥円]/g, ''));
      if (!name) { nm.focus(); return; }
      if (!target) { tg.focus(); return; }
      const rel = `Finance/${name}.md`;
      if (S.files[rel]) { toast('同じ名前の目標があります', 'warn'); return; }
      sheet.close();
      const text = `---\ntype: 目標\ntags: [お金]\ntarget: ${target}\n${du.value ? `due: ${du.value}\n` : ''}---\n# ${name}\n\n貯めた分は、デイリーノートなどに \`- 🏦 30,000 [[${name}]]\` と書きます。\n`;
      if (await edit(rel, () => text, `目標: ${name}`)) toast(`目標「${name}」をつくりました`);
    }));
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => nm.focus(), 50);
  }

  // ================= ヘルス（体重・睡眠・歩数・筋トレ） =================
  // 読むもの：
  //   Data/health/health.csv  … iPhone のヘルスケア（ショートカット → Cmd の Actions が作る）。date,weight_kg,body_fat_pct,sleep_min,steps,resting_hr,active_kcal
  //   Data/kintore/sets.csv   … 筋トレメモの全セット（date,start,session_id,exercise,muscle_group,kind,weight_kg,reps,e1rm_kg,volume_kg …）
  //   デイリーノートの「- 体重 70.5kg」「- 体脂肪 18%」の行（ヘルスケアにない日をうめる）
  //   目標：ノートの先頭の goal_weight: 67・goal_due: 2027-02-28、または本文の「目標：67kg（2027-02-28）」
  const MOOD_RE = /^[ \t]*[-*][ \t]+気分[ \t　]*[:：]?[ \t　]*([1-5])(?:[ \t]*[/／][ \t]*5)?(?:[ \t　]+(.*))?$/gm;   // 改行をまたがない
  const MOODS = [[1, '😣', 'とても悪い', '#ef4444'], [2, '😕', '悪い', '#f97316'], [3, '😐', 'ふつう', '#eab308'], [4, '🙂', '良い', '#84cc16'], [5, '😄', 'とても良い', '#22c55e']];
  const moodOf = v => MOODS[Math.max(0, Math.min(4, Math.round(v) - 1))];
  let healthRange = 30;          // 見る日数（0 は全部）
  const HC = { weight: '#38bdf8', avg: '#a78bfa', sleep: '#818cf8', steps: '#4ade80', lift: '#fb923c', goal: '#f472b6' };

  // CSV を読む（"..." の中のカンマ・改行もそのまま）
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x !== '')) rows.push(row);
    const head = (rows.shift() || []).map(h => h.trim());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

  let healthCache = { key: null, v: null };
  function healthData() {
    const hcsv = S.cfg?.['Data/health/health.csv'] || '', scsv = S.cfg?.['Data/kintore/sets.csv'] || '', zcsv = S.cfg?.['Data/health/sleep.csv'] || '';
    const key = hcsv.length + ':' + scsv.length + ':' + zcsv.length + ':' + hcsv.slice(-80) + scsv.slice(-80) + zcsv.slice(-60) + ':' + filesVersion;
    if (healthCache.key === key) return healthCache.v;
    // 日ごとの体の数字
    const days = new Map();
    const put = (d, k, v) => { if (v == null || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return; const o = days.get(d) || { date: d }; if (o[k] == null) o[k] = v; days.set(d, o); };
    for (const r of parseCSV(hcsv)) {
      put(r.date, 'weight', num(r.weight_kg)); put(r.date, 'fat', num(r.body_fat_pct));
      put(r.date, 'sleep', num(r.sleep_min) ?? (num(r.sleep_h) != null ? num(r.sleep_h) * 60 : null));
      put(r.date, 'steps', num(r.steps)); put(r.date, 'rhr', num(r.resting_hr)); put(r.date, 'kcal', num(r.active_kcal));
      put(r.date, 'deep', num(r.sleep_deep_min)); put(r.date, 'core', num(r.sleep_core_min)); put(r.date, 'rem', num(r.sleep_rem_min)); put(r.date, 'awake', num(r.sleep_awake_min));
      if (/^\d{1,2}:\d{2}$/.test(r.bed_time || '')) put(r.date, 'bed', r.bed_time.padStart(5, '0'));
      if (/^\d{1,2}:\d{2}$/.test(r.wake_time || '')) put(r.date, 'wake', r.wake_time.padStart(5, '0'));
    }
    // デイリーノートの「- 体重 70.5kg」
    for (const [p, f] of Object.entries(S.files)) {
      if (!/体重|体脂肪|気分/.test(f.text)) continue;
      // その日のノートだけ（デイリーノートか、YYYY/MM/DD/ のフォルダのノート。調べもののノートの「体重 70kg の人は…」は数えない）
      const fm = p.match(/^(\d{4})\/(\d{2})\/(\d{2})\//), d = Daily.dateOf(p, dailyCfg) || (fm ? `${fm[1]}-${fm[2]}-${fm[3]}` : null);
      if (!d) continue;
      for (const m of f.text.matchAll(/^\s*[-*]\s+体重\s*[:：]?\s*(\d{2,3}(?:\.\d+)?)\s*kg/gim)) put(d, 'weight', +m[1]);
      for (const m of f.text.matchAll(/^\s*[-*]\s+体脂肪率?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)\s*%/gim)) put(d, 'fat', +m[1]);
      // 気分：- 気分 4/5 ひとこと（1日に何回でも。その日の数字は平均）
      for (const m of f.text.matchAll(MOOD_RE)) {
        const o = days.get(d) || { date: d };
        (o.moods = o.moods || []).push({ v: +m[1], note: (m[2] || '').trim(), path: p });
        o.mood = o.moods.reduce((a, x) => a + x.v, 0) / o.moods.length;
        days.set(d, o);
      }
    }
    const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    // 筋トレ（セッションごと）
    const ses = new Map();
    for (const r of parseCSV(scsv)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      const id = r.session_id || r.date + r.start;
      const s = ses.get(id) || { id, date: r.date, start: r.start || '', volume: 0, sets: 0, ex: new Map(), groups: new Set() };
      if (r.kind && !/normal|本番/.test(r.kind)) { ses.set(id, s); continue; }   // ウォームアップは数えない
      s.sets++; s.volume += num(r.volume_kg) || 0;
      if (r.muscle_group) s.groups.add(r.muscle_group);
      const e = s.ex.get(r.exercise) || { name: r.exercise, group: r.muscle_group, best: 0, e1rm: 0, reps: 0 };
      e.best = Math.max(e.best, num(r.weight_kg) || 0); e.e1rm = Math.max(e.e1rm, num(r.e1rm_kg) || 0); e.reps += num(r.reps) || 0;
      s.ex.set(r.exercise, e); ses.set(id, s);
    }
    const sessions = [...ses.values()].filter(s => s.sets).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    // 1晩の流れ（何時から何時までがどの段階か）
    const segs = new Map();
    const tmin = t => { const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 60000 : null; };
    for (const r of parseCSV(zcsv)) {
      const a = tmin(r.start), b = tmin(r.end);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || a == null || b == null || b <= a || !['deep', 'core', 'rem', 'awake', 'asleep'].includes(r.stage)) continue;
      const l = segs.get(r.date) || []; l.push({ a, b, st: r.stage }); segs.set(r.date, l);
    }
    for (const l of segs.values()) l.sort((x, y) => x.a - y.a);
    const v = { segs, days: list, sessions, goal: weightGoal(), hasHealth: !!hcsv.trim(), hasLift: !!scsv.trim() };
    healthCache = { key, v };
    return v;
  }
  // 減量の目標
  function weightGoal() {
    for (const [p, f] of Object.entries(S.files)) {
      const { props } = splitFrontmatter(f.text);
      const get = k => (props || []).find(x => x.k.toLowerCase() === k)?.v[0];
      const w = num(get('goal_weight') || get('目標体重'));
      if (w) { const due = get('goal_due') || get('due'); return { weight: w, due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : null, path: p }; }
    }
    for (const [p, f] of Object.entries(S.files)) {
      if (!/減量|ダイエット|体重/.test(p)) continue;
      const m = f.text.match(/目標[^\n：:]*[：:]\s*\**\s*(\d{2,3}(?:\.\d+)?)\s*kg\s*[（(]\s*(\d{4}-\d{2}-\d{2})/);
      if (m) return { weight: +m[1], due: m[2], path: p };
    }
    return null;
  }
  // 7日の平均（その日までの7日で、記録のある日）
  function avg7(list, k, date) {
    const from = addDays(date, -6);
    const v = list.filter(x => x.date >= from && x.date <= date && x[k] != null).map(x => x[k]);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  const kg = n => n == null ? '—' : n.toFixed(1);
  const hm = m => m == null ? '—' : `${Math.floor(m / 60)}時間${String(Math.round(m % 60)).padStart(2, '0')}分`;

  // 体重のグラフ：日ごとの点・7日平均の線・目標の線。押す・乗せると、その日の数字
  function weightChart(pts, goal) {
    const W = 600, H = 220, n = pts.length;
    const vals = pts.flatMap(p => [p.weight, p.avg]).filter(v => v != null);
    if (goal) vals.push(goal.weight);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max(0.4, (hi - lo) * 0.12); lo -= pad; hi += pad;
    const X = i => (n < 2 ? W / 2 : (i / (n - 1)) * W), Y = v => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 22);
    const avgPts = pts.map((p, i) => p.avg != null ? [X(i), Y(p.avg)] : null).filter(Boolean);
    const id = 'wg' + ++svgId;
    const box = el('div', 'fBig hW');
    const ticks = [0.25, 0.5, 0.75].map(r => lo + (hi - lo) * (1 - r));
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HC.avg}" stop-opacity=".28"/><stop offset="1" stop-color="${HC.avg}" stop-opacity="0"/></linearGradient></defs>
      <g class="fGrid">${ticks.map(t => `<line x1="0" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/>`).join('')}</g>
      ${goal ? `<line class="hGoalLine" x1="0" x2="${W}" y1="${Y(goal.weight)}" y2="${Y(goal.weight)}" stroke="${HC.goal}" vector-effect="non-scaling-stroke"/>` : ''}
      ${avgPts.length > 1 ? `<path d="${smoothPath(avgPts)} L${avgPts[avgPts.length - 1][0]},${H} L${avgPts[0][0]},${H} Z" fill="url(#${id})"/><path d="${smoothPath(avgPts)}" fill="none" stroke="${HC.avg}" stroke-width="2.4" vector-effect="non-scaling-stroke" class="fGlow" style="--g:${HC.avg}"/>` : ''}
    </svg>`;
    // 点は丸のまま見せたいので、SVG の上に重ねる
    const dots = el('div', 'hDots');
    pts.forEach((p, i) => { if (p.weight == null) return; const d = el('i'); d.style.left = (X(i) / W) * 100 + '%'; d.style.top = (Y(p.weight) / H) * 100 + '%'; dots.append(d); });
    box.append(dots);
    if (goal) { const g = el('span', 'hGoalTag', `目標 ${kg(goal.weight)}kg`); g.style.top = (Y(goal.weight) / H) * 100 + '%'; box.append(g); }
    const ax = el('div', 'hAxis'); ticks.forEach(t => { const s = el('span', '', t.toFixed(1)); s.style.top = (Y(t) / H) * 100 + '%'; ax.append(s); }); box.append(ax);
    const tip = el('div', 'fTip'); tip.hidden = true;
    const vl = el('i', 'fVline'); vl.hidden = true;
    box.append(vl, tip);
    let raf = 0, lastX = 0;
    const at = () => {
      raf = 0;
      const r = box.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((lastX - r.left) / r.width) * (n - 1))));
      const p = pts[i], px = (X(i) / W) * r.width, v = p.weight ?? p.avg;
      if (v == null) return;
      const py = (Y(v) / H) * r.height;
      tip.hidden = vl.hidden = false;
      vl.style.left = px + 'px'; vl.style.top = py + 'px';
      tip.textContent = `${md(p.date)}  ${p.weight != null ? kg(p.weight) + 'kg' : '記録なし'}${p.avg != null ? `（平均 ${kg(p.avg)}）` : ''}`;
      tip.style.left = Math.max(80, Math.min(r.width - 80, px)) + 'px'; tip.style.top = Math.max(0, py - 40) + 'px';
    };
    const move = e => { lastX = e.clientX; if (!raf) raf = requestAnimationFrame(at); };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerdown', move);
    box.addEventListener('pointerleave', () => { tip.hidden = vl.hidden = true; });
    return box;
  }
  // 棒のグラフ（睡眠・歩数・週の挙上量）
  function bars(vals, labels, color, fmt, goalLine) {
    const TH = 84;   // 棒の高さ（px）
    const box = el('div', 'hBars');
    const max = Math.max(1, goalLine || 0, ...vals.map(v => v || 0)) * 1.08;
    const every = Math.ceil(vals.length / 7);
    vals.forEach((v, i) => {
      const c = el('div', 'hBar' + (v == null ? ' none' : ''));
      c.title = `${labels[i]}  ${v == null ? '記録なし' : fmt(v)}`;
      const t = el('span', 't'); const b2 = el('i'); b2.style.height = v == null ? '3px' : Math.max(3, (v / max) * TH) + 'px'; b2.style.setProperty('--g', color); t.append(b2);
      c.append(t, el('small', '', (vals.length - 1 - i) % every === 0 ? labels[i] : ''));
      box.append(c);
    });
    if (goalLine) { const g = el('span', 'hBarGoal'); g.style.bottom = `calc(18px + ${(goalLine / max) * TH}px)`; g.title = '目安 ' + fmt(goalLine); box.append(g); }
    return box;
  }

  function renderHealth(main) {
    const H = healthData(), tk = todayKey();
    const wrap = el('div', 'fin hl');
    const bar = el('div', 'fBar');
    const seg = el('div', 'seg hSeg');
    [[30, '30日'], [90, '90日'], [0, '全部']].forEach(([v, l]) => seg.append(btn(healthRange === v ? 'on' : '', l, () => { healthRange = v; render(); })));
    bar.append(seg, btn('btn small white', ['smile', '気分を書く'], () => moodSheet()), btn('btn small white', ['scale', '体重を書く'], () => weightSheet()));
    const lastH = H.days.length ? H.days[H.days.length - 1].date : '';
    if (lastH) bar.append(el('span', 'fSub fLast', `体の記録：${md(lastH)} まで`));
    wrap.append(bar);
    if (!H.days.length && !H.sessions.length) {
      const c = el('div', 'fCard fEmptyCard');
      c.append(el('h3', '', '体の記録がまだありません'));
      c.insertAdjacentHTML('beforeend', '<p class="fSub">デイリーノートに <code>- 体重 70.5kg</code> と書くか、上の「体重を書く」で入れます。iPhone のヘルスケアの数字は <code>Data/health/health.csv</code>、筋トレメモの記録は <code>Data/kintore/sets.csv</code> から読みます。</p>');
      wrap.append(c); main.append(wrap); return;
    }
    const from = healthRange ? addDays(tk, -(healthRange - 1)) : (H.days[0]?.date || tk);
    const range = []; for (let k = from; k <= tk; k = addDays(k, 1)) range.push(k);
    const byDate = new Map(H.days.map(d => [d.date, d]));
    const wdays = H.days.filter(d => d.weight != null);
    const lastW = wdays[wdays.length - 1];
    const curAvg = lastW ? avg7(H.days, 'weight', lastW.date) : null, weekAgo = lastW ? avg7(H.days, 'weight', addDays(lastW.date, -7)) : null;
    const goal = H.goal;

    // 上の数字のカード
    const kpi = (title, sub, big, unit, color, vals, delta, fromZero = true) => {
      const c = el('div', 'fCard fKpi'); c.style.setProperty('--k', color);
      c.append(el('h3', '', title), el('p', 'fSub', sub));
      const v = el('div', 'fVal'); v.append(big); if (unit) v.append(el('small', '', ' ' + unit)); c.append(v);
      if (delta) c.append(delta);
      const ok = vals.filter(x => x != null);
      if (new Set(ok.map(x => x.toFixed(2))).size > 1) { const sp = el('div', 'fSpk'); sp.innerHTML = spark(ok, color, 120, 56, fromZero); c.append(sp); }
      return c;
    };
    const dl = (txt, good) => { const s = el('span', 'fDelta'); if (txt) s.append(el('b', good == null ? '' : good ? 'g' : 'r', txt[0]), txt[1]); return s; };
    const last14 = Array.from({ length: 14 }, (_, i) => addDays(tk, i - 13));
    const ks = el('div', 'fKpis hKpis');
    const wd = curAvg != null && weekAgo != null ? curAvg - weekAgo : null;
    ks.append(kpi('体重', lastW ? `7日平均（${sd(lastW.date)} は ${kg(lastW.weight)}kg）` : 'まだ記録がありません', kg(curAvg), 'kg', HC.weight,
      range.map(k => avg7(H.days, 'weight', k)), wd == null ? null : dl([`${wd > 0 ? '+' : wd < 0 ? '−' : '±'}${Math.abs(wd).toFixed(2)}kg`, ' 1週間で'], wd <= 0), false));
    if (goal) {
      const rest = curAvg != null ? curAvg - goal.weight : null;
      let sub = `目標 ${kg(goal.weight)}kg${goal.due ? `・${sd(goal.due)} まで` : ''}`, d2 = null;
      if (rest != null && goal.due) {
        const weeks = Math.max(0.1, (parseKey(goal.due) - parseKey(tk)) / 864e5 / 7), need = rest / weeks;
        d2 = rest <= 0 ? dl(['達成', ' おめでとう'], true) : dl([`週 ${need.toFixed(2)}kg`, ` 落とせば間に合う${wd != null ? `（いまは週 ${(-wd).toFixed(2)}kg）` : ''}`], wd != null ? -wd >= need * 0.9 : null);
      }
      ks.append(kpi('目標まで', sub, rest == null ? '—' : rest <= 0 ? '0.0' : kg(rest), 'kg', HC.goal, [], d2));
    }
    const mAvg = avg7(H.days, 'mood', tk), mToday = byDate.get(tk)?.mood;
    ks.append(kpi('気分', mToday != null ? `7日平均（今日は ${moodOf(mToday)[1]} ${mToday.toFixed(1)}）` : '7日平均（今日はまだ）', mAvg == null ? '—' : `${moodOf(mAvg)[1]} ${mAvg.toFixed(1)}`, mAvg == null ? '' : '/ 5', '#facc15',
      last14.map(k => byDate.get(k)?.mood ?? null), mAvg == null ? dl(['', '「気分を書く」か TEDDY から'], null) : null, false));
    const sl = last14.map(k => byDate.get(k)?.sleep ?? null), sAvg = avg7(H.days, 'sleep', tk);   // 睡眠のカード（くわしくは下の「睡眠の質」）
    ks.append(kpi('睡眠', '7日平均', sAvg == null ? '—' : `${Math.floor(sAvg / 60)}:${String(Math.round(sAvg % 60)).padStart(2, '0')}`, sAvg == null ? '' : '時間', HC.sleep, sl, sAvg == null ? dl(['', 'ヘルスケアから入ります'], null) : dl([sAvg >= 420 ? 'よく寝ています' : '7時間より短め', ''], sAvg >= 420)));
    const st = last14.map(k => byDate.get(k)?.steps ?? null), stAvg = avg7(H.days, 'steps', tk);
    ks.append(kpi('歩数', '7日平均', stAvg == null ? '—' : Math.round(stAvg).toLocaleString('ja-JP'), stAvg == null ? '' : '歩', HC.steps, st, stAvg == null ? dl(['', 'ヘルスケアから入ります'], null) : null));
    const wk0 = addDays(tk, -((parseKey(tk).getDay() + 6) % 7));   // 今週の月曜
    const thisWeek = H.sessions.filter(s => s.date >= wk0);
    const wkVol = Array.from({ length: 8 }, (_, i) => { const a = addDays(wk0, (i - 7) * 7), b = addDays(a, 6); return H.sessions.filter(s => s.date >= a && s.date <= b).reduce((x, s) => x + s.volume, 0); });
    ks.append(kpi('筋トレ', '今週（月曜から）', String(thisWeek.length), '回', HC.lift, wkVol,
      dl([`${Math.round(thisWeek.reduce((a, s) => a + s.volume, 0)).toLocaleString('ja-JP')}kg`, ' 今週の総挙上量'], null)));
    wrap.append(ks);

    // 体重の流れ ＋ 体の数字
    const row = el('div', 'fRow');
    const ch = el('div', 'fCard fChart');
    ch.append(el('h3', '', '体重の流れ'), el('p', 'fSub', '点：その日の体重・線：7日平均' + (goal ? '・ピンク：目標' : '')));
    const pts = range.map(k => ({ date: k, weight: byDate.get(k)?.weight ?? null, avg: avg7(H.days, 'weight', k) }));
    ch.append(pts.some(p => p.weight != null) ? weightChart(pts, goal) : el('div', 'fEmpty', 'この期間の体重はまだありません。デイリーノートに「- 体重 70.5kg」と書くと出ます'));
    const inR = wdays.filter(d => d.date >= from);
    const ft = el('div', 'fFoot');
    const f1 = el('div'); f1.append(el('small', '', 'この期間'), el('b', '', inR.length > 1 ? `${(inR[inR.length - 1].weight - inR[0].weight > 0 ? '+' : '')}${(inR[inR.length - 1].weight - inR[0].weight).toFixed(1)}kg` : '—'));
    const f2 = el('div', 'r'); f2.append(el('small', '', '記録した日'), el('span', '', `${inR.length}日 / ${range.length}日`));
    ft.append(f1, f2); ch.append(ft);
    row.append(ch);
    const side = el('div', 'fCard hSide');
    side.append(el('h3', '', '歩数と体の数字'), el('p', 'fSub', '直近14日（ヘルスケアから）'));
    if (st.some(v => v != null)) {
      side.append(bars(st, last14.map(sd), HC.steps, v => Math.round(v).toLocaleString('ja-JP') + '歩', 8000));
    } else {
      side.append(el('div', 'fEmpty', 'まだありません。iPhone のショートカットで毎朝ヘルスケアの数字を送ると入ります'));
      const hn = Object.keys(S.files).find(p => nameOf(p) === 'ヘルスケア連携');
      if (hn) side.append(btn('btn small white', ['book-open', '作り方を見る'], () => openNote(hn)));
    }
    const rows2 = [['安静時心拍', 'rhr', 'bpm'], ['体脂肪率', 'fat', '%'], ['活動カロリー', 'kcal', 'kcal']];
    const mini = el('div', 'hMini');
    for (const [l, k, u] of rows2) { const a = avg7(H.days, k, tk); if (a == null) continue; const d = el('div'); d.append(el('small', '', l), el('b', '', `${k === 'fat' ? a.toFixed(1) : Math.round(a).toLocaleString('ja-JP')} ${u}`)); mini.append(d); }
    if (mini.childElementCount) side.append(mini);
    row.append(side);
    wrap.append(row);

    // 気分
    wrap.append(moodCard(H, range));
    // 睡眠の質（大きいグラフ）
    wrap.append(sleepCard(H, range));

    // 筋トレ：種目ごとの重さ ＋ 週の挙上量
    if (H.sessions.length) {
      const row2 = el('div', 'fRow');
      const lc = el('div', 'fCard fCats');
      lc.append(el('h3', '', '種目ごとの重さ'), el('p', 'fSub', '推定1RM の流れ（減量中も重さを落とさない）'));
      const byEx = new Map();
      for (const s of H.sessions) for (const e of s.ex.values()) { const a = byEx.get(e.name) || { name: e.name, group: e.group, list: [] }; a.list.push({ date: s.date, best: e.best, e1rm: e.e1rm, reps: e.reps }); byEx.set(e.name, a); }
      const top = [...byEx.values()].sort((a, b) => b.list.length - a.list.length).slice(0, 6);
      for (const e of top) {
        const r = el('div', 'fCat');
        const ic = el('span', 'fIc', (e.group || e.name).slice(0, 1)); ic.style.background = HC.lift;
        const lst = e.list[e.list.length - 1], prev = e.list[e.list.length - 2];
        const key = lst.e1rm || lst.best ? 'e1rm' : 'reps';
        const val = x => (key === 'e1rm' ? x.e1rm || x.best : x.reps);
        const diff = prev ? val(lst) - val(prev) : 0;
        const nm = el('span', 'fNm');
        nm.append(el('b', '', e.name), el('small', '', key === 'e1rm' ? `${sd(lst.date)}・最高 ${lst.best}kg・1RM ${(lst.e1rm || lst.best).toFixed(1)}kg${prev ? `（${diff >= 0 ? '+' : ''}${diff.toFixed(1)}）` : ''}` : `${sd(lst.date)}・${lst.reps}回（自重）${prev ? `（${diff >= 0 ? '+' : ''}${diff}）` : ''}`));
        const sp = el('span', 'fCs'); sp.innerHTML = spark(e.list.map(val), HC.lift, 90, 26, false);
        r.append(ic, nm, sp); lc.append(r);
      }
      row2.append(lc);
      const vc = el('div', 'fCard hSide');
      vc.append(el('h3', '', '週ごとの総挙上量'), el('p', 'fSub', '直近8週（本番セットの 重さ×回数）'));
      vc.append(bars(wkVol, Array.from({ length: 8 }, (_, i) => sd(addDays(wk0, (i - 7) * 7))), HC.lift, v => Math.round(v).toLocaleString('ja-JP') + 'kg'));
      const cnt = Array.from({ length: 8 }, (_, i) => { const a = addDays(wk0, (i - 7) * 7), b = addDays(a, 6); return H.sessions.filter(s => s.date >= a && s.date <= b).length; });
      const ft2 = el('div', 'fFoot'); const a1 = el('div'); a1.append(el('small', '', '8週の回数'), el('b', '', `${cnt.reduce((a, b) => a + b, 0)}回`));
      const a2 = el('div', 'r'); a2.append(el('small', '', '1週あたり'), el('span', '', `${(cnt.reduce((a, b) => a + b, 0) / 8).toFixed(1)}回`));
      ft2.append(a1, a2); vc.append(ft2);
      row2.append(vc);
      wrap.append(row2);

      // 最近のトレーニング
      const lc2 = el('div', 'fCard fList');
      const lh = el('div', 'fHead'); lh.append(el('h3', '', '最近のトレーニング'));
      const kn = Object.keys(S.files).find(p => nameOf(p) === '筋トレの記録');
      if (kn) lh.append(btn('btn small white', ['book-open', '筋トレの記録'], () => openNote(kn)));
      lc2.append(lh);
      for (const s of H.sessions.slice(-8).reverse()) {
        const np = Object.keys(S.files).find(p => p.startsWith(s.date.replace(/-/g, '/') + '/') && /筋トレ/.test(nameOf(p)));
        const r = el(np ? 'button' : 'div', 'fRec');
        if (np) { r.type = 'button'; r.addEventListener('click', () => openNote(np)); }
        const ic = el('span', 'fIc sm', [...s.groups][0]?.slice(0, 1) || '筋'); ic.style.background = HC.lift;
        const nm = el('span', 'fRn'); nm.append(el('b', '', [...s.ex.keys()].join('・')), el('small', '', [md(s.date), s.start, `${s.sets}セット`, [...s.groups].join('・')].filter(Boolean).join('・')));
        r.append(ic, nm, el('span', 'fRa', `${Math.round(s.volume).toLocaleString('ja-JP')}kg`));
        lc2.append(r);
      }
      wrap.append(lc2);
    }
    main.append(wrap);
  }

  // 体重を今日のデイリーノートの「メモ」に書く（- 体重 70.5kg [[減量]]）
  function weightSheet() {
    const inn = $('#sheetIn');
    sheetHead(inn, '体重を書く');
    const tk = todayKey();
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const w = el('input', 'inp'); w.inputMode = 'decimal'; w.placeholder = '例：70.5';
    const lastW = healthData().days.filter(d => d.weight != null).pop();
    if (lastW) w.placeholder = `例：${kg(lastW.weight)}（${sd(lastW.date)}）`;
    const ft = el('input', 'inp'); ft.inputMode = 'decimal'; ft.placeholder = 'なくても可';
    const goal = healthData().goal;
    inn.append(fld('体重（kg）', w), fld('体脂肪率（%）', ft), el('div', 'hint sub', `${relDay(tk)}のデイリーノートの「メモ」に書きます`));
    const bs = el('div', 'shBtns');
    const save = async () => {
      const v = parseFloat(w.value.replace(/[^\d.]/g, ''));
      if (!(v > 20 && v < 300)) { w.focus(); return; }
      const f = parseFloat(ft.value.replace(/[^\d.]/g, ''));
      const link = goal ? ` [[${nameOf(goal.path)}]]` : '';
      const lines = [`- 体重 ${v}kg${link}`]; if (f > 0 && f < 70) lines.push(`- 体脂肪 ${f}%`);
      sheet.close();
      const rel = dailyPathOf(tk);
      const ok = await edit(rel, t => addToMemo(t == null ? newDailyText(tk) : t, lines), `体重: ${v}kg`);
      if (ok) toast(`${relDay(tk)}のノートに体重を書きました`);
    };
    bs.append(btn('btn primary', ['check', '書く'], save));
    [w, ft].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) save(); }));
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => w.focus(), 50);
  }
  // 「## メモ」の見出しのすぐ下に入れる。もう同じ日に体重があれば、その行を書きかえる
  function addToMemo(text, lines) {
    const L = text.split('\n');
    const wi = L.findIndex(l => /^\s*[-*]\s+体重\s*[:：]?\s*\d/.test(l));
    if (wi >= 0) { L.splice(wi, 1, lines[0]); const fi = L.findIndex(l => /^\s*[-*]\s+体脂肪/.test(l)); if (lines[1]) { if (fi >= 0) L.splice(fi, 1, lines[1]); else L.splice(wi + 1, 0, lines[1]); } return L.join('\n'); }
    const h = L.findIndex(l => /^#{1,6}\s+メモ\s*$/.test(l));
    if (h < 0) return text.replace(/\n*$/, '') + '\n\n## メモ\n' + lines.join('\n') + '\n';
    let at = h + 1;
    if (L[at] != null && /^\s*-\s*$/.test(L[at])) L.splice(at, 1);   // テンプレートの空の「- 」
    L.splice(at, 0, ...lines);
    return L.join('\n');
  }

  // ================= 睡眠の質 =================
  // 1晩の点数（目安・100点）：長さ 40・深い睡眠 20・レム 20・途中で起きた時間 10・寝る時刻のそろい方 10
  // 内訳（深い・コア・レム）がない日は点数を出さない（長さだけでは「質」がわからないので）
  let sleepView = null;          // night：1晩の流れ／line：1日ごとの線／parts：積み上げの棒／time：寝た〜起きた時刻（null：流れがあれば night）
  let sleepSel = null;           // 選んだ日
  const SC = { deep: '#4f46e5', core: '#60a5fa', rem: '#22d3ee', awake: '#fb923c', plain: '#818cf8' };
  const SN = { deep: '深い', core: 'ノンレム（浅い）', rem: 'レム', awake: '途中で起きた' };
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromEve = t => (toMin(t) - 18 * 60 + 1440) % 1440;     // 夕方6時からの分（夜をまたいでも順になる）
  const clock = m => { const x = (m + 18 * 60) % 1440; return `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`; };
  const hmS = m => m == null ? '—' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  function sleepNight(H, d) {
    const o = H.days.find(x => x.date === d);
    if (!o || (o.sleep == null && o.deep == null && o.bed == null)) return null;
    const hasParts = o.deep != null || o.rem != null || o.core != null;
    const asleep = hasParts ? (o.deep || 0) + (o.core || 0) + (o.rem || 0) : o.sleep;
    return { date: d, asleep, deep: o.deep, core: o.core, rem: o.rem, awake: o.awake, bed: o.bed, wake: o.wake, hasParts };
  }
  function sleepScore(n, prevBeds) {
    if (!n || !n.hasParts || !n.asleep) return null;
    const r = [];
    const dur = n.asleep;
    const pDur = dur >= 420 && dur <= 540 ? 40 : dur < 420 ? Math.max(0, 40 * (dur - 300) / 120) : Math.max(25, 40 - (dur - 540) / 6);   // 5時間で0・7〜9時間で満点
    r.push(['長さ', pDur, 40, dur >= 420 ? '7時間以上' : `7時間まで あと ${hmS(420 - dur)}`]);
    const dp = (n.deep || 0) / dur * 100, rp = (n.rem || 0) / dur * 100;
    const pDeep = Math.max(0, Math.min(20, (dp - 5) / 10 * 20)), pRem = Math.max(0, Math.min(20, (rp - 10) / 10 * 20));   // 深い 15%・レム 20% で満点
    r.push(['深い睡眠', pDeep, 20, `${dp.toFixed(0)}%（目安 15〜25%）`]);
    r.push(['レム睡眠', pRem, 20, `${rp.toFixed(0)}%（目安 20〜25%）`]);
    const aw = n.awake ?? 0, pAw = aw <= 10 ? 10 : Math.max(0, 10 - (aw - 10) / 5);   // 10分まで満点・60分で0
    r.push(['途中で起きた', pAw, 10, `${Math.round(aw)}分`]);
    let pReg = 10, regTxt = 'くらべる日がまだない';
    if (n.bed && prevBeds.length >= 2) {
      const avgB = prevBeds.reduce((a, b) => a + b, 0) / prevBeds.length, diff = Math.abs(fromEve(n.bed) - avgB);
      pReg = diff <= 30 ? 10 : Math.max(0, 10 - (diff - 30) / 9); regTxt = `いつもより ${Math.round(diff)}分 ${fromEve(n.bed) > avgB ? 'おそい' : 'はやい'}`;
    } else if (!n.bed) regTxt = '寝た時刻がない';
    r.push(['寝る時刻', pReg, 10, regTxt]);
    return { total: Math.round(r.reduce((a, x) => a + x[1], 0)), parts: r };
  }
  function sleepCard(H, range) {
    const c = el('div', 'fCard sCard');
    const view = sleepView || (H.segs.size ? 'night' : 'line');
    const nights = range.map(d => sleepNight(H, d));
    const beds = [];   // その日より前の7晩の寝た時刻
    const scored = nights.map((n, i) => {
      const prev = nights.slice(Math.max(0, i - 7), i).filter(x => x && x.bed).map(x => fromEve(x.bed));
      return n ? { ...n, score: sleepScore(n, prev) } : null;
    });
    const ok = scored.filter(Boolean);
    const hd = el('div', 'fHead');
    hd.append(el('h3', '', '睡眠の質'));
    const seg = el('div', 'seg hSeg');
    [...(H.segs.size ? [['night', '1晩']] : []), ['line', '線'], ['parts', '積み上げ'], ['time', '時間帯']].forEach(([v, l]) => seg.append(btn(view === v ? 'on' : '', l, () => { sleepView = v; render(); })));
    hd.append(seg); c.append(hd);
    if (!ok.length) {
      c.append(el('p', 'fSub', 'その朝に起きた日に入ります'), el('div', 'fEmpty', 'まだ睡眠の記録がありません。iPhone のショートカットで、睡眠の合計・内訳（深い・コア・レム・覚醒）・寝た時刻と起きた時刻を送ると、ここに大きく出ます'));
      const hn = Object.keys(S.files).find(p => nameOf(p) === 'ヘルスケア連携');
      if (hn) c.append(btn('btn small white', ['book-open', '作り方を見る'], () => openNote(hn)));
      return c;
    }
    // まとめの数字
    const avgOf = f => { const v = ok.map(f).filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const withP = ok.filter(n => n.hasParts && n.asleep);
    const bedsM = ok.filter(n => n.bed).map(n => fromEve(n.bed)), wakesM = ok.filter(n => n.wake).map(n => fromEve(n.wake));
    const sd2 = a => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    const stats = el('div', 'sStats');
    const st = (label, val, note, color) => { const d = el('div', 'sStat'); if (color) d.style.setProperty('--c', color); d.append(el('small', '', label), el('b', '', val)); if (note) d.append(el('span', '', note)); stats.append(d); };
    const sc = avgOf(n => n.score?.total);
    if (sc != null) st('点数（平均）', `${Math.round(sc)}点`, '目安・100点', sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444');
    st('睡眠（平均）', hmS(avgOf(n => n.asleep)), `${ok.filter(n => n.asleep >= 420).length}/${ok.length}晩が7時間以上`);
    if (withP.length) {
      st('深い睡眠', `${(avgOf(n => n.hasParts ? (n.deep || 0) / n.asleep * 100 : null)).toFixed(0)}%`, `平均 ${hmS(avgOf(n => n.hasParts ? n.deep : null))}`, SC.deep);
      st('レム睡眠', `${(avgOf(n => n.hasParts ? (n.rem || 0) / n.asleep * 100 : null)).toFixed(0)}%`, `平均 ${hmS(avgOf(n => n.hasParts ? n.rem : null))}`, SC.rem);
      st('途中で起きた', `${Math.round(avgOf(n => n.awake) || 0)}分`, '1晩の平均', SC.awake);
    }
    if (bedsM.length) st('寝た時刻', clock(bedsM.reduce((a, b) => a + b, 0) / bedsM.length), sd2(bedsM) != null ? `ばらつき ±${Math.round(sd2(bedsM))}分` : '平均');
    if (wakesM.length) st('起きた時刻', clock(wakesM.reduce((a, b) => a + b, 0) / wakesM.length), sd2(wakesM) != null ? `ばらつき ±${Math.round(sd2(wakesM))}分` : '平均');
    c.append(stats);
    // 凡例
    const lg = el('div', 'sLegend');
    if (view !== 'time') {
      if (withP.length) ['deep', 'core', 'rem', 'awake'].forEach(k => { const s2 = el('span'); s2.style.setProperty('--c', SC[k]); s2.append(SN[k]); lg.append(s2); });
      else { const s2 = el('span'); s2.style.setProperty('--c', SC.plain); s2.append('睡眠（内訳はまだありません）'); lg.append(s2); }
      lg.append(el('em', '', view === 'night' ? '1晩の流れ（‹ › で日を変える）' : view === 'parts' ? '点線：7時間' : '点：その日の数字（押すとくわしく）'));
    } else lg.append(el('em', '', '棒：寝た時刻 〜 起きた時刻（上がよる、下があさ）'));
    c.append(lg);
    let sel = (sleepSel && scored.find(n => n && n.date === sleepSel)) || [...scored].reverse().find(Boolean);
    if (view === 'night') {   // 流れのある晩だけ（期間の外でもよい）
      const ds = [...H.segs.keys()].sort(), d = sleepSel && H.segs.has(sleepSel) ? sleepSel : sel && H.segs.has(sel.date) ? sel.date : ds[ds.length - 1];
      sel = scored.find(n => n && n.date === d) || { ...(sleepNight(H, d) || { date: d, asleep: H.segs.get(d).filter(x => x.st !== 'awake').reduce((t, x) => t + x.b - x.a, 0) }), score: null };
    }
    c.append(view === 'night' ? sleepHypno(H, sel) : view === 'line' ? sleepLineChart(scored, sel) : view === 'parts' ? sleepPartsChart(scored, sel) : sleepTimeChart(scored, sel));
    c.append(sleepDetail(sel));
    return c;
  }
  // 1晩の流れ：横が時刻、段が 覚醒・レム・ノンレム（浅い）・深い（ヘルスケアアプリの睡眠のグラフと同じ見方）
  function sleepHypno(H, n) {
    const box = el('div', 'sHypWrap');
    const ds = [...H.segs.keys()].sort(), i = ds.indexOf(n.date), segs = H.segs.get(n.date);
    const nav = el('div', 'sNav');
    const go = d => { sleepSel = d; render(); };
    const pb = btn('sNavB', '‹', () => go(ds[i - 1]), '前の晩'), nb = btn('sNavB', '›', () => go(ds[i + 1]), '次の晩');
    pb.disabled = i <= 0; nb.disabled = i >= ds.length - 1;
    const ttl = el('div', 'sNavT'); ttl.append(el('b', '', hm(n.asleep)), el('span', '', `${md(n.date)} の朝`));
    nav.append(pb, ttl, nb); box.append(nav);
    const ROW = { awake: 0, rem: 1, core: 2, asleep: 2, deep: 3 }, RH = 58;
    const t0 = Math.floor(segs[0].a / 60) * 60, t1 = Math.ceil(Math.max(...segs.map(x => x.b)) / 60) * 60, span = t1 - t0 || 60;
    const pc = t => ((t - t0) / span) * 100 + '%';
    const plot = el('div', 'sHyp'); plot.style.height = RH * 4 + 'px';
    ['awake', 'rem', 'core', 'deep'].forEach((k, r) => { const row = el('div', 'sHRow'); row.append(el('span', '', k === 'awake' ? '覚醒' : SN[k])); row.style.top = r * RH + 'px'; row.style.height = RH + 'px'; plot.append(row); });
    const step = span > 600 ? 180 : span > 300 ? 120 : 60, tfmt = t => { const d = new Date(t * 60000); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const ax = el('div', 'sHAx');
    for (let t = t0; t <= t1; t += step) { const g = el('i', 'sHG'); g.style.left = pc(t); plot.append(g); const l = el('span', '', tfmt(t)); l.style.left = pc(t); ax.append(l); }
    // 段をつなぐ細い線（先に置いて、ブロックの下にする）
    segs.forEach((x, j) => {
      const y = segs[j + 1]; if (!y || y.a - x.b > 5 || ROW[x.st] === ROW[y.st]) return;
      const r1 = Math.min(ROW[x.st], ROW[y.st]), r2 = Math.max(ROW[x.st], ROW[y.st]);
      const c = el('i', 'sHC'); c.style.left = pc(x.b); c.style.top = r1 * RH + RH / 2 + 'px'; c.style.height = (r2 - r1) * RH + 'px'; plot.append(c);
    });
    for (const x of segs) {
      const b = el('i', 'sSeg'); b.style.left = pc(x.a); b.style.width = `max(3px, ${((x.b - x.a) / span) * 100}%)`; b.style.top = ROW[x.st] * RH + 9 + 'px'; b.style.height = RH - 18 + 'px';
      b.style.background = SC[x.st] || SC.plain;
      b.title = `${x.st === 'awake' ? '覚醒' : SN[x.st] || '睡眠'}  ${tfmt(x.a)}〜${tfmt(x.b)}（${Math.round(x.b - x.a)}分）`;
      plot.append(b);
    }
    box.append(plot, ax);
    return box;
  }
  // 線：1日ごとに 深い・ノンレム（浅い）・レム・途中で起きた を線でつなぐ（体重のグラフと同じ見方）
  function sleepLineChart(ns, sel) {
    const box = el('div', 'sChart');
    const n = ns.length, W = 600, HH = 300;
    const anyParts = ns.some(x => x && x.hasParts);
    const keys = anyParts ? ['core', 'rem', 'deep', 'awake'] : ['plain'];
    const val = (x, k) => !x ? null : k === 'plain' ? x.asleep : x.hasParts ? (x[k] ?? null) : null;
    const all = ns.flatMap(x => keys.map(k => val(x, k))).filter(v => v != null);
    const max = Math.max(60, ...all) * 1.1;
    const X = i => ((i + 0.5) / n) * W, Y = v => HH - (v / max) * HH;
    const plot = el('div', 'sPlot line');
    const step = max > 300 ? 120 : 60;
    for (let m = step; m < max; m += step) { const g = el('span', 'sGuide'); g.style.bottom = (m / max) * 100 + '%'; g.dataset.t = `${m / 60}時間`; plot.append(g); }
    let svg = `<svg viewBox="0 0 ${W} ${HH}" preserveAspectRatio="none" aria-hidden="true">`;
    const dots = el('div', 'sDots');
    for (const k of keys) {
      const pts = ns.map((x, i) => (val(x, k) != null ? [X(i), Y(val(x, k))] : null)).filter(Boolean);
      if (pts.length > 1) svg += `<path class="sL fGlow" d="${smoothPath(pts)}" fill="none" stroke="${SC[k]}" stroke-width="2.4" vector-effect="non-scaling-stroke" style="--g:${SC[k]}"/>`;
      if (n <= 45 || pts.length === 1) pts.forEach(([x, y]) => { const d = el('i'); d.style.left = (x / W) * 100 + '%'; d.style.top = (y / HH) * 100 + '%'; d.style.setProperty('--c', SC[k]); dots.append(d); });
    }
    plot.innerHTML += svg + '</svg>';
    plot.append(dots);
    const vl = el('i', 'sVl'); vl.hidden = true;
    const selI = sel ? ns.findIndex(x => x && x.date === sel.date) : -1;
    if (selI >= 0) { const sv = el('i', 'sVl on'); sv.style.left = (X(selI) / W) * 100 + '%'; plot.append(sv); }
    const tip = el('div', 'fTip sTip'); tip.hidden = true;
    plot.append(vl, tip);
    let raf = 0, lastX = 0;
    const idx = () => { const r = plot.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor(((lastX - r.left) / r.width) * n))); };
    const at = () => {
      raf = 0;
      const r = plot.getBoundingClientRect(), i = idx(), x = ns[i];
      if (!x) { tip.hidden = vl.hidden = true; return; }
      const px = (X(i) / W) * r.width;
      tip.hidden = vl.hidden = false;
      vl.style.left = px + 'px';
      tip.textContent = `${md(x.date)}  ` + (x.hasParts ? ['deep', 'core', 'rem', 'awake'].map(k => `${SN[k]} ${hmS(x[k] ?? 0)}`).join('・') : `睡眠 ${hmS(x.asleep)}`);
      const half = tip.offsetWidth / 2 + 4;
      tip.style.left = Math.max(half, Math.min(r.width - half, px)) + 'px'; tip.style.top = '0px';
    };
    plot.addEventListener('pointermove', e => { lastX = e.clientX; if (!raf) raf = requestAnimationFrame(at); });
    plot.addEventListener('pointerleave', () => { tip.hidden = vl.hidden = true; });
    plot.addEventListener('click', e => { lastX = e.clientX; const x = ns[idx()]; if (x) { sleepSel = x.date; render(); } });
    box.append(plot, sleepAxis(ns));
    return box;
  }
  // 内訳：積み上げの棒（下から 深い・コア・レム、いちばん上に 途中で起きた）
  function sleepPartsChart(ns, sel) {
    const box = el('div', 'sChart');
    const max = Math.max(540, ...ns.filter(Boolean).map(n => n.asleep + (n.awake || 0))) * 1.05;
    const plot = el('div', 'sPlot');
    [360, 420, 480].forEach(m => { const g = el('span', 'sGuide' + (m === 420 ? ' main' : '')); g.style.bottom = (m / max) * 100 + '%'; g.dataset.t = `${m / 60}時間`; plot.append(g); });
    const bw = ns.length > 45 ? ' thin' : '';
    ns.forEach((n, i) => {
      const col = el('button', 'sCol' + bw + (n && sel && n.date === sel.date ? ' sel' : '')); col.type = 'button';
      if (n) {
        col.addEventListener('click', () => { sleepSel = n.date; render(); });
        col.title = `${md(n.date)}  ${hmS(n.asleep)}${n.score ? `・${n.score.total}点` : ''}`;
        const stack = el('span', 'sStack'); stack.style.height = ((n.asleep + (n.awake || 0)) / max) * 100 + '%';
        const segs = n.hasParts ? [['awake', n.awake], ['rem', n.rem], ['core', n.core], ['deep', n.deep]] : [['plain', n.asleep]];
        const tot = n.asleep + (n.awake || 0);
        for (const [k, v] of segs) { if (!v) continue; const s2 = el('i'); s2.style.flexGrow = v / tot; s2.style.background = SC[k]; stack.append(s2); }
        col.append(stack);
        if (n.score && ns.length <= 31) col.append(el('b', 'sScore' + (n.score.total >= 80 ? ' g' : n.score.total < 60 ? ' r' : ''), String(n.score.total)));
      } else col.disabled = true;
      plot.append(col);
    });
    box.append(plot, sleepAxis(ns));
    return box;
  }
  // 時間帯：寝た時刻 〜 起きた時刻の棒
  function sleepTimeChart(ns, sel) {
    const box = el('div', 'sChart');
    const has = ns.filter(n => n && n.bed && n.wake);
    if (!has.length) { box.append(el('div', 'fEmpty', '寝た時刻と起きた時刻がまだありません（ショートカットで bed_time・wake_time を送ると出ます）')); return box; }
    let lo = Math.min(...has.map(n => fromEve(n.bed))), hi = Math.max(...has.map(n => fromEve(n.wake)));
    lo = Math.floor((lo - 30) / 60) * 60; hi = Math.ceil((hi + 30) / 60) * 60;
    const span = hi - lo || 60;
    const plot = el('div', 'sPlot time');
    for (let m = lo; m <= hi; m += 60) { if ((m - lo) % (span > 720 ? 120 : 60)) continue; const g = el('span', 'sGuide' + (clock(m) === '0:00' ? ' main' : '')); g.style.top = ((m - lo) / span) * 100 + '%'; g.dataset.t = clock(m); plot.append(g); }
    const bw = ns.length > 45 ? ' thin' : '';
    ns.forEach(n => {
      const col = el('button', 'sCol' + bw + (n && sel && n.date === sel.date ? ' sel' : '')); col.type = 'button';
      if (n && n.bed && n.wake) {
        col.addEventListener('click', () => { sleepSel = n.date; render(); });
        col.title = `${md(n.date)}  ${n.bed} 〜 ${n.wake}`;
        let a = fromEve(n.bed), b = fromEve(n.wake); if (b < a) b = a;
        const bar = el('span', 'sRange'); bar.style.top = ((a - lo) / span) * 100 + '%'; bar.style.height = Math.max(2, ((b - a) / span) * 100) + '%';
        bar.style.background = `linear-gradient(${SC.plain}, ${SC.deep})`;
        col.append(bar);
      } else col.disabled = !n;
      plot.append(col);
    });
    box.append(plot, sleepAxis(ns));
    return box;
  }
  function sleepAxis(ns) {
    const ax = el('div', 'sAxis'), every = Math.ceil(ns.length / (isWide() ? 8 : 5));
    const range = ns.map((n, i) => n?.date);
    const first = ns.findIndex(Boolean);
    ns.forEach((n, i) => ax.append(el('span', '', (ns.length - 1 - i) % every === 0 ? sd(range[i] || addDays(ns[first]?.date || todayKey(), i - first)) : '')));
    return ax;
  }
  // 選んだ晩のくわしい中身
  function sleepDetail(n) {
    const d = el('div', 'sDetail');
    if (!n) return d;
    const hd = el('div', 'sDHd');
    hd.append(el('b', '', `${md(n.date)} の朝`), el('span', 'fSub', [n.bed && n.wake ? `${n.bed} に寝て ${n.wake} に起きた` : '', `眠っていた時間 ${hm(n.asleep)}`].filter(Boolean).join('・')));
    if (n.score) { const s2 = el('span', 'sBig' + (n.score.total >= 80 ? ' g' : n.score.total < 60 ? ' r' : ''), String(n.score.total)); s2.append(el('small', '', '点')); hd.prepend(s2); }
    d.append(hd);
    if (n.hasParts) {
      const tot = n.asleep + (n.awake || 0);
      const bar = el('div', 'sBar');
      ['deep', 'core', 'rem', 'awake'].forEach(k => { if (!n[k]) return; const s2 = el('i'); s2.style.flexGrow = n[k] / tot; s2.style.background = SC[k]; s2.title = `${SN[k]} ${hmS(n[k])}`; bar.append(s2); });
      d.append(bar);
      const ls = el('div', 'sParts');
      ['deep', 'core', 'rem', 'awake'].forEach(k => { const x = el('div'); x.style.setProperty('--c', SC[k]); x.append(el('small', '', SN[k]), el('b', '', hmS(n[k] ?? 0)), el('span', '', k === 'awake' ? '' : `${((n[k] || 0) / n.asleep * 100).toFixed(0)}%`)); ls.append(x); });
      d.append(ls);
    } else d.append(el('p', 'fSub', '内訳（深い・コア・レム）がないので、点数は出していません'));
    if (n.score) {
      const sp = el('div', 'sWhy');
      n.score.parts.forEach(([l, p, mx, note]) => { const r = el('div'); const m = el('span', 'm'); const f = el('i'); f.style.width = (p / mx) * 100 + '%'; m.append(f); r.append(el('small', '', l), m, el('b', '', `${Math.round(p)}/${mx}`), el('span', 'n', note)); sp.append(r); });
      d.append(sp, el('p', 'sNote', '点数はこのアプリの目安です（長さ40・深い20・レム20・途中で起きた10・寝る時刻のそろい方10）。ウォッチの測り方で数字は変わります'));
    }
    return d;
  }

  // ================= 気分 =================
  // 書き方（Workstation でも TEDDY でも同じ）：デイリーノートの「メモ」に - 気分 4/5 ひとこと
  function moodCard(H, range) {
    const c = el('div', 'fCard mdCard');
    const hd = el('div', 'fHead');
    hd.append(el('h3', '', '気分'), btn('btn small white', ['plus', '書く'], () => moodSheet()));
    c.append(hd, el('p', 'fSub', '1〜5（5がとても良い）。点：その日の平均・線：7日平均'));
    const byDate = new Map(H.days.map(d => [d.date, d]));
    const pts = range.map(k => ({ date: k, v: byDate.get(k)?.mood ?? null, avg: avg7(H.days, 'mood', k), moods: byDate.get(k)?.moods || [] }));
    const md2 = H.days.filter(d => d.mood != null);
    if (!pts.some(p => p.v != null)) {
      c.append(el('div', 'fEmpty', 'この期間の気分はまだありません。上の「書く」か、TEDDY に「今日の気分は4、よく眠れた」のように頼むと入ります（デイリーノートに「- 気分 4/5 ひとこと」と書きます）'));
      return c;
    }
    // グラフ
    const W = 600, HH = 200, n = pts.length, X = i => ((i + 0.5) / n) * W, Y = v => HH - 10 - ((v - 1) / 4) * (HH - 20);
    const box = el('div', 'mdPlot');
    const avg = pts.map((p, i) => (p.avg != null ? [X(i), Y(p.avg)] : null)).filter(Boolean);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${HH}" preserveAspectRatio="none" aria-hidden="true"><g class="fGrid">${[1, 2, 3, 4, 5].map(v => `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>${avg.length > 1 ? `<path d="${smoothPath(avg)}" fill="none" stroke="#facc15" stroke-width="2.2" vector-effect="non-scaling-stroke" class="fGlow" style="--g:#facc15"/>` : ''}</svg>`;
    const ax = el('div', 'mdAx'); MOODS.forEach(([v, e]) => { const s2 = el('span', '', e); s2.style.top = (Y(v) / HH) * 100 + '%'; ax.append(s2); });
    const dots = el('div', 'hDots mdDots');
    pts.forEach((p, i) => { if (p.v == null) return; const d = el('i'); d.style.left = (X(i) / W) * 100 + '%'; d.style.top = (Y(p.v) / HH) * 100 + '%'; d.style.background = moodOf(p.v)[3]; d.style.boxShadow = 'none'; dots.append(d); });
    const tip = el('div', 'fTip'); tip.hidden = true;
    box.append(ax, dots, tip);
    let raf = 0, lastX = 0;
    const at = () => {
      raf = 0;
      const r = box.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor(((lastX - r.left) / r.width) * n))), p = pts[i];
      if (p.v == null) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.textContent = `${md(p.date)}  ${p.moods.map(m => moodOf(m.v)[1] + (m.note ? ' ' + m.note : '')).join(' / ')}`;
      const px = (X(i) / W) * r.width, half = Math.min(tip.offsetWidth / 2 + 4, r.width / 2);
      tip.style.left = Math.max(half, Math.min(r.width - half, px)) + 'px'; tip.style.top = Math.max(0, (Y(p.v) / HH) * r.height - 40) + 'px';
    };
    box.addEventListener('pointermove', e => { lastX = e.clientX; if (!raf) raf = requestAnimationFrame(at); });
    box.addEventListener('pointerdown', e => { lastX = e.clientX; if (!raf) raf = requestAnimationFrame(at); });
    box.addEventListener('pointerleave', () => { tip.hidden = true; });
    c.append(box);
    // くらべてみる（その日の気分の平均を、条件ごとに）
    const cmp = (label, yes, no, a, b) => {
      const A = md2.filter(yes).map(d => d.mood), B = md2.filter(no).map(d => d.mood);
      if (A.length < 3 || B.length < 3) return null;
      const ma = A.reduce((x, y) => x + y, 0) / A.length, mb = B.reduce((x, y) => x + y, 0) / B.length;
      const r = el('div', 'mdCmp');
      r.append(el('small', '', label), el('span', '', `${a} ${moodOf(ma)[1]} ${ma.toFixed(1)}（${A.length}日）`), el('span', '', `${b} ${moodOf(mb)[1]} ${mb.toFixed(1)}（${B.length}日）`));
      const df = ma - mb; r.append(el('b', Math.abs(df) < 0.2 ? '' : df > 0 ? 'g' : 'r', Math.abs(df) < 0.05 ? '±0.0' : `${df > 0 ? '+' : '−'}${Math.abs(df).toFixed(1)}`));
      return r;
    };
    const liftDays = new Set(H.sessions.map(x => x.date));
    const rows = [
      cmp('睡眠', d => d.sleep >= 420, d => d.sleep != null && d.sleep < 420, '7時間以上', '7時間未満'),
      cmp('筋トレ', d => liftDays.has(d.date), d => !liftDays.has(d.date), 'した日', 'しない日'),
      cmp('歩数', d => d.steps >= 8000, d => d.steps != null && d.steps < 8000, '8000歩以上', '未満'),
    ].filter(Boolean);
    if (rows.length) { const cw = el('div', 'mdCmps'); cw.append(el('p', 'hLbl', 'くらべてみる（気分の平均）'), ...rows); c.append(cw); }
    // 最近の記録
    const list = el('div', 'mdList');
    const recent = H.days.filter(d => d.moods).slice(-6).reverse();
    for (const d of recent) for (const m of d.moods.slice().reverse()) {
      const r = btn('fRec mdRec', [], () => openNote(m.path), 'ノートを開く');
      const ic = el('span', 'mdFace', moodOf(m.v)[1]);
      const nm = el('span', 'fRn'); nm.append(el('b', '', m.note || moodOf(m.v)[2]), el('small', '', m.note ? `${md(d.date)}・${moodOf(m.v)[2]}` : md(d.date)));
      r.append(ic, nm, el('span', 'fRa', `${m.v} / 5`));
      list.append(r);
    }
    c.append(el('p', 'hLbl', '最近の記録'), list);
    return c;
  }
  // 顔のボタン（ホームでも使う）。押した数字を on に
  function moodFaces(cur, onPick) {
    const f = el('div', 'mdFaces');
    MOODS.forEach(([v, e, l, col]) => {
      const b = btn('mdF' + (cur === v ? ' on' : ''), [], () => onPick(v), `${l}（${v}）`);
      b.style.setProperty('--c', col); b.append(el('span', 'e', e), el('small', '', l));
      f.append(b);
    });
    return f;
  }
  // 今日のデイリーノートの「メモ」に - 気分 4/5 ひとこと を足す
  async function writeMood(v, note) {
    const tk = todayKey(), line = `- 気分 ${v}/5${note ? ' ' + note.replace(/\s+/g, ' ').trim() : ''}`;
    const ok = await edit(dailyPathOf(tk), t => appendToMemo(t == null ? newDailyText(tk) : t, [line]), `気分: ${v}/5`);
    if (ok) toast(`気分 ${moodOf(v)[1]} を書きました`);
    return ok;
  }
  function moodSheet() {
    const inn = $('#sheetIn');
    sheetHead(inn, '気分を書く');
    let val = null;
    const memo = el('input', 'inp'); memo.placeholder = 'ひとこと（なくても可）例：よく眠れた・仕事でつかれた';
    const faces = () => moodFaces(val, v => { val = v; fw.replaceChildren(faces()); });
    const fw = el('div'); fw.append(faces());
    const lbl = el('label', 'fld'); lbl.append(el('span', '', 'ひとこと'), memo);
    inn.append(fw, lbl, el('div', 'hint sub', `${relDay(todayKey())}のデイリーノートの「メモ」に「- 気分 4/5 ひとこと」と書きます。1日に何回書いてもよく、その日の平均で見ます`));
    const bs = el('div', 'shBtns');
    const save = async () => { if (!val) { fw.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 200); return; } sheet.close(); await writeMood(val, memo.value); };
    bs.append(btn('btn primary', ['check', '書く'], save));
    memo.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) save(); });
    inn.append(bs);
    sheet.showModal();
  }
  // ホームの「今日の気分」：顔を押すとすぐ書く
  function moodWidget(card) {
    const tk = todayKey(), d = healthData().days.find(x => x.date === tk);
    const last = d?.moods?.[d.moods.length - 1];
    card.classList.add('mdW');
    card.append(moodFaces(last?.v, v => writeMood(v, '')));
    card.append(el('p', 'mdWSub', last ? `今日 ${d.moods.length}回・最後は ${moodOf(last.v)[2]}${last.note ? '「' + last.note + '」' : ''}` : 'いまの気分を押すと、今日のノートに書きます'));
    return card;
  }
  // 「## メモ」の終わりに足す（なければ作る）
  function appendToMemo(text, lines) {
    const L = text.split('\n');
    const h = L.findIndex(l => /^#{1,6}\s+メモ\s*$/.test(l));
    if (h < 0) return text.replace(/\n*$/, '') + '\n\n## メモ\n' + lines.join('\n') + '\n';
    let end = L.findIndex((l, i) => i > h && /^#{1,6}\s/.test(l)); if (end < 0) end = L.length;
    for (let i = end - 1; i > h; i--) if (/^\s*-\s*$/.test(L[i])) { L.splice(i, 1); end--; }   // テンプレートの空の「- 」
    let at = end; while (at > h + 1 && !L[at - 1].trim()) at--;
    L.splice(at, 0, ...lines);
    return L.join('\n');
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
    const hm2 = el('div', 'db-mood'); hm2.append(el('div', 'db-moodT', '今日の気分')); moodWidget(hm2);
    ht.append(hm2);
    hero.append(ht, ks);
    grid.append(hero);
    { const hs = hbStrip(el('section', 'db-card')); if (hs) grid.append(hs); }
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
    if (showPlanWidget()) {
      // 3つ並べる（今日の予定・これから7日・出費の予定）
      cs.classList.replace('c3h', 'c3'); cn.classList.replace('c3h', 'c3');
      const cm = dbCard('c3 db-plans', 'wallet', '出費の予定', 'お金', () => switchTab('money'));
      cm.querySelector('.db-head').insertBefore(btn('db-more', ['plus', '足す'], () => planSheet(t)), cm.querySelector('.db-more'));
      grid.append(cs, cn, planWidget(cm));
    } else grid.append(cs, cn);
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
  const TAB_ICON = { home: 'house', todo: 'list-todo', proj: 'folder-kanban', cal: 'calendar-days', habits: 'calendar-check', notes: 'notebook-text', graph: 'orbit', money: 'wallet', health: 'heart-pulse', sync: 'refresh-cw' };
  let noteDay = null, noteFolder = null;   // ノート一覧の絞り込み（サイドバーから）

  function railBtn(t) {
    const b = btn('railBtn' + (tab === t ? ' on' : ''), [], () => switchTab(t), TITLES[t]);
    b.dataset.tab = t;
    const ric = el('span', 'ric'); ric.innerHTML = icon(TAB_ICON[t]);
    if (t === 'sync') { const bd = $('#syncBadge'); if (bd && !bd.hidden) ric.append(el('i', 'badge', bd.textContent)); }
    b.append(ric, el('span', 'rname', TITLES[t]));
    return b;
  }
  function renderRail() {
    const a = $('#railApps'); a.innerHTML = '';
    ['home', 'todo', 'proj', 'cal', 'habits', 'notes', 'graph', 'money', 'health'].forEach(t => a.append(railBtn(t)));
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
    } else if (tab === 'money') {
      const gs = goals();
      sb.append(sideTitle('貯金の目標'));
      const n = el('nav', 'navCard');
      if (!gs.length) n.append(el('div', 'noData', '目標はまだありません'));
      gs.forEach(g => n.append(nav('target', g.name, g.target ? Math.round((g.saved / g.target) * 100) + '%' : '', false, () => openNote(g.path))));
      n.append(btn('btn white wide', ['plus', '目標をつくる'], () => newGoal()));
      sb.append(n);
      sb.append(sideTitle('読むもの・書き方'));
      const h = el('div', 'navCard fHelp');
      h.innerHTML = '<p>家計のデータは <code>Data/kakei.json</code>（マネーフォワードから作る）を読みます</p><p>ノートに書いた分も足されます：<code>- 💸 1,200 ランチ #食費</code>（出費）・<code>- 💰 250,000 給料</code>（収入）・<code>- 🏦 30,000 [[引越し貯金]]</code>（目標へ）</p><p>目標：ノートの先頭に <code>target: 400000</code>・<code>saved: 170000</code>・<code>due: 2027-04-30</code></p>';
      sb.append(h);
    } else if (tab === 'habits') {
      sb.append(hbTodayPanel());
      const n = el('nav', 'navCard');
      n.append(nav('tree-palm', '休みの日', `${hbData().off.size}日`, false, () => offSheet()));
      if (S.files[HB_FILE]) n.append(nav('notebook-text', '毎日確認.md', '項目と休みの日', false, () => openNote(HB_FILE)));
      sb.append(n);
    } else if (tab === 'health') {
      const H = healthData();
      sb.append(btn('btn primary wide', ['smile', '気分を書く'], () => moodSheet()), btn('btn white wide', ['scale', '体重を書く'], () => weightSheet()));
      if (H.goal) {
        sb.append(sideTitle('目標'));
        const n = el('nav', 'navCard');
        n.append(nav('target', nameOf(H.goal.path), `${H.goal.weight}kg${H.goal.due ? '・' + sd(H.goal.due) : ''}`, false, () => openNote(H.goal.path)));
        sb.append(n);
      }
      const notes = ['体の記録', '筋トレの記録', '筋トレの計画', 'ヘルスケア連携', '筋トレ連携'].map(nm => Object.keys(S.files).find(p => nameOf(p) === nm)).filter(Boolean);
      if (notes.length) {
        sb.append(sideTitle('ノート'));
        const n = el('nav', 'navCard');
        notes.forEach(p => n.append(nav('notebook-text', nameOf(p), '', false, () => openNote(p))));
        sb.append(n);
      }
      sb.append(sideTitle('読むもの・書き方'));
      const h = el('div', 'navCard fHelp');
      h.innerHTML = '<p>体重はデイリーノートの「メモ」に <code>- 体重 70.5kg</code>（体脂肪は <code>- 体脂肪 18%</code>）</p><p>気分は <code>- 気分 4/5 ひとこと</code>（1〜5。TEDDY に頼んでも同じ形で入ります）</p><p>睡眠・歩数・心拍は iPhone のヘルスケア（<code>Data/health/health.csv</code>）、筋トレは筋トレメモ（<code>Data/kintore/sets.csv</code>）から読みます</p><p>目標：ノートの先頭に <code>goal_weight: 67</code>・<code>goal_due: 2027-02-28</code>（本文の「目標：67kg（2027-02-28）」も読みます）</p>';
      sb.append(h);
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
    ({ home: renderHome, todo: renderTodo, proj: renderProj, cal: renderCal, habits: renderHabits, notes: renderNotes, graph: renderGraph, money: renderMoney, health: renderHealth, sync: renderSync })[tab](main);
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

  const TITLES = { home: 'ホーム', todo: 'やること', proj: 'プロジェクト', cal: 'カレンダー', habits: '毎日確認', notes: 'ノート', graph: 'つながり', money: 'お金', health: 'ヘルス', sync: '同期' };
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
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    // 下のメニューが入りきらないとき：選んでいるタブが見えるようにスライド
    if (!isWide()) {
      const on = $('#tabs button.on'), tb = $('#tabs');
      if (on) requestAnimationFrame(() => {
        const l = on.offsetLeft, r = l + on.offsetWidth, pad = 28;
        if (l - pad < tb.scrollLeft) tb.scrollTo({ left: Math.max(0, l - pad), behavior: 'smooth' });
        else if (r + pad > tb.scrollLeft + tb.clientWidth) tb.scrollTo({ left: r + pad - tb.clientWidth, behavior: 'smooth' });
      });
    }
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
    ({ home: renderHome, todo: renderTodo, proj: renderProj, cal: renderCal, habits: renderHabits, notes: renderNotes, graph: renderGraph, money: renderMoney, health: renderHealth, sync: renderSync })[tab](main);
  }
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  // 下のメニュー：入りきらないときは左右にスライド。続きがある側の端をうすくする
  {
    const tb = $('#tabs');
    const edge = () => {
      const more = tb.scrollWidth > tb.clientWidth + 2;
      tb.classList.toggle('scrolls', more);
      tb.classList.toggle('atStart', tb.scrollLeft < 4);
      tb.classList.toggle('atEnd', tb.scrollLeft > tb.scrollWidth - tb.clientWidth - 4);
    };
    tb.addEventListener('scroll', edge, { passive: true });
    new ResizeObserver(edge).observe(tb);
    edge();
  }
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
