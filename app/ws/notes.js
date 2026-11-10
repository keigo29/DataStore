// MD Workstation 用のメモ：旧 Workstation（Mac 版）の src/renderer/notes.js をそのまま使っています。
// 変えたのは「// MDWS:」の印の行だけ（画像の表示・ない機能のボタンを出さない）。ファイルの読み書きは app.js の ctx.api.notes が受け持ちます。
// ノート（Obsidian のような Markdown ノート）
// ・ファイルは選んだフォルダの .md そのもの。Obsidian で同じフォルダを開いても読める
// ・書く／並べる／読む の3つの表示。[[リンク]]・バックリンク・タグ・見出し・コールアウト・==ハイライト==・チェックリスト
(() => {
  const { el, btn, withIcon, icon, toast, askText } = window.UI;
  let ctx = null, box = null, side = null;
  let info = { ready: false, root: '' };
  let data = { notes: [], files: [], folders: [] };
  let cur = null;                // { path, text, mtime, dirty, base }（base = 最後に読んだ／保存したときのファイルの中身）
  let saveTimer = null, renderTimer = null;
  let tagFilter = null;
  let activeFolder = '';         // サイドバーで選んでいるフォルダ（新しいノートはここに作る）
  const openFolders = new Set(['']);
  let started = false, startP = null, loaded = false;

  // ================= 横に並べて開く（VS Code のエディタグループのように） =================
  // ・列（ペイン）ごとに「開いているノート・表示・保存待ちのタイマー」を持つ。最大3列
  // ・ほかの関数は今までどおり cur / box を使う。列の中で入力・クリック・フォーカスなどが起きたら、
  //   先にその列を「今の列」に切りかえてから動く（そのため、どの列でも同じ機能がそのまま使える）
  window.ICONS['case-sensitive'] ||= '<path d="m3 15 4-8 4 8"/><path d="M4 13h6"/><circle cx="18" cy="12" r="3"/><path d="M21 9v6"/>';
  window.ICONS['regex'] ||= '<path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/><path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"/>';
  window.ICONS['replace'] ||= '<path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/><path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/><rect x="3" y="14" width="7" height="7" rx="1"/>';
  window.ICONS['replace-all'] ||= '<path d="M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/><path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/><path d="M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/><path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/><rect x="3" y="14" width="7" height="7" rx="1"/>';
  window.ICONS.keyboard ||= '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>';
  window.ICONS['text-search'] ||= '<path d="M21 6H3"/><path d="M10 12H3"/><path d="M10 18H3"/><circle cx="17" cy="15" r="3"/><path d="m21 19-1.9-1.9"/>';
  window.ICONS['square-split-horizontal'] ||= '<path d="M8 19H5c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2h3"/><path d="M16 5h3c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2h-3"/><line x1="12" x2="12" y1="4" y2="20"/>';
  const MAX_PANES = 3;
  let viewEl = null;                 // ノートの画面全体（#notesView）
  const panes = [];                  // { cur, mode, saveTimer, renderTimer, grow, el, head, body, sash }
  let active = null;
  let paneMode = null;               // 今の列の表示（edit / split / preview）。null なら設定のまま
  let chromeQueued = false;
  const curOf = p => (p === active ? cur : p.cur);
  function stash() { if (active) Object.assign(active, { cur, mode: paneMode, saveTimer, renderTimer }); }
  function use(p) {
    if (!p || p === active) return;
    stash();
    active = p;
    ({ cur, saveTimer, renderTimer } = p);
    paneMode = p.mode;
    box = p.body;
  }
  // 一時的にほかの列として動かす（終わったら元の列に戻す）
  function withPane(p, fn) {
    const prev = active;
    use(p);
    try { return fn(); } finally { if (prev && panes.includes(prev)) use(prev); }
  }
  // あとで動く処理（保存・表示のタイマー）を、今の列にひも付ける
  const bound = fn => { const p = active; return (...a) => (p && panes.includes(p) ? withPane(p, () => fn(...a)) : fn(...a)); };
  const EVENTS = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'beforeinput', 'input',
    'compositionstart', 'compositionend', 'focus', 'blur', 'paste', 'cut', 'copy', 'dragenter', 'dragover', 'dragleave', 'drop', 'change'];
  function makePane() {
    const p = { cur: null, mode: null, saveTimer: null, renderTimer: null, grow: 1 };
    p.el = el('section', 'nt-pane');
    p.head = el('div', 'nt-paneHead');
    p.body = el('div', 'nt-paneBody');
    p.el.append(p.head, p.body);
    for (const t of EVENTS) {
      p.el.addEventListener(t, () => {
        if (active === p || !panes.includes(p)) return;
        use(p);
        if (t !== 'blur') markActive();
      }, true);
    }
    // 幅が変わったら、その列の並び（右のパネル・上下に並べる）を合わせる
    new ResizeObserver(() => { if (panes.includes(p)) withPane(p, () => applyLayout(undefined, active === p)); }).observe(p.body);
    return p;
  }
  // 今の列に印を付け、上のボタンとサイドバーを今の列に合わせる（列の中身は描き直さない：押したボタンが消えないように）
  function markActive() {
    for (const p of panes) p.el.classList.toggle('on', p === active && panes.length > 1);
    // サイドバーの選択も今の列のノートに合わせる（VS Code のエクスプローラーと同じ。強調が2か所にならないように）
    if (cur) { sel.clear(); sel.add('n:' + cur.path); anchorKey = focusKey = 'n:' + cur.path; }
    if (chromeQueued) return;
    chromeQueued = true;
    requestAnimationFrame(() => { chromeQueued = false; ctx.chrome?.(); });
  }
  function focusPane(p) {
    use(p);
    markActive();
    requestAnimationFrame(() => (p.body.querySelector('.nt-editor:not([hidden])') || p.body.querySelector('.nt-pick input'))?.focus({ preventScroll: true }));
  }
  function addPane(at) {
    const p = makePane();
    p.mode = view();
    panes.splice(at, 0, p);
    return p;
  }
  // 右に分割：空の列を足して、開くノートを選ぶ
  function splitRight() {
    if (!info.ready) return;
    if (panes.length >= MAX_PANES) { toast(`並べられるのは${MAX_PANES}列までです`, 'warn'); return; }
    const p = addPane(panes.indexOf(active) + 1);
    use(p);
    ctx.go('notes');
    focusPane(p);
  }
  // 横に開く：右の列に開く（なければ列を足す。もう開いていればその列へ）
  async function openSide(path) {
    const there = panes.find(p => curOf(p)?.path === path);
    if (there) { focusPane(there); if (ctx.view?.() !== 'notes') ctx.go('notes'); return; }
    const i = panes.indexOf(active);
    const target = panes[i + 1] || (panes.length < MAX_PANES ? addPane(i + 1) : panes.find(p => p !== active));
    use(target);
    await open(path);
    focusPane(target);
  }
  async function closePane(p) {
    if (panes.length < 2) { await withPane(p, () => close()); return; }
    const c = curOf(p);
    if (c && c.dirty) await withPane(p, () => saveNow());
    withPane(p, () => { clearTimeout(saveTimer); clearTimeout(renderTimer); });
    closeFind(p);
    const i = panes.indexOf(p);
    const next = active === p ? panes[i + 1] || panes[i - 1] : active;
    panes.splice(i, 1);
    if (active === p) { active = null; use(next); }
    p.el.remove();
    p.sash?.remove();
    markActive();
    ctx.refresh();
  }
  // 列の境目：ドラッグで幅を変える（ダブルクリックで同じ幅に）
  function makeSash(right) {
    const s = el('div', 'nt-sash');
    s.title = 'ドラッグで幅を変える（ダブルクリックで同じ幅に）';
    s.addEventListener('pointerdown', e => {
      const left = panes[panes.indexOf(right) - 1];
      if (!left) return;
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      s.classList.add('dragging');
      document.body.classList.add('nt-resizing');
      const a = left.el.getBoundingClientRect(), b = right.el.getBoundingClientRect();
      const total = a.width + b.width, sum = left.grow + right.grow;
      const move = ev => {
        const w = Math.min(total - 240, Math.max(240, ev.clientX - a.left));
        left.grow = sum * w / total; right.grow = sum - left.grow;
        left.el.style.flexGrow = left.grow; right.el.style.flexGrow = right.grow;
      };
      s.addEventListener('pointermove', move);
      s.addEventListener('pointerup', () => { s.removeEventListener('pointermove', move); s.classList.remove('dragging'); document.body.classList.remove('nt-resizing'); }, { once: true });
    });
    s.addEventListener('dblclick', () => panes.forEach(p => { p.grow = 1; p.el.style.flexGrow = 1; }));
    return s;
  }
  function renderHead(p) {
    p.head.innerHTML = '';
    p.head.hidden = panes.length < 2;
    if (p.head.hidden) return;
    const c = curOf(p);
    const t = el('span', 'nt-paneTitle');
    t.innerHTML = icon(c ? 'file-text' : 'search');
    t.append(el('span', '', c ? nameOf(c.path) : 'ノートを選ぶ'));
    if (c && folderOf(c.path)) t.append(el('small', '', folderOf(c.path)));
    t.title = c ? c.path : '';
    p.head.append(t, btn('iconBtn nt-paneX', 'x', () => closePane(p), 'この列を閉じる'));
  }
  // 列を並べて、それぞれ描く
  function renderPanes() {
    if (!viewEl) return;
    let row = viewEl.querySelector(':scope > .nt-panes');
    if (!row) { viewEl.innerHTML = ''; row = el('div', 'nt-panes'); viewEl.append(row); }
    const want = [];
    panes.forEach((p, i) => { if (i) want.push(p.sash ||= makeSash(p)); want.push(p.el); p.el.style.flexGrow = p.grow; });
    // 並びが同じなら付け替えない（書いている途中のカーソルが外れないように）
    if (want.length !== row.children.length || want.some((x, i) => row.children[i] !== x)) row.replaceChildren(...want);
    row.classList.toggle('multi', panes.length > 1);
    const prev = active;
    for (const p of panes) { use(p); renderHead(p); render(); }
    use(prev);
    for (const p of panes) p.el.classList.toggle('on', p === active && panes.length > 1);
  }
  const eachOpen = fn => { for (const p of panes) { const c = curOf(p); if (c) fn(c, p); } };
  active = makePane();
  panes.push(active);
  box = active.body;

  const nameOf = p => p.split('/').pop().replace(/\.md$/i, '');
  const folderOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = () => paneMode || ctx.get().settings.notesView || 'split';

  // ---------- 読み込み ----------
  async function load() {
    info = await ctx.api.notes.info();
    data = info.ready ? await ctx.api.notes.list() : { notes: [], files: [], folders: [] };
    resetIx();
    dataVer++;
    applySnippets();
  }
  // 1つのノートの一覧の情報を入れかえる（e が null なら一覧から外す）。リンク・タグなどが変わったら true
  function putEntry(path, e) {
    const i = data.notes.findIndex(n => n.path === path);
    const old = i >= 0 ? data.notes[i] : null;
    if (e) { if (old) data.notes[i] = e; else data.notes.push(e); } else if (old) data.notes.splice(i, 1);
    resetIx();
    dataVer++;
    const sig = n => (n ? JSON.stringify([n.links, n.tags, n.frontmatter, n.h1, n.urls]) : '');
    return !old || !e || sig(old) !== sig(e);
  }
  // ほかのアプリで変わったノートだけを読み直す（一覧を丸ごと送り直さない）。フォルダや画像などが変わったときは false（全部読み直す）
  async function patch(files) {
    if (!files?.length || files.some(f => !/\.md$/i.test(f) || f.split('/').some(x => x.startsWith('.')))) return false;
    const got = await ctx.api.notes.entries(files);
    if (!Array.isArray(got)) return false;
    if (got.some(g => g.entry && g.entry.folder && !data.folders.includes(g.entry.folder))) return false;   // 新しいフォルダ
    for (const g of got) putEntry(g.path, g.entry);
    return true;
  }
  // Vault の CSS スニペット（Obsidian の見た目）をノートの表示に使う
  function applySnippets() {
    let st = document.getElementById('vaultSnippets');
    const on = ctx.get().settings.notesSnippets !== false;
    // ノートの部分だけに効くように @scope で囲む（アプリのほかの画面の見た目は変えない）
    // .theme-dark / .theme-light は、ノートの部分の表示（設定「ノートの表示」）に合わせて効くように書き換える
    const fix = css => css.replace(/\.theme-(dark|light)\b/g, '[data-nt-theme="$1"]');
    const css = on && info.snippets ? info.snippets.map(s => `/* ${s.name} */\n@scope (#notesView) {\n${fix(s.css)}\n}`).join('\n') : '';
    if (!css) { st?.remove(); return; }
    if (!st) { st = el('style'); st.id = 'vaultSnippets'; document.head.append(st); }
    if (st.textContent !== css) st.textContent = css;
  }

  // ノートの文字（Zen Kaku Gothic New・Roboto Mono）は文字の範囲ごとに381個のファイルに分かれていて、
  // まだ使っていない文字が出るたびに読み込み → そのたびに画面全体の計算がやり直しになる。手が空いているときに先に全部読んでおく
  function warmFonts() {
    const faces = [...document.fonts].filter(f => /Zen Kaku Gothic New|Roboto Mono/.test(f.family) && f.status === 'unloaded');
    if (!faces.length || !window.requestIdleCallback) return;
    let i = 0;
    const step = d => {
      while (i < faces.length && d.timeRemaining() > 3) faces[i++].load().catch(() => {});
      if (i < faces.length) requestIdleCallback(step, { timeout: 2000 });
    };
    requestIdleCallback(step, { timeout: 2000 });
  }
  // 名前の並べ方（日本語・数字は大きさ順）。localeCompare に毎回オプションを渡すと遅いので、使い回す
  const jaSort = new Intl.Collator('ja', { numeric: true }).compare;
  // ノートの名前・場所から一発で引ける表（ノートが多くても重くならないように。一覧が変わったら作り直す）
  let noteIx = null;
  let dataVer = 0;   // ノートの一覧が変わるたびに増やす（サイドバーを作り直すかどうかの目印）
  function ix() {
    if (noteIx && noteIx.src === data.notes && noteIx.len === data.notes.length) return noteIx;
    const byName = new Map(), byPath = new Map();
    for (const n of data.notes) {
      byPath.set(n.path.toLowerCase(), n);
      const k = n.name.toLowerCase();
      const a = byName.get(k);
      if (a) a.push(n); else byName.set(k, [n]);
    }
    return (noteIx = { src: data.notes, len: data.notes.length, byName, byPath, back: null });
  }
  const resetIx = () => { noteIx = null; };
  // このノートへリンクしているノート（全部のリンクを1回だけたどって表にしておく）
  function backlinksOf(path) {
    const I = ix();
    if (!I.back) {
      I.back = new Map();
      for (const n of data.notes) {
        const seen = new Set();
        for (const l of n.links) {
          if (l.embed) continue;
          const r = resolve(l.target, n.path);
          if (!r || r.path === n.path || seen.has(r.path)) continue;
          seen.add(r.path);
          const a = I.back.get(r.path);
          if (a) a.push(n); else I.back.set(r.path, [n]);
        }
      }
    }
    return I.back.get(path) || [];
  }
  // Obsidian と同じく、名前だけのリンクはフォルダを問わず探す（同じフォルダを優先）
  function resolve(target, from = '') {
    const t = String(target || '').trim().replace(/\.md$/i, '').toLowerCase();
    if (!t) return null;
    const I = ix();
    if (t.includes('/')) return I.byPath.get(t + '.md') || (I.byName.get(t.split('/').pop()) || []).find(n => n.path.toLowerCase().endsWith('/' + t + '.md')) || null;
    const hits = I.byName.get(t) || [];
    if (hits.length <= 1) return hits[0] || null;
    return hits.find(n => n.folder === folderOf(from)) || hits.sort((a, b) => a.path.length - b.path.length)[0];
  }
  function resolveFile(target, from = '') {
    const t = String(target || '').trim().toLowerCase();
    const base = t.split('/').pop();
    const rel = (folderOf(from) ? folderOf(from) + '/' : '') + t;
    return data.files.find(f => f.toLowerCase() === rel) || data.files.find(f => f.toLowerCase() === t) || data.files.find(f => f.split('/').pop().toLowerCase() === base) || null;
  }
  const vaultUrl = rel => (ctx.fileUrl ? ctx.fileUrl(rel) : 'vault://f/' + rel.split('/').map(encodeURIComponent).join('/'));   // MDWS: 画像は app.js が読み込む

  // ---------- 開く・保存 ----------
  async function open(path, opt = {}) {
    // ほかの列で開いていれば、その列へ（同じノートを2つの列で書きかえて、ぶつからないように）
    const there = panes.find(p => p !== active && curOf(p)?.path === path);
    if (there) { focusPane(there); ctx.go('notes'); return; }
    const pane = active;
    if (cur && cur.dirty) await saveNow();
    const r = await ctx.api.notes.read(path);
    if (r && r.error) { toast(r.error, 'warn'); return; }
    if (pane && panes.includes(pane)) use(pane);
    cur = { path, text: r.text, mtime: r.mtime, dirty: false, base: r.text };
    let f = folderOf(path);
    while (f) { openFolders.add(f); f = folderOf(f); }
    // ノートのタブにいるなら、画面全体は描き直さない（このあとの render と markActive で、列・上のボタン・サイドバーを合わせる）
    if (ctx.view?.() !== 'notes') ctx.go('notes');
    render();
    markActive();
    if (opt.edit || (!r.text.trim() && view() !== 'preview')) focusEditor(opt.end);
  }
  function focusEditor(end) {
    const ta = box?.querySelector('.nt-editor');
    if (!ta) return;
    ta.focus();
    if (end) ta.selectionStart = ta.selectionEnd = ta.value.length;
  }
  function changed(text) {
    if (!cur) return;
    cur.text = text;
    paintHl();
    cur.dirty = true;
    setSaved('');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(bound(saveNow), 700);
    clearTimeout(renderTimer);
    renderTimer = setTimeout(bound(renderPreview), 150);
  }
  // 書きかけのノートが、ほかで書きかえられていたとき：片方がプロパティだけ、もう片方が本文だけを変えたなら両方を合わせる
  // （毎日確認のチェックでプロパティが変わった・Obsidian でプロパティだけ直した、など）。合わせられなければ null
  const fmSplit = t => { const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(t); return m ? [m[0], t.slice(m[0].length)] : ['', t]; };
  function mergeProps(base, mine, theirs) {
    if (base == null) return null;
    const [bf, bb] = fmSplit(base), [mf, mb] = fmSplit(mine), [tf, tb] = fmSplit(theirs);
    if (tb === bb && mf === bf) return tf + mb;
    if (tf === bf && mb === bb) return mf + tb;
    return null;
  }
  // 合わせた内容をエディタに入れる（プロパティの長さが変わった分だけカーソルをずらす）
  function applyMerged(next) {
    const ta = box?.querySelector('.nt-editor');
    if (ta && ta.value !== next) {
      const d = fmSplit(next)[0].length - fmSplit(ta.value)[0].length, at = fmSplit(ta.value)[0].length;
      const a = ta.selectionStart, b = ta.selectionEnd, top = ta.scrollTop;
      ta.value = next;
      ta.setSelectionRange(a >= at ? a + d : a, b >= at ? b + d : b);
      ta.scrollTop = top;
    }
    cur.text = next;
    render();
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!cur || !cur.dirty) return;
    const c = cur, pane = active;
    const sent = c.text;
    const edVal = () => pane?.body.querySelector('.nt-editor')?.value;
    const mine = () => !pane || curOf(pane) === c;
    const r = await ctx.api.notes.write(c.path, sent, { expectMtime: c.mtime, quiet: true });
    if (r && r.error) { toast(r.error, 'warn'); return; }
    if (r?.entry) savedEntry(r.entry);
    if (r.conflict) {
      const disk = await ctx.api.notes.read(c.path);
      const merged = disk && !disk.error ? mergeProps(c.base, sent, disk.text) : null;
      if (merged != null) {
        const w = await ctx.api.notes.write(c.path, merged, { expectMtime: disk.mtime, quiet: true });
        if (w?.entry) savedEntry(w.entry);
        if (w && !w.error && !w.conflict) {
          c.mtime = w.mtime;
          c.base = merged;
          if (mine()) {
            // 保存しているあいだに書き足した分も残す
            const live = edVal() ?? c.text;
            const next = live === sent ? merged : mergeProps(sent, live, merged) ?? live;
            c.dirty = next !== merged;
            const run = () => { applyMerged(next); if (c.dirty) saveTimer = setTimeout(bound(saveNow), 700); };
            pane && panes.includes(pane) ? withPane(pane, run) : run();
          }
          if (pane === active) setSaved('保存しました');
          return;
        }
      }
      // ほかのアプリで書き換えられていた：消さないように、別のノートとして残す
      const copy = await ctx.api.notes.create(folderOf(c.path), nameOf(c.path) + '（Workstationで編集）', c.text);
      toast('ほかのアプリで書き換えられていたので、こちらの内容は別のノートに保存しました', 'warn');
      c.dirty = false;
      if (copy && copy.path) { if (pane && panes.includes(pane)) use(pane); await open(copy.path); }
      return;
    }
    c.mtime = r.mtime;
    c.base = sent;
    if (mine() && c.text === sent && c.text === edVal()) c.dirty = false;
    if (pane === active) setSaved('保存しました');
    // 本文の検索の結果を出しているときは、少し待って新しくする（書いている間に何度も探さない）
    if (srch?.res) { clearTimeout(srch.timer); srch.timer = setTimeout(runSearch, 600); }
  }
  // 保存したノートの一覧の情報を入れかえる。リンク・タグなどが変わったときだけ、サイドバーと右のパネルを描き直す（まとめて1回）
  let savedQueued = false;
  function savedEntry(e) {
    if (!putEntry(e.path, e) || savedQueued) return;
    savedQueued = true;
    requestAnimationFrame(() => {
      savedQueued = false;
      if (side) renderSide(side);
      for (const p of panes) if (curOf(p)) withPane(p, renderInfo);
    });
  }
  function setSaved(t) {
    const s = document.getElementById('ntSaved');
    if (!s) return;
    s.textContent = t;
    s.classList.toggle('on', !!t);
  }

  // ---------- 操作 ----------
  async function newNote(folder = activeFolder || (cur ? folderOf(cur.path) : ''), name = '', text = '') {
    if (!info.ready) { ctx.go('notes'); return; }
    const r = await ctx.api.notes.create(folder, name || '無題のノート', text);
    if (r && r.error) { toast(r.error, 'warn'); return; }
    await load();
    await open(r.path, { edit: true, end: true });
    if (!name) rename();
  }
  async function daily() {
    if (!info.ready) { ctx.go('notes'); return; }
    const r = await ctx.api.notes.daily();
    if (r && r.error) { toast(r.error, 'warn'); return; }
    if (r.created) await load();
    await open(r.path, { end: true });
  }
  // デイリーノートに「今日の記録」（集中・完了したタスク・毎日確認）を入れる。もう入っていれば入れかえる
  async function insertLog() {
    if (!cur) return;
    if (!data.notes.find(n => n.path === cur.path)?.day) { toast('「今日の記録」は、デイリーノート（日付の名前のノート）にだけ入れられます', 'warn'); return; }
    const pane = active;
    await saveNow();
    const r = await ctx.api.notes.insertLog(cur.path);
    if (r && r.error) { toast(r.error, 'warn'); return; }
    const c = curOf(pane);
    if (!c || c.path !== r.path) return;
    Object.assign(c, { text: r.text, mtime: r.mtime, dirty: false, base: r.text });
    await load();
    withPane(pane, render);
    toast('「今日の記録」を入れました（もう一度押すと、最新の内容に入れかえます）');
  }

  // ---------- ほかのアプリとのつながり ----------
  // まだ終わっていないチェックリストの項目（コード・プロパティの中は見ない）
  const plain = t => t.replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`=~]+/g, '').replace(/\s+/g, ' ').trim();
  function openChecklist(text) {
    const out = [], seen = new Set();
    const { body, lines } = splitFrontmatter(text);
    let fence = false;
    body.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
      const m = !fence && /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.+)$/.exec(l);
      if (!m) return;
      const title = plain(m[1]).slice(0, 200);
      if (title && !seen.has(title)) { seen.add(title); out.push({ title, line: i + lines }); }
    });
    return out;
  }
  // チェックリストの項目をタスクにする（タスクのメモに [[このノート]] を入れて、あとから戻れるように）
  function toTasks(items) {
    if (!cur || !ctx.openTaskBatch) return;
    const me = data.notes.find(n => n.path === cur.path);
    ctx.openTaskBatch({ items, projectName: me ? projectsOf(me)[0] || '' : '', note: `[[${nameOf(cur.path)}]]`, heading: 'チェックリストをタスクにする', from: `ノート「${nameOf(cur.path)}」から。タスクのメモにこのノートへのリンクが入ります` });
  }
  // URLを比べるための形（http/https・www・末尾の / ・#以降の違いは同じとみなす）
  function normUrl(u) {
    try {
      const x = new URL(String(u).trim());
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
      return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase();
    } catch { return ''; }
  }
  const shortUrl = u => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.slice(0, 24) + (x.pathname.length > 24 ? '…' : '') : ''); } catch { return u; } };
  // ノートのURLをブックマークに保存（大項目を選ぶ。ノートのプロジェクトと同じ名前の大項目があればいちばん上に）
  function addBookmark(u, e) {
    const { categories } = window.Bookmarks.all();
    if (!categories.length) { toast('先にブックマークの大項目を作ってください', 'warn'); return; }
    const me = data.notes.find(n => n.path === cur?.path);
    const pj = me ? projectsOf(me) : [];
    const cats = [...categories].sort((a, b) => (pj.includes(b.name) ? 1 : 0) - (pj.includes(a.name) ? 1 : 0));
    menu(cats.slice(0, 12).map(c => ({
      icon: 'bookmark', label: `「${c.name}」に保存`,
      run: async () => {
        const r = await ctx.api.bookmarks.save({ categoryId: c.id, url: u.url, title: u.title || '' });
        if (r && r.error) toast(r.error, 'warn'); else toast(`ブックマークの「${c.name}」に保存しました`);
      },
    })), e);
  }
  // そのURLが出てくるノート（ブックマーク側から使う）
  const notesWithUrl = url => { const k = normUrl(url); return k ? data.notes.filter(n => (n.urls || []).some(x => normUrl(x.url) === k)) : []; };

  async function rename() {
    if (!cur) return;
    await saveNow();
    const d = el('dialog', 'askDlg');
    const f = el('form'); f.method = 'dialog';
    const inp = el('input', 'inp'); inp.value = nameOf(cur.path); inp.required = true; inp.maxLength = 120;
    const sel = el('select', 'inp');
    sel.append(new Option('（いちばん上）', ''));
    data.folders.forEach(x => sel.append(new Option(x, x)));
    sel.value = folderOf(cur.path);
    const row = el('div', 'dlgBtns');
    const cancel = el('button', 'btn', 'キャンセル'); cancel.type = 'button'; cancel.addEventListener('click', () => d.close('cancel'));
    const ok = el('button', 'btn primary', '変更'); ok.value = 'ok';
    row.append(el('span', 'spacer'), cancel, ok);
    const lf = el('label', 'field'); lf.append('名前', inp);
    const lfo = el('label', 'field'); lfo.append('フォルダ', sel);
    f.append(el('h2', '', 'ノートの名前'), lf, lfo, el('p', 'nt-note', 'ほかのノートの [[リンク]] も新しい名前に書き換わります'), row);
    d.append(f);
    document.body.append(d);
    d.addEventListener('close', async () => {
      d.remove();
      if (d.returnValue !== 'ok') return;
      const name = inp.value.trim();
      if (!name || (name === nameOf(cur.path) && sel.value === folderOf(cur.path))) return;
      const r = await ctx.api.notes.rename(cur.path, name, sel.value);
      if (r && r.error) { toast(r.error, 'warn'); return; }
      cur.path = r.path;
      await load();
      const n = await ctx.api.notes.read(r.path);
      if (!n.error) cur.mtime = n.mtime;
      ctx.refresh();
      toast(r.updated ? `名前を変えました（${r.updated}件のノートのリンクも更新）` : '名前を変えました');
    });
    d.showModal();
    inp.select();
  }
  async function remove() {
    if (!cur || !confirm(`「${nameOf(cur.path)}」を削除しますか？\n（フォルダの中の .trash に移します。あとで戻せます）`)) return;
    clearTimeout(saveTimer);
    const r = await ctx.api.notes.remove(cur.path);
    if (r && r.error) { toast(r.error, 'warn'); return; }
    cur = null;
    await load();
    ctx.refresh();
  }
  // 開いているノートを閉じる（書きかけは先に保存）
  async function close() {
    if (panes.length > 1) return closePane(active);   // 並べているときは、その列を閉じる
    if (!cur) return;
    if (cur.dirty) await saveNow();
    clearTimeout(saveTimer);
    cur = null;
    ctx.refresh();
  }
  // フォルダを作る（parent の中に）。作ったら開いて選んだ状態にする
  async function newFolder(parent = activeFolder || '') {
    const name = await askText(parent ? `「${parent.split('/').pop()}」の中にフォルダを作る` : 'フォルダを作る', '', '例: 仕事');
    if (!name) return;
    const r = await ctx.api.notes.mkdir((parent ? parent + '/' : '') + name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim());
    if (r && r.error) { toast(r.error, 'warn'); return; }
    if (parent) openFolders.add(parent);
    openFolders.add(r.path);
    activeFolder = r.path;
    await load();
    ctx.refresh();
    toast(`フォルダ「${name}」を作りました`);
  }
  // ================= エクスプローラー（VS Code のような操作） =================
  // 行のキー：'f:フォルダ' / 'n:ノートのパス'
  // ・クリックで選ぶ（ノートは開く・フォルダは開閉）、⌘クリックで追加、⇧クリックで範囲
  // ・ドラッグでフォルダへ移動（選んだものをまとめて。フォルダも動かせる。閉じたフォルダの上で少し待つと開く）
  // ・⌘X → ⌘V で移動、⌘Z で直前の移動を元に戻す、Enter/F2 で名前を変更、⌘⌫ で削除、↑↓←→ で移動
  const sel = new Set();
  let focusKey = null, anchorKey = null;
  let clip = null;                 // 切り取ったもの
  let lastMove = null;             // 直前の移動（⌘Z で戻す）
  let visible = [];                // 表示している行（上から）
  let rows = new Map();            // キー → 行
  let zones = new Map();           // フォルダ → 落とすときに色を付ける要素
  let dragKeys = null, hoverFolder = null, hoverTimer = null;
  const keyPath = k => k.slice(2);
  const isFolderKey = k => k.startsWith('f:');
  const parentOfKey = k => folderOf(keyPath(k));
  const nameOfKey = k => (isFolderKey(k) ? keyPath(k).split('/').pop() : nameOf(keyPath(k)));
  const folderLabel = f => (f ? f.split('/').pop() : 'いちばん上');
  // 親フォルダもいっしょに選ばれているものは除く（親ごと動くので）
  const topLevel = keys => keys.filter(k => !keys.some(o => o !== k && isFolderKey(o) && keyPath(k).startsWith(keyPath(o) + '/')));
  const canMove = (keys, folder) => keys.length > 0 && keys.some(k => parentOfKey(k) !== folder)
    && keys.every(k => !isFolderKey(k) || (folder !== keyPath(k) && !folder.startsWith(keyPath(k) + '/')));
  const openUpTo = f => { while (f) { openFolders.add(f); f = folderOf(f); } };

  async function moveOne(k, folder) {
    const p = keyPath(k);
    if (folderOf(p) === folder) return null;
    if (isFolderKey(k)) {
      const r = await ctx.api.notes.moveFolder(p, folder);
      if (r && r.error) { toast(r.error, 'warn'); return null; }
      const re = x => r.path + x.slice(p.length);
      eachOpen((c, pn) => { if (c.path.startsWith(p + '/')) { c.path = re(c.path); pn.body.dataset.path = c.path; } });
      for (const f of [...openFolders]) if (f === p || f.startsWith(p + '/')) { openFolders.delete(f); openFolders.add(re(f)); }
      if (activeFolder === p || activeFolder.startsWith(p + '/')) activeFolder = re(activeFolder);
      return 'f:' + r.path;
    }
    const r = await ctx.api.notes.move(p, folder);
    if (r && r.error) { toast(r.error, 'warn'); return null; }
    for (const pn of panes) {
      const c = curOf(pn);
      if (c && c.path === p) { c.path = r.path; const n = await ctx.api.notes.read(r.path); if (!n.error) c.mtime = n.mtime; pn.body.dataset.path = r.path; }
    }
    return 'n:' + r.path;
  }
  async function moveItems(keys, folder) {
    keys = topLevel([...keys]).filter(k => parentOfKey(k) !== folder);
    if (!keys.length) return;
    if (!canMove(keys, folder)) { toast('フォルダを自分の中には移動できません', 'warn'); return; }
    if (cur && cur.dirty) await saveNow();
    const done = [];
    for (const k of keys) { const nk = await moveOne(k, folder); if (nk) done.push({ key: nk, back: parentOfKey(k) }); }
    clip = null;
    if (done.length) {
      openUpTo(folder);
      sel.clear(); done.forEach(d => sel.add(d.key));
      focusKey = anchorKey = done[0].key;
      lastMove = done;
    }
    await load();
    ctx.refresh();
    if (done.length) toast(`${done.length === 1 ? `「${nameOfKey(done[0].key)}」` : `${done.length}件`}を「${folderLabel(folder)}」へ移動しました（⌘Z で元に戻す）`);
  }
  async function undoMove() {
    if (!lastMove) { toast('元に戻せる移動はありません'); return; }
    const list = lastMove; lastMove = null;
    if (cur && cur.dirty) await saveNow();
    sel.clear();
    for (const d of [...list].reverse()) { const nk = await moveOne(d.key, d.back); if (nk) { sel.add(nk); focusKey = anchorKey = nk; openUpTo(d.back); } }
    await load();
    ctx.refresh();
    toast('移動を元に戻しました');
  }
  async function deleteItems(keys) {
    keys = topLevel([...keys]);
    if (!keys.length) return;
    const inside = keys.filter(isFolderKey).reduce((a, k) => a + data.notes.filter(n => n.path.startsWith(keyPath(k) + '/')).length, 0);
    const what = keys.length === 1 ? `${isFolderKey(keys[0]) ? 'フォルダ' : ''}「${nameOfKey(keys[0])}」` : `${keys.length}件`;
    if (!confirm(`${what}${inside ? `（中のノート${inside}件も）` : ''}を削除しますか？\n（フォルダの中の .trash に移します。あとで戻せます）`)) return;
    for (const k of keys) {
      const p = keyPath(k);
      for (const pn of panes) { const c = curOf(pn); if (c && (c.path === p || c.path.startsWith(p + '/'))) withPane(pn, () => { clearTimeout(saveTimer); cur = null; }); }
      const r = isFolderKey(k) ? await ctx.api.notes.removeFolder(p) : await ctx.api.notes.remove(p);
      if (r && r.error) toast(r.error, 'warn');
    }
    sel.clear();
    focusKey = anchorKey = null;
    await load();
    ctx.refresh();
    toast(`${what}を削除しました`);
  }
  async function renameFolderUI(f) {
    const name = await askText('フォルダの名前', f.split('/').pop());
    if (!name) return;
    if (cur && cur.dirty) await saveNow();
    const r = await ctx.api.notes.renameFolder(f, name);
    if (r && r.error) return toast(r.error, 'warn');
    const re = x => r.path + x.slice(f.length);
    eachOpen((c, pn) => { if (c.path.startsWith(f + '/')) { c.path = re(c.path); pn.body.dataset.path = c.path; } });
    for (const o of [...openFolders]) if (o === f || o.startsWith(f + '/')) { openFolders.delete(o); openFolders.add(re(o)); }
    if (activeFolder === f || activeFolder.startsWith(f + '/')) activeFolder = re(activeFolder);
    sel.clear(); sel.add('f:' + r.path); focusKey = anchorKey = 'f:' + r.path;
    await load(); ctx.refresh();
  }
  async function renameKey(k) {
    if (isFolderKey(k)) return renameFolderUI(keyPath(k));
    if (!cur || cur.path !== keyPath(k)) await open(keyPath(k));
    rename();
  }
  function cutItems(keys) {
    keys = topLevel([...keys]);
    if (!keys.length) return;
    clip = new Set(keys);
    paintSel();
    toast(`${keys.length === 1 ? `「${nameOfKey(keys[0])}」` : `${keys.length}件`}を切り取りました。移動先を選んで ⌘V`);
  }
  // ⌘V の行き先：選んでいるのがフォルダならその中、ノートならそのノートのフォルダ
  const targetFolderOf = k => (!k ? '' : isFolderKey(k) ? keyPath(k) : parentOfKey(k));
  async function pasteInto(folder) {
    if (!clip) return;
    const keys = [...clip].filter(k => (isFolderKey(k) ? data.folders.includes(keyPath(k)) : data.notes.some(n => n.path === keyPath(k))));
    clip = null;
    await moveItems(keys, folder);
  }

  // 選択の見た目だけを塗り直す（ドラッグ中に作り直さないように）
  function paintSel() {
    rows.forEach((b, k) => {
      b.classList.toggle('sel', sel.has(k));
      b.classList.toggle('cut', !!clip?.has(k));
      b.tabIndex = k === focusKey ? 0 : -1;
    });
    if (!rows.has(focusKey)) { const f = rows.values().next().value; if (f) f.tabIndex = 0; }
  }
  function focusRow() { const b = rows.get(focusKey); if (b) { b.focus({ preventScroll: true }); b.scrollIntoView({ block: 'nearest' }); } }
  function selectOnly(k) { sel.clear(); sel.add(k); anchorKey = focusKey = k; }
  function activate(k) {
    const p = keyPath(k);
    if (isFolderKey(k)) {
      activeFolder = p;
      openFolders.has(p) ? openFolders.delete(p) : openFolders.add(p);
      renderSide(side);
    } else {
      activeFolder = folderOf(p);
      // 開いているノートをもう一度押したら閉じる（フォルダと同じくトグル。並べているときは、その列へ移るだけ）
      cur && cur.path === p && panes.length < 2 ? close() : open(p);
    }
  }
  function onRowClick(e, k) {
    if (e.target.closest('.nt-rowBtn')) return;
    if (e.shiftKey && anchorKey && visible.includes(anchorKey)) {
      const a = visible.indexOf(anchorKey), b = visible.indexOf(k);
      sel.clear();
      visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => sel.add(x));
      focusKey = k;
      paintSel();
      return;
    }
    // ⌥クリック：横（右の列）に開く
    if (e.altKey && !isFolderKey(k)) { selectOnly(k); paintSel(); openSide(keyPath(k)); return; }
    if (e.metaKey || e.ctrlKey) {
      sel.has(k) ? sel.delete(k) : sel.add(k);
      anchorKey = focusKey = k;
      paintSel();
      return;
    }
    selectOnly(k);
    paintSel();
    activate(k);
  }
  // サイドバーの一覧で押したキー
  function onTreeKey(e) {
    if (e.isComposing || !rows.size) return false;
    const mod = e.metaKey || e.ctrlKey, key = e.key;
    let i = visible.indexOf(focusKey);
    const go = j => {
      j = Math.max(0, Math.min(visible.length - 1, j));
      const k = visible[j];
      if (e.shiftKey && anchorKey && visible.includes(anchorKey)) {
        const a = visible.indexOf(anchorKey);
        sel.clear();
        visible.slice(Math.min(a, j), Math.max(a, j) + 1).forEach(x => sel.add(x));
        focusKey = k;
      } else selectOnly(k);
      paintSel();
      focusRow();
    };
    const k = focusKey && rows.has(focusKey) ? focusKey : null;
    if (key === 'ArrowDown' && !mod) go(i < 0 ? 0 : i + 1);
    else if (key === 'ArrowUp' && !mod) go(i < 0 ? 0 : i - 1);
    else if (key === 'Home') go(0);
    else if (key === 'End') go(visible.length - 1);
    else if (key === 'ArrowRight' && k) {
      if (isFolderKey(k) && !openFolders.has(keyPath(k))) { openFolders.add(keyPath(k)); renderSide(side); }
      else if (isFolderKey(k) && visible[i + 1] && parentOfKey(visible[i + 1]) === keyPath(k)) go(i + 1);
    } else if (key === 'ArrowLeft' && k) {
      if (isFolderKey(k) && openFolders.has(keyPath(k))) { openFolders.delete(keyPath(k)); renderSide(side); }
      else if (parentOfKey(k)) go(visible.indexOf('f:' + parentOfKey(k)));
    } else if ((key === ' ' || (mod && key === 'ArrowDown')) && k) activate(k);
    else if ((key === 'Enter' || key === 'F2') && k) renameKey(k);
    else if ((key === 'Delete' || (mod && key === 'Backspace')) && sel.size) deleteItems([...sel]);
    else if (mod && key.toLowerCase() === 'x' && sel.size) cutItems([...sel]);
    else if (mod && key.toLowerCase() === 'v' && clip) pasteInto(targetFolderOf(k));
    else if (mod && key.toLowerCase() === 'z' && !e.shiftKey) undoMove();
    else if (mod && key.toLowerCase() === 'a') { sel.clear(); visible.forEach(x => sel.add(x)); paintSel(); }
    else if (key === 'Escape') { clip = null; sel.clear(); if (k) sel.add(k); paintSel(); }
    else return false;
    e.preventDefault();
    return true;
  }

  // ----- ドラッグで移動 -----
  function clearDrop() { document.querySelectorAll('.dropZone').forEach(x => x.classList.remove('dropZone')); }
  function showDrop(folder) {
    clearDrop();
    (zones.get(folder) || []).forEach(x => x.classList.add('dropZone'));
  }
  function stopHover() { clearTimeout(hoverTimer); hoverTimer = null; hoverFolder = null; }
  // 行の上：フォルダならその中、ノートならそのノートのフォルダ。何もないところは「いちばん上」
  const dropFolderAt = e => {
    const row = e.target.closest('.nav[data-key]');
    return row ? targetFolderOf(row.dataset.key) : '';
  };
  function dragSource(b, k) {
    b.draggable = true;
    b.addEventListener('dragstart', e => {
      if (!sel.has(k)) { selectOnly(k); paintSel(); }
      dragKeys = topLevel([...sel]);
      e.dataTransfer.setData('text/x-ws-tree', JSON.stringify(dragKeys));
      e.dataTransfer.effectAllowed = 'move';
      const g = el('div', 'nt-dragGhost');
      g.innerHTML = icon(dragKeys.length > 1 ? 'files' : isFolderKey(k) ? 'folder-closed' : 'file-text');
      g.append(dragKeys.length > 1 ? `${dragKeys.length}件` : nameOfKey(k));
      document.body.append(g);
      e.dataTransfer.setDragImage(g, 14, 14);
      setTimeout(() => g.remove());
      requestAnimationFrame(() => dragKeys?.forEach(x => rows.get(x)?.classList.add('dragging')));
    });
    b.addEventListener('dragend', () => { dragKeys = null; stopHover(); clearDrop(); document.querySelectorAll('.nt-tree .dragging').forEach(x => x.classList.remove('dragging')); });
  }
  function dropArea(elm, fixed) {
    elm.addEventListener('dragover', e => {
      if (!dragKeys) return;
      const f = fixed ?? dropFolderAt(e);
      if (!canMove(dragKeys, f)) { clearDrop(); return; }      // 落とせない（同じ場所・自分の中）
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      showDrop(f);
      // 閉じたフォルダの上で少し待つと開く
      const row = fixed == null ? e.target.closest('.nt-folder:not(.open)') : null;
      const hf = row ? keyPath(row.dataset.key) : null;
      if (hf !== hoverFolder) {
        stopHover();
        hoverFolder = hf;
        if (hf) hoverTimer = setTimeout(() => { openFolders.add(hf); hoverFolder = null; renderSide(side); if (dragKeys) showDrop(hf); }, 600);
      }
    });
    elm.addEventListener('dragleave', e => { if (!elm.contains(e.relatedTarget)) { clearDrop(); stopHover(); } });
    elm.addEventListener('drop', e => {
      if (!dragKeys) return;
      e.preventDefault();
      e.stopPropagation();
      const keys = dragKeys, f = fixed ?? dropFolderAt(e);
      dragKeys = null;
      stopHover();
      clearDrop();
      moveItems(keys, f);
    });
  }
  // 移動先のフォルダを選ぶ（検索できる一覧）
  function pickFolder(keys) {
    keys = topLevel([...keys]);
    if (!keys.length) return;
    const d = el('dialog', 'bmPick ntPick');
    const head = el('div', 'bmp-head');
    head.append(withIcon('h2', '', 'folder-input', `移動先：${keys.length === 1 ? `「${nameOfKey(keys[0])}」` : `${keys.length}件`}`), btn('iconBtn', 'x', () => d.close(), '閉じる'));
    const q = el('input', 'inp'); q.placeholder = 'フォルダを検索'; q.type = 'search';
    const list = el('div', 'bmp-list');
    let at = 0, items = [];
    const draw = () => {
      list.innerHTML = '';
      const w = q.value.trim().toLowerCase();
      items = ['', ...data.folders].filter(f => canMove(keys, f) && (!w || (f || 'いちばん上').toLowerCase().includes(w)));
      at = Math.min(at, Math.max(0, items.length - 1));
      items.forEach((f, i) => {
        const r = el('button', 'bmp-row' + (i === at ? ' on' : ''));
        r.type = 'button';
        const ic = el('span', 'ck-ic'); ic.innerHTML = icon(f ? 'folder-closed' : 'house');
        const tx = el('span', 'tx');
        tx.append(el('b', '', folderLabel(f)), el('small', '', f ? (folderOf(f) || 'いちばん上') + ' の中' : 'Vault のいちばん上'));
        r.append(ic, tx);
        r.addEventListener('click', () => { d.close(); moveItems(keys, f); });
        r.addEventListener('mousemove', () => { if (at !== i) { at = i; list.querySelectorAll('.bmp-row').forEach((x, j) => x.classList.toggle('on', j === i)); } });
        list.append(r);
      });
      if (!items.length) list.append(withIcon('p', 'pj-empty', 'search', '移動できるフォルダがありません'));
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };
    q.addEventListener('input', () => { at = 0; draw(); });
    q.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(items.length - 1, at + 1); draw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
      if (e.key === 'Enter' && items[at] != null) { e.preventDefault(); e.stopPropagation(); d.close(); moveItems(keys, items[at]); }
    });
    d.append(head, q, list);
    document.body.append(d);
    d.addEventListener('close', () => d.remove());
    draw();
    d.showModal();
    q.focus();
  }
  // 右クリック（複数選んでいるときは、まとめて）
  function rowMenu(k, e) {
    if (!sel.has(k)) { selectOnly(k); paintSel(); }
    const keys = [...sel];
    if (keys.length > 1) {
      return menu([
        { icon: 'folder-input', label: `${keys.length}件を移動…`, run: () => pickFolder(keys) },
        { icon: 'scissors', label: '切り取り', kbd: '⌘X', run: () => cutItems(keys) },
        '-',
        { icon: 'trash-2', label: `${keys.length}件を削除`, kbd: '⌘⌫', danger: true, run: () => deleteItems(keys) },
      ], e);
    }
    const p = keyPath(k);
    const paste = clip ? [{ icon: 'clipboard-paste', label: `「${folderLabel(targetFolderOf(k))}」に貼り付け`, kbd: '⌘V', run: () => pasteInto(targetFolderOf(k)) }] : [];
    if (isFolderKey(k)) {
      return menu([
        { icon: 'file-plus', label: '新しいノート', run: () => { openFolders.add(p); newNote(p); } },
        { icon: 'folder-plus', label: '新しいフォルダ', run: () => newFolder(p) },
        '-',
        { icon: 'pencil', label: '名前を変更', kbd: 'Enter', run: () => renameFolderUI(p) },
        { icon: 'folder-input', label: '移動…', run: () => pickFolder([k]) },
        { icon: 'scissors', label: '切り取り', kbd: '⌘X', run: () => cutItems([k]) },
        ...paste,
        ...(ctx.api.notes.reveal ? [{ icon: 'folder-open', label: 'Finder で表示', run: () => ctx.api.notes.reveal(p) }] : []),   // MDWS
        '-',
        { icon: 'trash-2', label: 'フォルダを削除', kbd: '⌘⌫', danger: true, run: () => deleteItems([k]) },
      ], e);
    }
    menu([
      { icon: 'file-text', label: '開く', run: () => open(p) },
      { icon: 'square-split-horizontal', label: '横に開く', kbd: '⌥クリック', run: () => openSide(p) },
      { icon: 'pencil', label: '名前を変更', kbd: 'Enter', run: () => renameKey(k) },
      { icon: 'folder-input', label: '移動…', run: () => pickFolder([k]) },
      { icon: 'scissors', label: '切り取り', kbd: '⌘X', run: () => cutItems([k]) },
      ...paste,
      '-',
      { icon: 'trash-2', label: '削除', kbd: '⌘⌫', danger: true, run: () => deleteItems([k]) },
    ], e);
  }

  // 小さなメニュー（右クリックや「…」）
  function menu(items, e) {
    document.querySelector('.nt-menu')?.remove();
    const m = el('div', 'nt-menu');
    for (const it of items) {
      if (it === '-') { m.append(el('div', 'nt-menuSep')); continue; }
      const b = el('button', 'nt-menuItem' + (it.danger ? ' danger' : ''));
      b.type = 'button';
      b.innerHTML = icon(it.icon);
      b.append(it.label);
      if (it.kbd) b.append(el('kbd', 'nt-menuKbd', it.kbd));
      b.addEventListener('mousedown', ev => { ev.preventDefault(); m.remove(); it.run(); });
      if (it.del) {
        const x = el('span', 'nt-menuDel'); x.innerHTML = icon('x'); x.title = '削除';
        x.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); m.remove(); it.del(); });
        b.append(x);
      }
      m.append(b);
    }
    document.body.append(m);
    const x = e.clientX || e.target.getBoundingClientRect().left, y = e.clientY || e.target.getBoundingClientRect().bottom;
    m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(y + 4, innerHeight - m.offsetHeight - 8) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }
  const folderMenu = (f, e) => rowMenu('f:' + f, e);
    // リンクを押した：あれば開く、なければ作る（Obsidian と同じ）
  async function openLink(target) {
    const [name, heading] = String(target).split('#');
    const n = resolve(name, cur?.path);
    if (n) { await open(n.path); if (heading) scrollToHeading(heading); return; }
    const folder = name.includes('/') ? folderOf(name) : (cur ? folderOf(cur.path) : '');
    const r = await ctx.api.notes.create(folder, name.split('/').pop(), '');
    if (r && r.error) { toast(r.error, 'warn'); return; }
    await load();
    await open(r.path, { edit: true });
    toast(`「${name}」を作りました`);
  }

  // ================= 表示 =================
  function render() {
    if (!box) return;
    if (!info.ready) return renderSetup();
    if (!cur) return panes.length > 1 ? renderPick() : renderHome();
    const mode = view();
    // 書いている途中は、エディタを作り直さない（カーソルが飛ばないように）
    // 同じノート・同じ表示なら、エディタは作り直さない（書いている途中にカーソルやフォーカスが外れないように）
    const oldTa = box.querySelector('.nt-editor');
    if (oldTa && box.dataset.path === cur.path && box.dataset.mode === mode) {
      if (!cur.dirty && oldTa.value !== cur.text) {
        // ほかのアプリで書き換えられた内容を、カーソルの位置を保ったまま反映
        const a = oldTa.selectionStart, b = oldTa.selectionEnd, top = oldTa.scrollTop;
        oldTa.value = cur.text;
        oldTa.setSelectionRange(Math.min(a, cur.text.length), Math.min(b, cur.text.length));
        oldTa.scrollTop = top;
      }
      paintHl(oldTa);
      renderPreview();
      renderInfo();
      applyLayout();
      return;
    }
    box.innerHTML = '';
    box.dataset.path = cur.path;
    box.dataset.mode = mode;
    const wrap = el('div', 'nt-wrap mode-' + mode);
    const ed = el('div', 'nt-edit');
    const ta = el('textarea', 'nt-editor');
    ta.value = cur.text;
    ta.spellcheck = false;
    ta.placeholder = '# 見出し\n\n本文を書きます。[[ でほかのノートへのリンク、#タグ、- [ ] チェックリスト';
    ta.addEventListener('input', () => { changed(ta.value); suggest(ta); paintHl(ta); });
    ta.addEventListener('keydown', e => editorKey(e, ta));
    // 画像：貼り付け（スクリーンショットなど）・ファイルをドラッグして入れる
    ta.addEventListener('paste', e => { const fs = imageFiles(e.clipboardData); if (fs.length) { e.preventDefault(); addImages(ta, fs); return; } linePaste(e, ta); });
    ta.addEventListener('copy', e => lineCopy(e, ta, false));
    ta.addEventListener('cut', e => lineCopy(e, ta, true));
    ta.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; ta.classList.add('nt-dropImg'); } });
    ta.addEventListener('dragleave', () => ta.classList.remove('nt-dropImg'));
    ta.addEventListener('drop', e => {
      ta.classList.remove('nt-dropImg');
      const fs = imageFiles(e.dataTransfer);
      if (!fs.length) { if (e.dataTransfer?.files?.length) { e.preventDefault(); toast('画像（png・jpg・gif・webp・svg など）だけ入れられます', 'warn'); } return; }
      e.preventDefault();
      // 落とした位置にカーソルを移してから入れる
      const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
      if (pos && pos.offsetNode === ta) ta.setSelectionRange(pos.offset, pos.offset);
      addImages(ta, fs);
    });
    ta.addEventListener('blur', () => { setTimeout(() => hideSuggest(), 150); saveNow(); });
    ta.addEventListener('scroll', () => { syncScroll(ta); const pre = area.querySelector('.nt-hl'); if (pre) pre.scrollTop = ta.scrollTop; });
    const area = el('div', 'nt-edArea');
    const pre = el('div', 'nt-hl');
    pre.setAttribute('aria-hidden', 'true');
    area.append(pre, ta);
    const pbox = el('div', 'nt-props');
    ed.append(editBar(ta));
    if (mode === 'edit') ed.append(pbox);
    ed.append(area);
    const pv = el('div', 'nt-preview');
    const ttl = el('div', 'inline-title');
    ttl.title = '押して名前を変更';
    ttl.addEventListener('click', rename);
    pv.append(ttl);
    if (mode !== 'edit') pv.append(pbox);
    const doc = el('div', 'markdown-preview-view markdown-rendered nt-doc');
    pv.append(doc);
    const inf = el('aside', 'nt-info');
    wrap.append(ed, pv, inf);
    applyLayout(wrap);
    box.append(wrap);
    renderPreview();
    renderInfo();
    paintHl(ta);
  }

  // ================= 書く画面の装飾（入力欄の後ろに、同じ文字を色付きで重ねる） =================
  // 入力欄（textarea）はそのままで文字だけ透明にし、後ろの <pre> に装飾した同じ文字を描く。
  // 文字の幅が変わらない装飾（色・太さ・背景・下線）だけを使うので、カーソルの位置はずれない。
  const hesc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const sp = (cls, s) => `<span class="${cls}">${s}</span>`;
  const mk = s => sp('hl-mk', hesc(s));
  const INLINE = new RegExp([
    '(`[^`\\n]+`)',                                  // 1 コード
    '(!?\\[\\[[^\\]\\n]+\\]\\])',                     // 2 [[リンク]]
    '(!?\\[[^\\]\\n]*\\]\\([^)\\s]*\\))',             // 3 [文字](URL)
    '(\\*\\*[^*\\n]+?\\*\\*|__[^_\\n]+?__)',          // 4 太字
    '(~~[^~\\n]+?~~)',                                // 5 取り消し線
    '(==[^=\\n]+?==)',                                // 6 ハイライト
    '(\\*[^*\\s\\n][^*\\n]*?\\*)',                    // 7 斜体
    '(<u>[^\\n]*?<\\/u>)',                            // 8 下線
    '((?<=^|\\s)#[^\\s#.,!?;:()\\[\\]{}"\'`、。]+)',  // 9 #タグ
    '(https?:\\/\\/[^\\s)>\\]]+)',                    // 10 URL
  ].join('|'), 'gu');
  function hlInline(t) {
    let out = '', last = 0, m;
    const re = new RegExp(INLINE.source, 'gu');     // 入れ子で呼ぶので、毎回新しく作る
    while ((m = re.exec(t))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += hesc(t.slice(last, m.index));
      const x = m[0];
      if (m[1]) out += sp('hl-code', mk('`') + hesc(x.slice(1, -1)) + mk('`'));
      else if (m[2]) { const e = x[0] === '!'; out += sp('hl-link', mk(e ? '![[' : '[[') + hesc(x.slice(e ? 3 : 2, -2)) + mk(']]')); }
      else if (m[3]) { const i = x.indexOf(']('); out += sp('hl-link', mk(x.slice(0, x[0] === '!' ? 2 : 1)) + hesc(x.slice(x[0] === '!' ? 2 : 1, i)) + mk(x.slice(i))); }
      else if (m[4]) out += sp('hl-b', mk(x.slice(0, 2)) + hlInline(x.slice(2, -2)) + mk(x.slice(-2)));
      else if (m[5]) out += sp('hl-s', mk('~~') + hlInline(x.slice(2, -2)) + mk('~~'));
      else if (m[6]) out += sp('hl-mark', mk('==') + hlInline(x.slice(2, -2)) + mk('=='));
      else if (m[7]) out += sp('hl-i', mk('*') + hlInline(x.slice(1, -1)) + mk('*'));
      else if (m[8]) out += sp('hl-u', mk('<u>') + hlInline(x.slice(3, -4)) + mk('</u>'));
      else if (m[9]) out += sp('hl-tag', hesc(x));
      else if (m[10]) out += sp('hl-url', hesc(x));
      last = m.index + x.length;
    }
    return out + hesc(t.slice(last));
  }
  function hlMarkdown(text) {
    const lines = text.split('\n');
    const out = [];
    let i = 0, fence = null;
    // 先頭のプロパティ（---）
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) {
        out.push(sp('hl-fm hl-mk', '---'));
        for (i = 1; i < end; i++) {
          const m = lines[i].match(/^(\s*-?\s*)([^:]*:)?(.*)$/);
          out.push(sp('hl-fm', hesc(m[1]) + (m[2] ? sp('hl-fmKey', hesc(m[2])) : '') + hesc(m[3])));
        }
        out.push(sp('hl-fm hl-mk', '---'));
        i = end + 1;
      }
    }
    for (; i < lines.length; i++) {
      const L = lines[i];
      let m;
      if (fence) {                                         // コードブロックの中
        if (L.trimStart().startsWith(fence)) { out.push(sp('hl-cb hl-mk', hesc(L))); fence = null; }
        else out.push(sp('hl-cb', hesc(L)));
        continue;
      }
      if ((m = L.match(/^(\s*)(```+|~~~+)(.*)$/))) { fence = m[2]; out.push(sp('hl-cb', hesc(m[1]) + mk(m[2]) + sp('hl-lang', hesc(m[3])))); continue; }
      if ((m = L.match(/^(#{1,6})(\s+)(.*)$/))) { out.push(sp(`hl-h hl-h${m[1].length}`, mk(m[1]) + m[2] + hlInline(m[3]))); continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(L)) { out.push(mk(L)); continue; }
      if ((m = L.match(/^((?:\s*>\s?)+)(.*)$/))) {
        const c = m[2].match(/^\[!([^\]]+)\]([+-]?)(.*)$/);
        if (c) out.push(sp('hl-quote', mk(m[1]) + sp('hl-coTitle', mk(`[!${c[1]}]${c[2]}`) + hlInline(c[3]))));
        else out.push(sp('hl-quote', mk(m[1]) + listLine(m[2])));
        continue;
      }
      if (/^\s*\|/.test(L)) {                             // 表：| は控えめに
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(L)) out.push(sp('hl-tbl', hesc(L)));
        else out.push(L.split('|').map(hlInline).join(sp('hl-tbl', '|')));
        continue;
      }
      out.push(listLine(L));
    }
    return out.join('\n');
  }
  function listLine(L) {
    const m = L.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s)?(.*)$/);
    if (!m) return hlInline(L);
    const done = m[4] && /x/i.test(m[4]);
    return hesc(m[1]) + sp('hl-li', hesc(m[2])) + m[3] + (m[4] ? sp('hl-task' + (done ? ' done' : ''), hesc(m[4])) : '') + (done ? sp('hl-done', hlInline(m[5])) : hlInline(m[5]));
  }
  // 入力欄の内容が変わったら、後ろの装飾を描き直す（まとめて1フレームに1回）
  function paintHl(ta = box?.querySelector('.nt-editor')) {
    if (!ta || ta._hlFrame) return;   // 列ごとに（ほかの列の描き直しで飛ばされないように）
    if (ta.closest('.nt-wrap')?.classList.contains('mode-preview')) return;   // 読む画面ではエディタが見えないので作らない（並べる・書くにしたときに作る）
    ta._hlFrame = requestAnimationFrame(() => {
      ta._hlFrame = 0;
      const pre = ta.parentElement?.querySelector('.nt-hl');
      if (!pre) return;
      pre.innerHTML = hlMarkdown(ta.value) + '\n ';
      pre.scrollTop = ta.scrollTop;
    });
  }

  function renderSetup() {
    box.innerHTML = '';
    const c = el('div', 'nt-setup');
    const ic = el('div', 'nt-setupIc'); ic.innerHTML = icon('notebook-text');
    c.append(ic, el('h2', '', 'ノートを保存するフォルダを選びましょう'),
      el('p', '', 'ノートはそのフォルダの中に Markdown（.md）ファイルとして保存されます。Obsidian の Vault（保管庫）を選ぶと、Obsidian と同じノートをここでも読み書きできます。'));
    const row = el('div', 'nt-setupBtns');
    row.append(
      btn('btn primary', ['folder-open', 'フォルダを選ぶ（Vault も可）'], async () => { const r = await ctx.api.notes.choose(); if (r) { await load(); ctx.refresh(); } }),
      btn('btn white', ['folder-plus', '書類フォルダに新しく作る'], async () => { const r = await ctx.api.notes.useDefault(); if (r?.error) return toast(r.error, 'warn'); await load(); const w = data.notes.find(n => n.name === 'はじめに'); if (w) await open(w.path); else ctx.refresh(); }));
    c.append(row, el('small', '', 'あとから設定で変えられます。ノートの中身がインターネットに送られることはありません。'));
    box.append(c);
  }

  function renderHome() {
    box.innerHTML = '';
    box.dataset.path = '';
    box.dataset.mode = '';
    const h = el('div', 'nt-home');
    const list = filtered().sort((a, b) => b.mtime - a.mtime).slice(0, 30);
    h.append(el('p', 'nt-homeHead', tagFilter ? `#${tagFilter} のノート（${list.length}件）` : '最近のノート'));
    const grid = el('div', 'nt-cards');
    for (const n of list) {
      const c = el('button', 'nt-card');
      c.type = 'button';
      c.append(el('b', '', n.name), el('p', '', n.excerpt || '（空のノート）'));
      const meta = el('small', '');
      meta.append([n.folder, n.mtime > 1e11 ? new Date(n.mtime).toLocaleDateString('ja-JP') : ''].filter(Boolean).join('・')   /* MDWS: 書いた日がわからない（GitHub）ときは出さない */);
      c.append(meta);
      c.addEventListener('click', e => (e.altKey ? openSide(n.path) : open(n.path)));
      c.title = '⌥クリックで横に開く';
      grid.append(c);
    }
    if (!list.length) grid.append(withIcon('p', 'nt-empty', 'notebook-text', 'まだノートはありません。「新しいノート」から書き始めましょう。'));
    h.append(grid);
    box.append(h);
  }
  const filtered = () => data.notes.filter(n => !tagFilter || n.tags.includes(tagFilter));
  // 空いている列：開くノートを選ぶ（最近のノート・名前と本文で検索）
  function renderPick() {
    if (box.dataset.mode === 'pick' && box.querySelector('.nt-pick')) { box._pickDraw?.(); return; }
    box.innerHTML = '';
    box.dataset.path = '';
    box.dataset.mode = 'pick';
    const w = el('div', 'nt-pick');
    const q = el('input', 'inp');
    q.type = 'search';
    q.placeholder = 'ノートを探す（名前・本文）';
    const list = el('div', 'nt-pickList');
    const draw = () => {
      const k = q.value.trim().toLowerCase();
      const shown = new Set(panes.map(p => curOf(p)?.path));
      list.innerHTML = '';
      const hits = data.notes.filter(n => !k || (n.name + ' ' + n.folder + ' ' + n.excerpt).toLowerCase().includes(k)).sort((a, b) => b.mtime - a.mtime).slice(0, 40);
      for (const n of hits) {
        const b = el('button', 'nt-pickRow' + (shown.has(n.path) ? ' open' : ''));
        b.type = 'button';
        b.innerHTML = icon('file-text');
        const tx = el('span', 'tx');
        tx.append(el('b', '', n.name), el('small', '', [n.folder, n.mtime > 1e11 ? new Date(n.mtime).toLocaleDateString('ja-JP') : ''].filter(Boolean).join('・')   /* MDWS: 書いた日がわからない（GitHub）ときは出さない */));
        b.append(tx);
        if (shown.has(n.path)) b.append(el('small', 'st', 'ほかの列で開いています'));
        b.addEventListener('click', () => open(n.path));
        list.append(b);
      }
      if (!hits.length) list.append(el('p', 'nt-none', '見つかりませんでした'));
    };
    box._pickDraw = draw;
    q.addEventListener('input', draw);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); list.querySelector('button')?.click(); } });
    w.append(withIcon('p', 'nt-homeHead', 'square-split-horizontal', 'この列に開くノート'), q, list);
    box.append(w);
    draw();
  }

  // ---------- Markdown → 画面 ----------
  let markedReady = false;
  function setupMarked() {
    if (markedReady) return;
    markedReady = true;
    const { marked } = window;
    marked.use({
      gfm: true, breaks: true,
      extensions: [
        { // ![[埋め込み]] と [[リンク]]
          name: 'wikilink', level: 'inline',
          start: src => { const i = src.indexOf('[['); return i < 0 ? undefined : (src[i - 1] === '!' ? i - 1 : i); },
          tokenizer(src) {
            const m = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src);
            if (!m) return;
            const [target, alias] = m[2].split('|');
            return { type: 'wikilink', raw: m[0], embed: !!m[1], target: target.trim(), alias: (alias || '').trim() };
          },
          renderer(t) {
            if (t.embed) {
              const f = resolveFile(t.target.split('#')[0], cur?.path);
              if (f && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f)) {
                const [, w] = /^(\d+)(?:x\d+)?$/.exec(t.alias) || [];
                return `<img class="nt-img" data-vault="${esc(f)}" src="${esc(vaultUrl(f))}" alt="${esc(t.target)}"${w ? ` width="${w}"` : ''}>`;   // MDWS: data-vault
              }
              const n = resolve(t.target.split('#')[0], cur?.path);
              return `<a class="internal-link nt-embed${n ? '' : ' is-unresolved'}" data-href="${esc(t.target)}" href="#">${esc(t.alias || t.target)}</a>`;
            }
            const n = resolve(t.target.split('#')[0], cur?.path);
            const label = t.alias || t.target.replace(/#/, ' › ');
            return `<a class="internal-link${n ? '' : ' is-unresolved'}" data-href="${esc(t.target)}" href="#">${esc(label)}</a>`;
          },
        },
        { // %%コメント%%（Obsidian と同じく、読む画面には出さない）。行頭から始まる複数行も
          name: 'cmtBlock', level: 'block',
          start: src => { const m = /(^|\n)%%/.exec(src); return m ? m.index + m[1].length : undefined; },
          tokenizer(src) { const m = /^%%[\s\S]*?%%[^\n]*(?:\n|$)/.exec(src); if (m && /^%%[\s\S]*?%%\s*(?:\n|$)/.test(m[0])) return { type: 'cmtBlock', raw: m[0] }; },
          renderer: () => '',
        },
        {
          name: 'cmt', level: 'inline',
          start: src => { const i = src.indexOf('%%'); return i < 0 ? undefined : i; },
          tokenizer(src) { const m = /^%%[\s\S]*?%%/.exec(src); if (m) return { type: 'cmt', raw: m[0] }; },
          renderer: () => '',
        },
        { // ==ハイライト==
          name: 'mark', level: 'inline',
          start: src => { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
          tokenizer(src) {
            const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
            if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
          },
          renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
        },
        { // #タグ
          name: 'tag', level: 'inline',
          start: src => { const m = /(^|[\s(（「、。])#[^\s#]/.exec(src); return m ? m.index + m[1].length : undefined; },
          tokenizer(src) {
            const m = /^#([^\s#.,;:!?()[\]{}"'`、。「」（）<>]+)/.exec(src);
            if (m && !/^\d+$/.test(m[1])) return { type: 'tag', raw: m[0], tag: m[1] };
          },
          renderer(t) { return `<a class="tag" data-tag="${esc(t.tag)}" href="#">#${esc(t.tag)}</a>`; },
        },
      ],
    });
  }

  // 先頭のプロパティ（--- で囲まれた部分）を取り出す
  function splitFrontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
    if (!m) return { props: null, body: text, lines: 0 };
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
    return { props, body: text.slice(m[0].length), lines: m[0].split('\n').length - 1 };
  }

  function renderPreview() {
    const doc = box?.querySelector('.nt-doc');
    if (!doc || !cur) return;
    // 中身もノートの一覧も前と同じなら作り直さない（画面の描き直し・タイマーやタスクの更新のたびに、Markdown の変換と画面の計算が走らないように）
    const key = cur.path + '\u0000' + dataVer + '\u0000' + cur.text;
    if (doc._key === key && doc.firstChild) return;
    doc._key = key;
    setupMarked();
    const st = doc.parentElement.scrollTop;
    const { props, body } = splitFrontmatter(cur.text);
    let html = '';
    try { html = window.marked.parse(body); } catch (e) { html = `<pre>${esc(e.message)}</pre>`; }
    const clean = window.DOMPurify.sanitize(html, {
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|vault):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
      ADD_ATTR: ['target'],
    });
    doc.innerHTML = '';
    // タイトル（ファイル名）を Obsidian のように上に出す
    // タイトル（ファイル名）→ プロパティ → 本文 の順。本文の最初が同じ名前の見出しなら、タイトルは出さない
    const title = box.querySelector('.nt-preview > .inline-title');
    if (title) {
      title.textContent = nameOf(cur.path);
      const firstH1 = /^#\s+(.+?)\s*$/.exec(body.trimStart().split('\n')[0]);
      title.hidden = !!(firstH1 && firstH1[1].trim() === nameOf(cur.path));
    }
    renderProps();
    const content = el('div', 'nt-content');
    content.innerHTML = clean;
    doc.append(content);
    decorate(content);
    doc.parentElement.scrollTop = st;
  }
  // ================= プロパティ（先頭の --- の中）を入力欄で編集 =================
  // 対応する形：文字・数・日付・はい/いいえ・一覧（tags など）。それ以外の複雑な書き方はそのまま残す
  const LIST_KEYS = /^(tags|tag|aliases|alias|cssclasses|cssclass|project)$/i;
  function fmParse(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(\r?\n|$)/.exec(text);
    if (!m) return { props: [], body: text };
    const lines = m[1] === '' ? [] : m[1].split(/\r?\n/);
    const props = [];
    for (let i = 0; i < lines.length; i++) {
      const kv = /^([^\s:#-][^:]*):(?:\s+(.*)|\s*)$/.exec(lines[i]);
      if (!kv) { if (props.length) props[props.length - 1].raw.push(lines[i]); else props.push({ key: '', type: 'raw', raw: [lines[i]] }); continue; }
      const key = kv[1].trim(), v = (kv[2] || '').trim();
      const p = { key, raw: [lines[i]] };
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) { items.push(unq(lines[i + 1].replace(/^\s+-\s*/, ''))); p.raw.push(lines[++i]); }
      // 字下げが続く（入れ子の書き方）ときは、編集せずにそのまま残す
      let nested = false;
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s+-/.test(lines[i + 1])) { p.raw.push(lines[++i]); nested = true; }
      if (nested) p.type = 'raw';
      else if (items.length || (!v && LIST_KEYS.test(key))) Object.assign(p, { type: 'list', value: items });
      else if (/^\[.*\]$/.test(v)) Object.assign(p, { type: 'list', value: v.slice(1, -1).split(',').map(x => unq(x.trim())).filter(Boolean), flow: true });
      else if (/^["'].*["']$/.test(v)) Object.assign(p, { type: 'text', value: unq(v), quoted: true });
      else if (/^-?\d+(\.\d+)?$/.test(v)) Object.assign(p, { type: 'number', value: Number(v) });
      else if (/^(true|false)$/i.test(v)) Object.assign(p, { type: 'bool', value: /^true$/i.test(v) });
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v) || (!v && /^(date|日付|day|created)$/i.test(key))) Object.assign(p, { type: 'date', value: v });
      else Object.assign(p, { type: 'text', value: v });
      props.push(p);
    }
    return { props, body: text.slice(m[0].length) };
  }
  const unq = v => String(v).replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  const needQuote = v => v !== '' && (/^[\s]|[\s]$|^[\[{>|*&!%@`#'"]|: | #/.test(v) || /^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null|yes|no)$/i.test(v));
  const yq = v => JSON.stringify(String(v));
  function fmSerialize(props) {
    const out = [];
    for (const p of props) {
      if (p.type === 'raw') { out.push(...p.raw); continue; }
      const k = p.key;
      if (p.type === 'list') {
        const vals = (p.value || []).map(x => (needQuote(x) ? yq(x) : x));
        if (p.flow) out.push(`${k}: [${vals.join(', ')}]`);
        else if (!vals.length) out.push(`${k}:`);
        else out.push(`${k}:`, ...vals.map(x => `  - ${x}`));
      } else if (p.type === 'number') out.push(p.value === '' || p.value == null || Number.isNaN(p.value) ? `${k}:` : `${k}: ${p.value}`);
      else if (p.type === 'bool') out.push(`${k}: ${p.value ? 'true' : 'false'}`);
      else if (p.type === 'date') out.push(p.value ? `${k}: ${p.value}` : `${k}:`);
      else out.push(p.value === '' ? (p.quoted ? `${k}: ""` : `${k}:`) : `${k}: ${p.quoted || needQuote(p.value) ? yq(p.value) : p.value}`);
    }
    return out;
  }
  // プロパティを書き換えて、本文（エディタ）にも反映
  function writeProps(props) {
    if (!cur) return;
    const { body } = fmParse(cur.text);
    const lines = fmSerialize(props);
    const next = (lines.length ? `---\n${lines.join('\n')}\n---\n` : '') + body;
    const ta = box?.querySelector('.nt-editor');
    if (ta) {
      const delta = next.length - ta.value.length;
      const a = ta.selectionStart, b = ta.selectionEnd;
      ta.value = next;
      const fmEnd = next.length - body.length;
      ta.setSelectionRange(a > fmEnd ? a + delta : a, b > fmEnd ? b + delta : b);
    }
    changed(next);
  }
  const todayKey = () => { const d = new Date(), p2 = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const TYPE_ICON = { text: 'text', number: 'hash', date: 'calendar-days', list: 'list', bool: 'square-check', raw: 'code' };
  const TYPE_LABEL = { text: '文字', number: '数', date: '日付', list: '一覧', bool: 'はい/いいえ' };
  function applyTemplate(t) {
    const { props } = fmParse(cur.text);
    for (const tp of t.props) {
      const v = tp.value === '@today' ? todayKey() : Array.isArray(tp.value) ? [...tp.value] : tp.value;
      const have = props.find(p => p.key === tp.key);
      if (!have) { props.push({ key: tp.key, type: tp.type, value: v, quoted: tp.quoted }); continue; }
      if (have.type === 'list' && Array.isArray(v)) have.value = [...new Set([...(have.value || []), ...v])];
      else if ((have.value === '' || have.value == null) && v !== '') have.value = v;
    }
    writeProps(props);
    renderProps(true);
    toast(`「${t.name}」のプロパティを入れました`);
  }
  function templateMenu(anchor) {
    const tpls = ctx.get().settings.notesPropTemplates || [];
    const items = tpls.map((t, i) => ({ icon: 'list-plus', label: `${t.name}（${t.props.map(p => p.key).join('・')}）`, run: () => applyTemplate(t), del: () => {
      if (!confirm(`ひな形「${t.name}」を削除しますか？`)) return;
      ctx.api.settings.set({ notesPropTemplates: tpls.filter((_, k) => k !== i) });
    } }));
    const { props } = fmParse(cur.text);
    menu([
      ...(items.length ? items : [{ icon: 'info', label: 'ひな形はまだありません', run: () => {} }]),
      '-',
      { icon: 'plus', label: '今のプロパティをひな形として保存', run: async () => {
        const list = props.filter(p => p.type !== 'raw' && p.key);
        if (!list.length) return toast('先にプロパティを入れてください', 'warn');
        const name = await askText('ひな形の名前', '', '例: 日誌');
        if (!name) return;
        const saved = list.map(p => ({ key: p.key, type: p.type, value: p.type === 'date' ? '@today' : p.value, quoted: !!p.quoted }));
        ctx.api.settings.set({ notesPropTemplates: [...tpls.filter(t => t.name !== name), { name, props: saved }] });
        toast(`ひな形「${name}」を保存しました（日付は「その日」になります）`);
      } },
    ], anchor);
  }
  // Vault 全体で使われているプロパティ（名前・型・値）を集める → 追加するときの候補に使う
  function propStats() {
    const m = new Map();
    const guess = v => (Array.isArray(v) ? 'list' : typeof v === 'boolean' || /^(true|false)$/i.test(v) ? 'bool' : /^-?\d+(\.\d+)?$/.test(String(v)) ? 'number' : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? 'date' : 'text');
    for (const n of data.notes) {
      for (const [k, v] of Object.entries(n.frontmatter || {})) {
        if (!m.has(k)) m.set(k, { key: k, count: 0, types: {}, values: new Set() });
        const st = m.get(k);
        st.count++;
        const t = (Array.isArray(v) && !v.length) ? (LIST_KEYS.test(k) ? 'list' : null) : (n.fmQuoted || []).includes(k) ? 'text' : guess(v);
        if (t) st.types[t] = (st.types[t] || 0) + 1;
        for (const x of [].concat(v)) if (x !== '' && x != null && String(x).length < 60) st.values.add(String(x));
      }
    }
    // tags はノートの中の #タグ も候補に
    const tg = m.get('tags');
    if (tg) data.notes.forEach(n => n.tags.forEach(t => tg.values.add(t)));
    for (const st of m.values()) st.type = Object.entries(st.types).sort((a, b) => b[1] - a[1])[0]?.[0] || (LIST_KEYS.test(st.key) ? 'list' : /^(date|日付)$/i.test(st.key) ? 'date' : 'text');
    return m;
  }
  function datalist(id, values) {
    let dl = document.getElementById(id);
    if (!dl) { dl = el('datalist'); dl.id = id; document.body.append(dl); }
    dl.innerHTML = '';
    [...values].slice(0, 200).forEach(v => { const o = el('option'); o.value = typeof v === 'string' ? v : v.value; if (v.label) o.label = v.label; dl.append(o); });
    return id;
  }
  const blankOf = t => (t === 'list' ? [] : t === 'number' ? 0 : t === 'bool' ? false : t === 'date' ? todayKey() : '');
  // 型を変えるとき、今の値をできるだけ引き継ぐ
  function convert(p, t) {
    const v = p.value;
    if (t === 'list') p.value = Array.isArray(v) ? v : v === '' || v == null ? [] : [String(v)];
    else if (t === 'number') p.value = Number(Array.isArray(v) ? v[0] : v) || 0;
    else if (t === 'bool') p.value = !!v && v !== 'false';
    else if (t === 'date') p.value = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? v : todayKey();
    else p.value = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
    p.type = t;
    delete p.flow;
  }
  function renderProps(force) {
    const pb = box?.querySelector('.nt-props');
    if (!pb || !cur) return;
    const { props } = fmParse(cur.text);
    const sig = JSON.stringify(props.map(p => [p.key, p.type, p.value, p.raw]));
    const typingHere = pb.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (!force && (pb.dataset.sig === sig || typingHere)) return;
    pb.dataset.sig = sig;
    pb.innerHTML = '';
    const head = el('div', 'nt-propsHead');
    head.append(withIcon('span', 'ttl', 'list', 'プロパティ'));
    const tb = btn('nt-pBtn', ['list-plus', 'ひな形'], e => templateMenu(e), 'よく使うプロパティをまとめて入れる');
    head.append(tb);
    pb.append(head);
    pb.classList.toggle('empty', !props.length);
    const grid = el('div', 'nt-pGrid');
    const commit = () => writeProps(props);
    const stats = propStats();
    props.forEach((p, idx) => {
      if (p.type === 'raw') {
        if (!p.key) return;
        const r = el('div', 'nt-pRow raw');
        r.append(withIcon('span', 'k', TYPE_ICON.raw, p.key), el('code', 'v', p.raw.slice(1).join(' ').trim() || '（書式が複雑なのでエディタで編集）'));
        grid.append(r);
        return;
      }
      const r = el('div', 'nt-pRow');
      const k = el('span', 'k');
      const tIc = btn('nt-pType', TYPE_ICON[p.type] || 'text', e => menu(Object.entries(TYPE_LABEL).map(([t, l]) => ({ icon: TYPE_ICON[t], label: (t === p.type ? '✓ ' : '') + l, run: () => { convert(p, t); commit(); renderProps(true); } })), e), `型：${TYPE_LABEL[p.type] || ''}（押して変える）`);
      const kName = el('span', 'kn', p.key);
      kName.title = '押して名前を変える';
      kName.addEventListener('click', () => {
        const inp = el('input', 'nt-pIn kIn'); inp.value = p.key;
        const done = ok => {
          const name = inp.value.trim().replace(/:/g, '');
          if (ok && name && name !== p.key) {
            if (props.some(x => x !== p && x.key === name)) { toast(`「${name}」はもうあります`, 'warn'); }
            else { p.key = name; commit(); }
          }
          renderProps(true);
        };
        inp.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
        kName.replaceWith(inp);
        inp.select();
      });
      k.append(tIc, kName);
      k.title = `${p.key}（${TYPE_LABEL[p.type] || ''}）`;
      const v = el('div', 'v');
      if (p.type === 'number') {
        const inp = el('input', 'nt-pIn num'); inp.type = 'number'; inp.value = p.value ?? '';
        inp.addEventListener('input', () => { p.value = inp.value === '' ? '' : Number(inp.value); commit(); });
        const step = d => { p.value = (Number(p.value) || 0) + d; inp.value = p.value; commit(); };
        v.append(btn('nt-pStep', 'minus', () => step(-1), '1 減らす'), inp, btn('nt-pStep', 'plus', () => step(1), '1 増やす'));
      } else if (p.type === 'date') {
        const inp = el('input', 'nt-pIn date'); inp.type = 'date'; inp.value = p.value || '';
        inp.addEventListener('change', () => { p.value = inp.value; commit(); });
        v.append(inp, btn('nt-pChip', '今日', () => { p.value = todayKey(); inp.value = p.value; commit(); }, '今日の日付を入れる'));
      } else if (p.type === 'bool') {
        const cb = el('input', 'nt-pCheck'); cb.type = 'checkbox'; cb.checked = !!p.value;
        cb.addEventListener('change', () => { p.value = cb.checked; commit(); });
        v.append(cb);
      } else if (p.type === 'list') {
        const chips = el('div', 'nt-pChips');
        (p.value || []).forEach((x, i) => {
          const c = el('span', 'nt-pTag');
          c.append(/^tags?$/i.test(p.key) ? '#' + x : x, btn('nt-pX', 'x', () => { p.value.splice(i, 1); commit(); renderProps(true); }, '外す'));
          chips.append(c);
        });
        const inp = el('input', 'nt-pIn add'); inp.placeholder = '＋ 入力して Enter';
        const sv = stats.get(p.key);
        if (sv) inp.setAttribute('list', datalist('ntVals-' + idx, [...sv.values].filter(x => !(p.value || []).includes(x))));
        inp.addEventListener('keydown', e => {
          if (e.isComposing) return;
          if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); (p.value ||= []).push(inp.value.trim().replace(/^#/, '')); inp.value = ''; commit(); renderProps(true); pb.querySelectorAll('.nt-pRow')[idx]?.querySelector('.add')?.focus(); }
          if (e.key === 'Backspace' && !inp.value && p.value?.length) { p.value.pop(); commit(); renderProps(true); pb.querySelectorAll('.nt-pRow')[idx]?.querySelector('.add')?.focus(); }
        });
        chips.append(inp);
        v.append(chips);
      } else {
        const inp = el('input', 'nt-pIn'); inp.value = p.value ?? '';
        const sv = stats.get(p.key);
        if (sv && sv.values.size) inp.setAttribute('list', datalist('ntVals-' + idx, sv.values));
        inp.addEventListener('input', () => { p.value = inp.value; commit(); });
        v.append(inp);
      }
      const del = btn('nt-pDel', 'x', () => { props.splice(idx, 1); commit(); renderProps(true); }, 'このプロパティを消す');
      r.append(k, v, del);
      grid.append(r);
    });
    pb.append(grid);
    // いちばん下の「＋ プロパティを追加」。名前を入れると、Vault で使っている名前を候補に出し、型も合わせる
    const addBtn = el('button', 'nt-pAdd');
    addBtn.type = 'button';
    addBtn.innerHTML = icon('plus');
    addBtn.append('プロパティを追加');
    addBtn.addEventListener('click', () => addRow());
    pb.append(addBtn);
    function addRow(preset = '') {
      if (pb.querySelector('.nt-pNew')) { pb.querySelector('.nt-pNew input').focus(); return; }
      addBtn.hidden = true;
      const r = el('div', 'nt-pRow nt-pNew');
      const key = el('input', 'nt-pIn'); key.placeholder = '名前（例: exercise）'; key.value = preset;
      const unused = [...stats.values()].filter(st => !props.some(p => p.key === st.key)).sort((a, b) => b.count - a.count);
      key.setAttribute('list', datalist('ntKeys', unused.map(st => ({ value: st.key, label: `${TYPE_LABEL[st.type] || ''}・${st.count}件のノートで使用` }))));
      const type = el('select', 'nt-pIn');
      for (const [t, l] of Object.entries(TYPE_LABEL)) type.append(new Option(l, t));
      const guessType = () => {
        const name = key.value.trim();
        const st = stats.get(name);
        type.value = st ? st.type : /^(date|日付|day)$/i.test(name) ? 'date' : LIST_KEYS.test(name) ? 'list' : type.value;
      };
      const add = () => {
        const name = key.value.trim().replace(/:/g, '');
        if (!name) return key.focus();
        if (props.some(p => p.key === name)) return toast(`「${name}」はもうあります`, 'warn');
        const st = stats.get(name);
        const quoted = type.value === 'text' && st && [...st.values].some(x => /^-?\d+(\.\d+)?$/.test(x));
        props.push({ key: name, type: type.value, value: blankOf(type.value), quoted });
        commit();
        renderProps(true);
        // 入れたプロパティの値の欄へすぐ移る
        const rows = pb.querySelectorAll('.nt-pRow:not(.nt-pNew)');
        rows[rows.length - 1]?.querySelector('input.nt-pIn, input.nt-pCheck')?.focus();
      };
      const ok = btn('btn primary sm', '追加', add);
      const cancel = btn('nt-pDel vis', 'x', () => { r.remove(); addBtn.hidden = false; }, 'やめる');
      key.addEventListener('input', guessType);
      key.addEventListener('change', guessType);
      key.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); guessType(); add(); } if (e.key === 'Escape') cancel.click(); });
      r.append(key, type, ok, cancel);
      grid.append(r);
      pb.classList.remove('empty');
      key.focus();
      if (preset) guessType();
    }
    pb._addRow = addRow;
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
  // 画面に出したあとの仕上げ：コールアウト、チェックリスト、リンク、見出しの目印
  function decorate(root) {
    // > [!type] タイトル → コールアウト
    for (const bq of [...root.querySelectorAll('blockquote')]) {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') continue;
      const m = /^\s*\[!([\w-]+)\]([+-]?)/.exec(p.textContent);
      if (!m) continue;
      // 1行目（[!type] タイトル）と残りを分ける（改行は <br> になっている）
      const parts = p.innerHTML.split(/<br\s*\/?>\n?/i);
      const titleHtml = parts.shift().replace(/^\s*\[![\w-]+\][+-]?\s*/, '').trim();
      const type = m[1].toLowerCase();
      const c = el('div', 'callout' + (m[2] ? ' is-collapsible' : '') + (m[2] === '-' ? ' is-collapsed' : ''));
      c.dataset.callout = type;
      const head = el('div', 'callout-title');
      const ic = el('div', 'callout-icon');
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
      // アイコン：CSS の --callout-icon（スニペットで変えられる）→ 種類ごとの既定
      requestAnimationFrame(() => {
        const v = getComputedStyle(c).getPropertyValue('--callout-icon').trim().replace(/^["']|["']$/g, '').replace(/^lucide-/, '');
        const name = window.ICONS[v] ? v : CALLOUT_ICON[type] || 'pencil';
        ic.innerHTML = icon(name);
      });
    }
    // チェックリスト：押すとファイルにも反映
    const boxes = [...root.querySelectorAll('input[type="checkbox"]')];
    const lines = taskLines(cur.text);
    boxes.forEach((cb, i) => {
      cb.disabled = false;
      cb.classList.add('task-list-item-checkbox');
      cb.closest('li')?.classList.add('task-list-item');
      if (cb.checked) cb.closest('li')?.classList.add('is-checked');
      // 右クリック：この項目をタスクにする
      cb.closest('li')?.addEventListener('contextmenu', ev => {
        const ln = lines[i];
        if (ln == null || ev.target.closest('li') !== cb.closest('li')) return;
        const m = /\[[ xX]\]\s+(.+)$/.exec(cur.text.split('\n')[ln] || '');
        const title = m ? plain(m[1]).slice(0, 200) : '';
        if (!title) return;
        ev.preventDefault();
        const all = openChecklist(cur.text);
        menu([
          { icon: 'list-plus', label: 'タスクにする', run: () => toTasks([{ title }]) },
          ...(all.length > 1 ? [{ icon: 'list-checks', label: `まだの項目をまとめてタスクにする（${all.length}件）`, run: () => toTasks(all) }] : []),
        ], ev);
      });
      cb.addEventListener('change', () => {
        const ln = lines[i];
        if (ln == null) return;
        const arr = cur.text.split('\n');
        arr[ln] = arr[ln].replace(/\[( |x|X)\]/, cb.checked ? '[x]' : '[ ]');
        const ta = box.querySelector('.nt-editor');
        if (ta) ta.value = arr.join('\n');
        changed(arr.join('\n'));
        saveNow();
      });
    });
    // 見出しに目印（目次から飛べるように）
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => { h.dataset.hi = i; });
    // コードブロックにコピー
    root.querySelectorAll('pre').forEach(pre => {
      const b = btn('nt-copy', 'copy', async () => { await ctx.api.app.copy(pre.innerText); toast('コピーしました'); }, 'コピー');
      pre.append(b);
    });
  }
  // チェックリストの行番号（コードの中は数えない）
  function taskLines(text) {
    const out = [];
    let fence = false;
    text.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
      if (!fence && /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.test(l)) out.push(i);
    });
    return out;
  }
  function headings(text) {
    const out = [];
    let fence = false;
    const { body, lines } = splitFrontmatter(text);
    body.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
      const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) out.push({ level: m[1].length, text: m[2], line: i + lines });
    });
    return out;
  }
  function scrollToHeading(name) {
    const want = String(name).trim().toLowerCase();
    const h = [...(box?.querySelectorAll('.nt-content h1,.nt-content h2,.nt-content h3,.nt-content h4,.nt-content h5,.nt-content h6') || [])].find(x => x.textContent.trim().toLowerCase() === want);
    h?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---------- 目次・バックリンク・タグ（右の列と、サイドバーの「目次」タブの両方に出す） ----------
  function renderInfo() {
    if (!cur) return;
    for (const inf of [box?.querySelector('.nt-info'), side?.querySelector('.nt-outline')]) if (inf) fillInfo(inf);
  }
  function fillInfo(inf) {
    inf.innerHTML = '';
    const hs = headings(cur.text);
    if (hs.length) {
      const sec = el('section', 'nt-sec');
      sec.append(withIcon('h4', '', 'list', '見出し'));
      const min = Math.min(...hs.map(h => h.level));
      hs.forEach((h, i) => {
        const b = el('button', 'nt-toc', h.text.replace(/[*_`=[\]]/g, ''));
        b.type = 'button';
        b.style.paddingLeft = 8 + (h.level - min) * 12 + 'px';
        b.addEventListener('click', () => {
          const tgt = box.querySelector(`.nt-content [data-hi="${i}"]`);
          if (tgt && view() !== 'edit') tgt.scrollIntoView({ block: 'start', behavior: 'smooth' });
          else gotoLine(h.line);
        });
        sec.append(b);
      });
      inf.append(sec);
    }
    const back = backlinksOf(cur.path);
    const sec2 = el('section', 'nt-sec');
    sec2.append(withIcon('h4', '', 'corner-up-left', `バックリンク ${back.length}`));
    if (!back.length) sec2.append(el('p', 'nt-none', 'このノートへのリンクはまだありません'));
    for (const n of back) {
      const b = el('button', 'nt-blink');
      b.type = 'button';
      b.append(el('b', '', n.name), el('small', '', n.excerpt.slice(0, 60)));
      b.addEventListener('click', () => open(n.path));
      sec2.append(b);
    }
    inf.append(sec2);
    const me = data.notes.find(n => n.path === cur.path);
    if (me && me.tags.length) {
      const sec3 = el('section', 'nt-sec');
      sec3.append(withIcon('h4', '', 'hash', 'タグ'));
      const w = el('div', 'nt-tags');
      me.tags.forEach(t => { const a = btn('nt-tagChip', '#' + t, () => filterTag(t)); w.append(a); });
      sec3.append(w);
      inf.append(sec3);
    }
    // チェックリスト → タスク
    const todo = ctx.openTaskBatch ? openChecklist(cur.text) : [];
    if (todo.length) {
      const sec5 = el('section', 'nt-sec');
      sec5.append(withIcon('h4', '', 'list-checks', `まだのチェックリスト ${todo.length}`));
      const { tasks = [] } = ctx.get();
      for (const it of todo.slice(0, 6)) {
        const row = el('div', 'nt-todo');
        const has = tasks.some(t => t.title === it.title);
        row.append(el('span', 'tx', it.title), has ? withIcon('small', 'nt-has', 'check', 'タスク') : btn('nt-add', ['plus', 'タスクに'], () => toTasks([it]), 'この項目をタスクにする'));
        sec5.append(row);
      }
      if (todo.length > 1) sec5.append(btn('nt-blink ghost', ['list-plus', `まとめてタスクにする（${todo.length}件）`], () => toTasks(todo)));
      inf.append(sec5);
    }
    // 本文の中のURL → ブックマーク
    if (me?.urls?.length && window.Bookmarks) {
      const sec6 = el('section', 'nt-sec');
      sec6.append(withIcon('h4', '', 'link', `リンク ${me.urls.length}`));
      const saved = new Set(window.Bookmarks.all().bookmarks.map(b => normUrl(b.url)));
      for (const u of me.urls.slice(0, 10)) {
        const row = el('div', 'nt-todo');
        const a = btn('nt-urlOpen', ['external-link', u.title || shortUrl(u.url)], () => ctx.api.app.openUrl(u.url), u.url + '（ブラウザで開く）');
        row.append(a, saved.has(normUrl(u.url)) ? withIcon('small', 'nt-has', 'bookmark-check', '保存済み') : btn('nt-add', ['bookmark', '保存'], e => addBookmark(u, e), 'ブックマークに保存'));
        sec6.append(row);
      }
      inf.append(sec6);
    }
    const unresolved = [...new Set((me?.links || []).filter(l => !l.embed && !resolve(l.target, cur.path)).map(l => l.target))];
    if (unresolved.length) {
      const sec4 = el('section', 'nt-sec');
      sec4.append(withIcon('h4', '', 'file-plus', 'まだないノート'));
      unresolved.forEach(t => { const b = btn('nt-blink ghost', t, () => openLink(t), '押すと作ります'); sec4.append(b); });
      inf.append(sec4);
    }
  }
  function gotoLine(line) {
    const ta = box.querySelector('.nt-editor');
    if (!ta) return;
    const pos = ta.value.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = pos;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    ta.scrollTop = Math.max(0, line * lh - 60);
  }
  // 並べて表示しているとき、エディタの位置に合わせてプレビューも動かす（だいたい）
  function syncScroll(ta) {
    const wrap = ta.closest('.nt-wrap');   // スクロールした列のプレビュー（今の列でなくても）
    if (!wrap?.classList.contains('mode-split')) return;
    const pv = wrap.querySelector('.nt-preview');
    const r = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
    pv.scrollTop = r * (pv.scrollHeight - pv.clientHeight);
  }

  // ================= ノートの中を検索（⌘F）：VS Code の検索のように、列の上に出す =================
  // 書く・並べる画面はエディタの文字、読む画面は表示した本文から探す。並べる画面では両方に色を付け、移動はエディタで。
  // 色付けは CSS Custom Highlight（文字の DOM は変えない）。列の中身が描き直されたら、見つけ直す
  let findQuery = '';
  const reEsc = q => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function findTargets(p) {
    const wrap = p.body.querySelector('.nt-wrap');
    if (!wrap) return [];
    const out = [];
    const ta = wrap.querySelector('.nt-editor'), pre = wrap.querySelector('.nt-hl'), doc = wrap.querySelector('.nt-doc .nt-content');
    if (ta && pre && !wrap.classList.contains('mode-preview')) out.push({ kind: 'edit', root: pre, ta, scroller: ta });
    if (doc && !wrap.classList.contains('mode-edit')) out.push({ kind: 'view', root: doc, scroller: doc.closest('.nt-preview') });
    return out;
  }
  // 文字のつながりと、どの文字がどのテキストノードにあるか
  function textIndex(root) {
    const nodes = [], starts = [];
    let text = '';
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { nodes.push(n); starts.push(text.length); text += n.data; }
    return { text, nodes, starts };
  }
  function rangeAt(ix, s, e) {
    const at = off => {
      let lo = 0, hi = ix.nodes.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ix.starts[mid] <= off) lo = mid; else hi = mid - 1; }
      return [ix.nodes[lo], off - ix.starts[lo]];
    };
    const r = document.createRange();
    const [a, ao] = at(s);
    const [b, bo] = at(e - 1);
    r.setStart(a, ao);
    r.setEnd(b, bo + 1);
    return r;
  }
  // 探す言葉から RegExp を作る（.* のときは正規表現として。書き方が違えば null）
  function findRe(f, flags = 'g') {
    try { return new RegExp(f.regex ? f.q : reEsc(f.q), flags + (f.matchCase ? '' : 'i') + 'u'); } catch { return null; }
  }
  const yIn = (t, r) => r.getBoundingClientRect().top - (t.kind === 'edit' ? t.root : t.scroller).getBoundingClientRect().top + (t.kind === 'edit' ? t.root : t.scroller).scrollTop;
  function paintFind() {
    if (!window.CSS?.highlights || !window.Highlight) return;
    const all = [], cur = [];
    for (const p of panes) if (p.find) { all.push(...p.find.all); if (p.find.cur) cur.push(p.find.cur); }
    const hc = new Highlight(...cur);
    hc.priority = 1;
    CSS.highlights.set('nt-find', new Highlight(...all));
    CSS.highlights.set('nt-find-cur', hc);
  }
  // 見つけ直す。jump のときは、探し始めた位置（カーソル・見ていた所）から先の最初の一致へ
  function refreshFind(p, jump) {
    const f = p.find;
    if (!f) return;
    const T = findTargets(p);
    f.targets = T;
    f.all = [];
    const re = f.q ? findRe(f) : null;
    if (re) {
      for (const t of T) {
        t.ix = textIndex(t.root);
        t.ms = [];
        for (let m; (m = re.exec(t.ix.text));) { if (!m[0]) { re.lastIndex++; continue; } t.ms.push([m.index, m.index + m[0].length]); }
        re.lastIndex = 0;
        for (const [a, b] of t.ms) f.all.push(rangeAt(t.ix, a, b));
      }
    }
    const main = T[0];
    const n = (re && main?.ms?.length) || 0;
    if (f.pending) { jump = true; f.pending = false; }
    if (jump && n) {
      if (f.goto) {                                        // 本文の検索から来たとき：その一致へ
        const g = f.goto;
        f.goto = null;
        f.idx = main.kind === 'edit' ? Math.max(0, main.ms.findIndex(([a]) => a >= g.offset)) : Math.min(n - 1, Math.max(0, g.nth));
      } else if (main.kind === 'edit') {
        const i = main.ms.findIndex(([a]) => a >= f.anchor);
        f.idx = i < 0 ? 0 : i;
      } else {
        const i = main.ms.findIndex(([a, b]) => yIn(main, rangeAt(main.ix, a, b)) >= f.anchor);
        f.idx = i < 0 ? 0 : i;
      }
    }
    f.idx = n ? Math.min(Math.max(0, f.idx), n - 1) : 0;
    f.cur = n ? rangeAt(main.ix, ...main.ms[f.idx]) : null;
    f.count.textContent = !f.q ? '' : !re ? '正規表現の書き方が違います' : n ? `${f.idx + 1} / ${n}` : '見つかりません';
    f.bar.classList.toggle('none', !!f.q && !n);
    paintFind();
    if (jump && f.cur) revealFind(main, f.cur);
  }
  // 一致が見えるところまでスクロール（見えていれば動かさない）
  function revealFind(t, r) {
    const sc = t.scroller;
    if (!sc) return;
    const y = yIn(t, r), h = r.getBoundingClientRect().height;
    if (y < sc.scrollTop + 16 || y + h > sc.scrollTop + sc.clientHeight - 24) sc.scrollTop = Math.max(0, y - sc.clientHeight / 3);
  }
  function stepFind(p, d) {
    const f = p?.find;
    const main = f?.targets?.[0];
    const n = (f?.q && main?.ms?.length) || 0;
    if (!n) return;
    f.idx = (f.idx + d + n) % n;
    f.cur = rangeAt(main.ix, ...main.ms[f.idx]);
    f.count.textContent = `${f.idx + 1} / ${n}`;
    paintFind();
    revealFind(main, f.cur);
  }
  // 選んでいる文字（1行だけ）があれば、それで探す
  function selectedText() {
    const a = document.activeElement;
    const t = a?.classList?.contains('nt-editor') ? a.value.slice(a.selectionStart, a.selectionEnd) : String(window.getSelection() || '');
    return t && !t.includes('\n') && t.length <= 200 ? t : '';
  }
  // 置換の行を出す・しまう。置換は書いている文字で行うので、読む画面なら「並べる」にする
  function showReplace(p, on) {
    const f = p?.find;
    if (!f) return;
    f.repOpen = on;
    f.repRow.hidden = !on;
    f.repToggle.classList.toggle('open', on);
    if (on && f.targets?.[0]?.kind !== 'edit') { withPane(p, () => setView('split')); toast('置換は書いている文字で行うので、「並べる」にしました'); }
    (on ? f.rep : f.input).focus();
  }
  // 今の1か所を置き換えて、次の一致へ（⌘Z で戻せる）
  function replaceOne(p) {
    const f = p?.find;
    const t = f?.targets?.[0];
    if (!f || t?.kind !== 'edit') return showReplace(p, true);
    if (!t.ms?.length) return;
    const [a, b] = t.ms[f.idx] || t.ms[0];
    const one = findRe(f, '');
    const to = f.regex && one ? t.ta.value.slice(a, b).replace(one, f.rep.value) : f.rep.value;
    const top = t.ta.scrollTop;
    withPane(p, () => put(t.ta, a, b, to));
    t.ta.scrollTop = top;
    f.anchor = a + to.length;
    f.pending = true;          // エディタの装飾が描き直されたら、次の一致へ
    f.rep.focus();
  }
  function replaceAll(p) {
    const f = p?.find;
    const t = f?.targets?.[0];
    if (!f || t?.kind !== 'edit') return showReplace(p, true);
    const re = findRe(f);
    if (!re) return;
    const v = t.ta.value;
    let n = 0;
    const out = v.replace(re, (...m) => { n++; return f.regex ? m[0].replace(findRe(f, ''), f.rep.value) : f.rep.value; });
    if (!n) return toast('置き換えるものがありません', 'warn');
    const top = t.ta.scrollTop, pos = t.ta.selectionStart;
    withPane(p, () => put(t.ta, 0, v.length, out, Math.min(pos, out.length)));   // まとめて1回の ⌘Z で戻せる
    t.ta.scrollTop = top;
    f.rep.focus();
    toast(`${n} か所を置き換えました（⌘Z で戻せます）`);
  }
  function openFind(p = active, q = selectedText(), goto = null, opt = {}) {
    if (!p) return;
    let f = p.find;
    if (!f) {
      f = p.find = { q: '', idx: 0, matchCase: false, regex: false, all: [], cur: null, frame: 0, anchor: 0 };
      const bar = f.bar = el('div', 'nt-find');
      const row = el('div', 'nt-findRow');
      f.repToggle = btn('iconBtn nt-findTog', 'chevron-right', () => showReplace(p, !f.repOpen), '置換を出す（⌥⌘F）');
      const ic = el('span', 'nt-findIc');
      ic.innerHTML = icon('search');
      const inp = f.input = el('input', 'nt-findInp');
      inp.type = 'text';
      inp.placeholder = 'このノートの中を検索';
      inp.spellcheck = false;
      f.count = el('span', 'nt-findCount');
      const toggle = (key, b) => () => { f[key] = !f[key]; b().classList.toggle('on', f[key]); refreshFind(p, true); inp.focus(); };
      f.caseBtn = btn('iconBtn nt-findCase', 'case-sensitive', toggle('matchCase', () => f.caseBtn), '大文字と小文字を区別する');
      f.reBtn = btn('iconBtn nt-findCase', 'regex', toggle('regex', () => f.reBtn), '正規表現で探す（置換で $1 などが使える）');
      row.append(f.repToggle, ic, inp, f.count, f.caseBtn, f.reBtn,
        btn('iconBtn', 'chevron-up', () => { stepFind(p, -1); inp.focus(); }, '前へ（⇧Enter）'),
        btn('iconBtn', 'chevron-down', () => { stepFind(p, 1); inp.focus(); }, '次へ（Enter）'),
        btn('iconBtn', 'x', () => closeFind(p, true), '閉じる（Esc）'));
      // 置換の行（⌥⌘F・左の › で出す）
      const rep = f.repRow = el('div', 'nt-findRow nt-findRep');
      rep.hidden = true;
      const ric = el('span', 'nt-findIc');
      ric.innerHTML = icon('replace');
      f.rep = el('input', 'nt-findInp');
      f.rep.type = 'text';
      f.rep.placeholder = '置き換える文字';
      f.rep.spellcheck = false;
      rep.append(el('span', 'nt-findGap'), ric, f.rep,
        btn('btn white sm nt-repBtn', ['replace', '置換'], () => replaceOne(p), '今の1か所を置き換えて次へ（Enter）'),
        btn('btn white sm nt-repBtn', ['replace-all', 'すべて'], () => replaceAll(p), 'すべて置き換える（⌘Enter）'));
      bar.append(row, rep);
      inp.addEventListener('input', () => { f.q = findQuery = inp.value; refreshFind(p, true); });
      const keys = e => {
        if (e.isComposing) return;
        if (e.key === 'Enter' && e.target === f.rep) { e.preventDefault(); if (e.metaKey || e.ctrlKey) replaceAll(p); else replaceOne(p); }
        else if (e.key === 'Enter') { e.preventDefault(); stepFind(p, e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(p, true); }
      };
      inp.addEventListener('keydown', keys);
      f.rep.addEventListener('keydown', keys);
      // 列の中身（エディタの装飾・プレビュー）が描き直されたら、見つけ直す（移動はしない）
      f.obs = new MutationObserver(() => { if (!f.frame) f.frame = requestAnimationFrame(() => { f.frame = 0; if (p.find === f) refreshFind(p, false); }); });
      f.obs.observe(p.body, { childList: true, subtree: true, characterData: true });
      p.el.insertBefore(bar, p.body);
    }
    // 探し始める位置：カーソルの位置か、いま見ているところ
    const T = findTargets(p);
    f.anchor = T[0]?.kind === 'edit' ? T[0].ta.selectionStart : T[0]?.scroller?.scrollTop || 0;
    if (goto) { f.goto = goto; if (goto.matchCase != null) { f.matchCase = goto.matchCase; f.caseBtn.classList.toggle('on', f.matchCase); } }
    if (q) f.input.value = q;
    else if (!f.input.value && findQuery) f.input.value = findQuery;
    f.q = findQuery = f.input.value;
    f.input.focus();
    f.input.select();
    refreshFind(p, true);
    if (opt.replace) showReplace(p, true);
  }
  // 閉じる。エディタで探していたら、今の一致を選んだ状態でエディタに戻る
  function closeFind(p, focusBack) {
    const f = p?.find;
    if (!f) return;
    f.obs.disconnect();
    cancelAnimationFrame(f.frame);
    f.bar.remove();
    p.find = null;
    paintFind();
    if (!focusBack) return;
    const t = f.targets?.[0];
    if (t?.kind === 'edit' && f.q && t.ms?.length && t.ta.isConnected) {
      const [a, b] = t.ms[f.idx] || t.ms[0];
      const top = t.ta.scrollTop;
      t.ta.focus({ preventScroll: true });
      t.ta.setSelectionRange(a, b);
      t.ta.scrollTop = top;
    }
  }

  // ================= VS Code と同じキー操作（書く画面） =================
  // 行の移動・複製・削除、行の挿入、行を選ぶ、コメント、字下げ、次の同じ言葉を選ぶ、行へ移動、置換、
  // 選んでいないときの ⌘X／⌘C は行ごと、選んだ文字を ( [ { " ` * _ で囲む
  const VS_KEYS = [
    ['⌥↑ / ⌥↓', '行を上・下へ移動'],
    ['⇧⌥↑ / ⇧⌥↓', '行を上・下に複製'],
    ['⇧⌘K', '行を削除'],
    ['⌘Enter / ⇧⌘Enter', '下・上に行を入れる'],
    ['⌘L', '行を選ぶ（続けて押すと次の行まで）'],
    ['⌘D', '言葉を選ぶ → 次の同じ言葉へ'],
    ['⇧⌘L', '選んだ言葉をすべて置換'],
    ['⌘/', 'コメントにする・戻す（%%…%%、読む画面には出ない）'],
    ['⌘] / ⌘[', '字下げ・字下げを戻す'],
    ['⌘X / ⌘C', '選んでいなければ行ごと（貼り付けると上の行に入る）'],
    ['⌃G', '行へ移動'],
    ['⌘F / ⌥⌘F', 'ノートの中を検索 / 置換'],
    ['⌘G / ⇧⌘G', '次・前の一致'],
    ['⇧⌘F', 'すべてのノートの本文から検索'],
    ['⌘P', 'ノートを名前で開く'],
    ['⇧⌘P', 'コマンド（操作）を探す'],
    ['⌘\\', '右に分割'],
    ['( [ { " ` * _', '選んだ文字を、打った記号で囲む'],
  ];
  // 選んでいる行の範囲（最後の改行のすぐ後ろで終わる選択は、その行を含めない）
  function lineSpan(ta) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = e > s && v[e - 1] === '\n' ? e - 1 : v.indexOf('\n', e);
    if (le < 0) le = v.length;
    return { v, s, e, ls, le };
  }
  function moveLines(ta, dir) {
    const { v, s, e, ls, le } = lineSpan(ta);
    const block = v.slice(ls, le);
    if (dir < 0) {
      if (ls === 0) return;
      const ps = v.lastIndexOf('\n', ls - 2) + 1;
      const d = ls - ps;
      put(ta, ps, le, block + '\n' + v.slice(ps, ls - 1), s - d, e - d);
    } else {
      if (le >= v.length) return;
      let ne = v.indexOf('\n', le + 1);
      if (ne < 0) ne = v.length;
      const next = v.slice(le + 1, ne);
      put(ta, ls, ne, next + '\n' + block, s + next.length + 1, e + next.length + 1);
    }
  }
  function copyLines(ta, dir) {
    const { s, e, ls, le, v } = lineSpan(ta);
    const block = v.slice(ls, le);
    if (dir < 0) put(ta, ls, ls, block + '\n', s, e);
    else put(ta, le, le, '\n' + block, s + block.length + 1, e + block.length + 1);
  }
  function deleteLines(ta) {
    const { v, s, ls, le } = lineSpan(ta);
    const col = s - ls;
    if (le < v.length) {
      const nextEnd = (v.indexOf('\n', le + 1) + 1 || v.length + 1) - 1;
      const pos = ls + Math.min(col, nextEnd - le - 1);
      put(ta, ls, le + 1, '', pos);
    } else {
      const a = Math.max(0, ls - 1);
      const ps = v.lastIndexOf('\n', a - 1) + 1;
      put(ta, a, le, '', Math.min(ps + col, a));
    }
  }
  function insertLine(ta, above) {
    const { v, ls, le } = lineSpan(ta);
    const ind = /^[ \t]*/.exec(v.slice(ls, le))[0];
    if (above) put(ta, ls, ls, ind + '\n', ls + ind.length);
    else put(ta, le, le, '\n' + ind);
  }
  function selectLine(ta) {
    const { v, s, e, ls, le } = lineSpan(ta);
    const whole = s === ls && (e === le + 1 || (e === le && le === v.length)) && e > s;
    if (!whole) return ta.setSelectionRange(ls, Math.min(le + 1, v.length));
    let ne = v.indexOf('\n', e);
    ne = ne < 0 ? v.length : ne + 1;
    ta.setSelectionRange(s, ne);
    revealSel(ta);
  }
  // %%コメント%%（Obsidian と同じ。読む画面には出ない）にする・戻す
  function toggleComment(ta) {
    const { v, s, e, ls, le } = lineSpan(ta);
    const block = v.slice(ls, le);
    const m = /^(\s*)%%\s?([\s\S]*?)\s?%%\s*$/.exec(block);
    const out = m ? m[1] + m[2] : block.includes('\n') ? '%%\n' + block + '\n%%' : block.replace(/^(\s*)(.*)$/, '$1%% $2 %%');
    if (s !== e) return put(ta, ls, le, out, ls, ls + out.length);
    const pos = Math.min(Math.max(ls, s + (m ? -3 : 3)), ls + out.length);
    put(ta, ls, le, out, pos);
  }
  // ⌘D：言葉を選ぶ。選んでいたら、次の同じ言葉へ（VS Code のようにカーソルは増やさず、選ぶ場所を移す）
  const wordSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
  function selectNext(ta) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) {
      const ls = v.lastIndexOf('\n', s - 1) + 1, le = (v.indexOf('\n', s) + 1 || v.length + 1) - 1;
      const line = v.slice(ls, le);
      for (const g of wordSeg ? wordSeg.segment(line) : []) {
        const a = ls + g.index, b = a + g.segment.length;
        if (a <= s && s <= b && g.isWordLike) { ta.setSelectionRange(a, b); return; }
      }
      return;
    }
    const t = v.slice(s, e);
    let i = v.indexOf(t, e);
    if (i < 0) i = v.indexOf(t);
    if (i < 0 || i === s) { toast('ほかにはありません'); return; }
    ta.setSelectionRange(i, i + t.length);
    revealSel(ta);
  }
  // 選んでいる所が見えるまでスクロール（エディタの後ろの装飾から位置を測る）
  function revealSel(ta) {
    const pre = ta.parentElement?.querySelector('.nt-hl');
    if (!pre) return;
    const ix = textIndex(pre);
    if (!ix.nodes.length) return;
    const a = Math.min(ta.selectionStart, ix.text.length - 1);
    revealFind({ kind: 'edit', root: pre, scroller: ta }, rangeAt(ix, a, Math.max(a + 1, Math.min(ta.selectionEnd, ix.text.length))));
  }
  async function gotoLinePrompt(ta) {
    const total = ta.value.split('\n').length;
    const cur0 = ta.value.slice(0, ta.selectionStart).split('\n').length;
    const r = await askText('行へ移動', String(cur0), `1〜${total} の行番号`, { max: 6 });
    const n = parseInt(String(r || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)), 10);
    if (!n) return;
    const line = Math.min(Math.max(1, n), total) - 1;
    const pos = ta.value.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    requestAnimationFrame(() => revealSel(ta));
  }
  // 選んだ文字を、打った記号で囲む（IME の入力中は何もしない）
  const SURROUND = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`', '*': '*', '_': '_', '「': '」', '（': '）' };
  function surroundKey(e, ta) {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return false;
    const close = SURROUND[e.key];
    const s = ta.selectionStart, en = ta.selectionEnd;
    if (!close || s === en) return false;
    const t = ta.value.slice(s, en);
    if (t.includes('\n') && close !== '`') return false;
    e.preventDefault();
    put(ta, s, en, e.key + t + close, s + 1, en + 1);
    return true;
  }
  function vsKey(e, ta) {
    if (e.isComposing) return false;
    if (!Keys.isMac && e.ctrlKey && e.altKey) return false;   // Windows の AltGr（Ctrl+Alt）で打つ記号はそのまま入力
    if (!Keys.isMac && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); openFind(active, ta.value.slice(ta.selectionStart, ta.selectionEnd) || undefined, null, { replace: true }); return true; }
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    const run = fn => { e.preventDefault(); fn(); return true; };
    if (e.altKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown')) return run(() => (e.shiftKey ? copyLines : moveLines)(ta, k === 'ArrowUp' ? -1 : 1));
    if (e.ctrlKey && !e.metaKey && k.toLowerCase() === 'g') return run(() => gotoLinePrompt(ta));
    if (!e.metaKey && !e.ctrlKey) return surroundKey(e, ta);
    if (e.shiftKey && k.toLowerCase() === 'k') return run(() => deleteLines(ta));
    if (k === 'Enter') return run(() => insertLine(ta, e.shiftKey));
    if (!e.shiftKey && k.toLowerCase() === 'l') return run(() => selectLine(ta));
    if (e.shiftKey && k.toLowerCase() === 'l') return run(() => openFind(active, ta.value.slice(ta.selectionStart, ta.selectionEnd) || selectedText(), null, { replace: true }));
    if (!e.shiftKey && k.toLowerCase() === 'd') return run(() => selectNext(ta));
    if (k === '/' || e.code === 'Slash') return run(() => toggleComment(ta));
    if (k === ']' || k === '[') return run(() => indentLines(ta, k === ']' ? 1 : -1, fenceAt(ta.value, ta.selectionStart) ? CODE_INDENT : '  '));
    if (e.altKey && (k.toLowerCase() === 'f' || e.code === 'KeyF')) return run(() => openFind(active, undefined, null, { replace: true }));
    return false;
  }
  // 選んでいないときの ⌘C／⌘X は行ごと。その行を貼り付けると、カーソルの行の上に入る（VS Code と同じ）
  let lineClip = null;
  function lineCopy(e, ta, cut) {
    if (ta.selectionStart !== ta.selectionEnd) { lineClip = null; return; }
    const { v, ls, le } = lineSpan(ta);
    const line = v.slice(ls, le) + '\n';
    e.preventDefault();
    e.clipboardData.setData('text/plain', line);
    lineClip = line;
    if (cut) {
      if (le < v.length) put(ta, ls, le + 1, '', ls);
      else put(ta, Math.max(0, ls - 1), le, '', Math.max(0, ls - 1));
    }
  }
  function linePaste(e, ta) {
    const t = e.clipboardData?.getData('text/plain');
    if (!lineClip || t !== lineClip || ta.selectionStart !== ta.selectionEnd) return false;
    e.preventDefault();
    const s = ta.selectionStart, ls = ta.value.lastIndexOf('\n', s - 1) + 1;
    put(ta, ls, ls, t, s + t.length);
    return true;
  }
  // キー操作の一覧（⌘K の「ノートのキー操作」から）
  function showKeys() {
    const d = el('dialog', 'bmPick ntKeys');
    const head = el('div', 'bmp-head');
    head.append(withIcon('h2', '', 'keyboard', 'ノートのキー操作（VS Code と同じ）'), btn('iconBtn', 'x', () => d.close(), '閉じる'));
    const list = el('div', 'nt-keyList');
    for (const [k, t] of VS_KEYS) { const r = el('div', 'nt-keyRow'); r.append(el('kbd', '', k), el('span', '', t)); list.append(r); }
    const foot = el('p', 'nt-note', 'ほかに ⌘B 太字・⌘I 斜体・⌘U 下線・⌘1〜3 見出し・⇧⌘H ハイライト・⌘T テンプレート・⌘E 読む⇔並べる・Tab 字下げ');
    d.append(head, list, foot);
    document.body.append(d);
    d.addEventListener('close', () => d.remove());
    d.showModal();
  }

  // ---------- エディタのキー操作 ----------
  function editorKey(e, ta) {
    if (sug && sugKey(e)) return;
    if (vsKey(e, ta)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 's') { e.preventDefault(); saveNow(); return; }
    if (formatKey(e, ta)) return;
    if (mod && e.key === 'e') { e.preventDefault(); setView(view() === 'preview' ? 'split' : 'preview'); return; }
    if (codeKey(e, ta)) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) { indentLines(ta, e.shiftKey ? -1 : 1, '  '); return; }
      const s = ta.selectionStart, v = ta.value;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (e.shiftKey) { if (v.slice(ls, ls + 2) === '  ') put(ta, ls, ls + 2, '', Math.max(ls, s - 2)); }
      else put(ta, ls, ls, '  ', s + 2);
      return;
    }
    // Enter：リストやチェックリストを続ける
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && ta.selectionStart === ta.selectionEnd) {
      const s = ta.selectionStart, v = ta.value;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(ls, s);
      const m = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === (m[2] + (m[3] || '')).trim()) { put(ta, ls, s, ''); return; }   // 空の項目ならリストを終える
      const num = /^\d+/.test(m[2]) ? `${Number(m[2].match(/\d+/)[0]) + 1}${m[2].slice(-1)}` : m[2];
      put(ta, s, s, `\n${m[1]}${num}${m[3] ? ' [ ]' : ''} `);
    }
  }
  // ---------- コードブロックの中では、コードエディタのように書ける ----------
  // ・Enter：前の行の字下げを保つ（{ ( [ : で終わる行の次は1段深く。{} の間なら閉じかっこを次の行へ）
  // ・Tab：カーソルの位置に空白4つ（複数行を選んでいたら全部の行を字下げ）、⇧Tab：字下げを戻す
  // ・Backspace：行頭の空白の中では4つずつ消す
  // ・``` のあと Enter：閉じる ``` を自動で入れる
  const CODE_INDENT = '    ';
  function fenceAt(v, pos) {
    // pos の行がコードブロックの中か（開く ``` の行も中として扱わない）
    const before = v.slice(0, v.lastIndexOf('\n', pos - 1) + 1);
    let open = null;
    for (const line of before.split('\n')) {
      const m = line.match(/^\s*(```+|~~~+)/);
      if (!m) continue;
      if (!open) open = m[1];
      else if (m[1][0] === open[0] && m[1].length >= open.length && !line.trim().slice(m[1].length).trim()) open = null;
    }
    return open;
  }
  function indentLines(ta, dir, unit) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = e > s && v[e - 1] === '\n' ? e - 1 : v.indexOf('\n', e);
    if (le < 0) le = v.length;
    const lines = v.slice(ls, le).split('\n');
    const out = lines.map(l => {
      if (dir > 0) return l ? unit + l : l;
      const m = l.match(new RegExp('^( {1,' + unit.length + '}|\\t)'));
      return m ? l.slice(m[0].length) : l;
    });
    const text = out.join('\n');
    const d0 = out[0].length - lines[0].length;
    put(ta, ls, le, text, Math.max(ls, s + d0), ls + text.length);
  }
  function codeKey(e, ta) {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return false;
    const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(ls, s);
    // ``` + Enter：閉じる ``` を入れて、間にカーソル
    if (e.key === 'Enter' && !e.shiftKey && s === en) {
      const m = line.match(/^(\s*)(```+|~~~+)([\w+#.-]*)\s*$/);
      const rest = v.slice(s, (v.indexOf('\n', s) + 1 || v.length + 1) - 1);
      if (m && !rest.trim() && !fenceAt(v, s)) {
        // 後ろに閉じる ``` がまだないときだけ（あるなら、それが閉じになる）
        const after = v.slice(s);
        const closes = after.split('\n').some(l => new RegExp('^\\s*' + m[2].replace(/[~`]/g, c => '\\' + c) + '\\s*$').test(l));
        if (!closes) {
          e.preventDefault();
          put(ta, s, s, `\n${m[1]}\n${m[1]}${m[2]}`, s + 1 + m[1].length);
          return true;
        }
      }
    }
    if (!fenceAt(v, s)) return false;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const ind = line.match(/^[ \t]*/)[0];
      const prev = line.trimEnd();
      const next = v.slice(en, en + 1);
      const deeper = /[{([:]$/.test(prev) ? CODE_INDENT : '';
      if (deeper && /^[})\]]/.test(next) && /[{([]$/.test(prev)) {
        put(ta, s, en, `\n${ind}${deeper}\n${ind}`, s + 1 + ind.length + deeper.length);
      } else put(ta, s, en, `\n${ind}${deeper}`);
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey || v.slice(s, en).includes('\n')) { indentLines(ta, e.shiftKey ? -1 : 1, CODE_INDENT); return true; }
      put(ta, s, en, CODE_INDENT);
      return true;
    }
    if (e.key === 'Backspace' && s === en && line && /^ +$/.test(line)) {
      e.preventDefault();
      const n = line.length % CODE_INDENT.length || CODE_INDENT.length;
      put(ta, s - n, s, '');
      return true;
    }
    return false;
  }
  // ---------- 画像を入れる ----------
  const IMG_RE = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/;
  function imageFiles(dt) {
    if (!dt) return [];
    const out = [...(dt.files || [])].filter(f => IMG_RE.test(f.type));
    if (!out.length) for (const it of dt.items || []) if (it.kind === 'file' && IMG_RE.test(it.type)) { const f = it.getAsFile(); if (f) out.push(f); }
    return out;
  }
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  // 画像を Vault に保存して、カーソルの位置に ![[名前]] を入れる
  async function addImages(ta, files) {
    if (!cur) return;
    const links = [];
    for (const f of files.slice(0, 20)) {
      const ext = (f.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
      // スクリーンショットの貼り付けは名前がないので、Obsidian と同じく「Pasted image 日時」
      const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name : `Pasted image ${stamp()}${links.length ? '-' + links.length : ''}.${ext}`;
      const r = await ctx.api.notes.saveImage(cur.path, name, await f.arrayBuffer());
      if (r?.error) { toast(r.error, 'warn'); continue; }
      links.push(r.link);
    }
    insertImageLinks(ta, links);
  }
  async function pickImages(ta) {
    if (!cur) return;
    const pos = [ta.selectionStart, ta.selectionEnd];
    const r = await ctx.api.notes.pickImage(cur.path);
    if (r?.error) return toast(r.error, 'warn');
    if (!r?.items?.length) return;
    ta.focus();
    ta.setSelectionRange(pos[0], pos[1]);
    insertImageLinks(ta, r.items.map(x => x.link));
  }
  async function insertImageLinks(ta, links) {
    if (!links.length) return;
    await load();
    const s = ta.selectionStart, v = ta.value;
    const before = s > 0 && v[s - 1] !== '\n' && links.length > 1 ? '\n' : '';
    put(ta, s, ta.selectionEnd, before + links.map(l => `![[${l}]]`).join('\n'));
    renderPreview();
    toast(links.length === 1 ? '画像を入れました' : `画像を${links.length}枚入れました`);
  }

  // ---------- 書式のツールバー（Obsidian の Editing Toolbar のような） ----------
  // 文字を置き換える。⌘Z で元に戻せるように、入力として扱う（execCommand）
  function put(ta, start, end, text, selStart = start + text.length, selEnd = selStart) {
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, start, end, 'end');
    ta.setSelectionRange(selStart, selEnd);
    changed(ta.value);
  }
  // **太字** などで囲む。もう囲まれていたら外す
  function wrapSel(ta, open, close = open, placeholder = '') {
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    const t = v.slice(s, e);
    if (v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
      return put(ta, s - open.length, e + close.length, t, s - open.length, e - open.length);
    }
    if (t.startsWith(open) && t.endsWith(close) && t.length >= open.length + close.length) {
      const inner = t.slice(open.length, t.length - close.length);
      return put(ta, s, e, inner, s, s + inner.length);
    }
    const body = t || placeholder;
    put(ta, s, e, open + body + close, s + open.length, s + open.length + body.length);
  }
  // 選んでいる行の先頭を変える（見出し・リスト・引用）。全部の行についていたら外す
  function linePrefix(ta, make, test) {
    const v = ta.value;
    const ls = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let le = v.indexOf('\n', ta.selectionEnd);
    if (le < 0) le = v.length;
    const lines = v.slice(ls, le).split('\n');
    const all = lines.every(l => !l.trim() || test.test(l));
    const out = lines.map((l, i) => {
      const bare = l.replace(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '$1');
      if (all) return l.replace(test, '$1');
      if (!l.trim() && lines.length > 1) return l;
      return make(bare, i);
    }).join('\n');
    put(ta, ls, le, out, ls, ls + out.length);
    if (lines.length === 1) ta.setSelectionRange(ls + out.length, ls + out.length);
  }
  function insertBlock(ta, text, cursorOffset = text.length) {
    const s = ta.selectionStart, v = ta.value;
    const before = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
    const after = v[ta.selectionEnd] && v[ta.selectionEnd] !== '\n' ? '\n' : '';
    put(ta, s, ta.selectionEnd, before + text + after, s + before.length + cursorOffset);
  }
  const CALLOUTS = [['note', 'メモ'], ['info', '情報'], ['target', 'ゴール'], ['tip', 'ヒント'], ['warning', '注意'], ['code', 'コード'], ['customize', 'カスタマイズ'], ['question', '質問'], ['example', '例']];
  function callout(ta, type) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const t = ta.value.slice(s, e);
    const label = CALLOUTS.find(c => c[0] === type)?.[1] || type;
    const body = t ? t.split('\n').map(l => '> ' + l).join('\n') : '> ';
    insertBlock(ta, `> [!${type}] ${label}\n${body}`);
  }
  function editBar(ta) {
    const bar = el('div', 'nt-bar');
    const b = (ic, title, fn, key) => {
      const x = btn('nt-tb', ic, () => fn(), title + (key ? `（${key}）` : ''));
      x.addEventListener('mousedown', e => e.preventDefault());   // エディタの選択を残したまま押せるように
      bar.append(x);
      return x;
    };
    const sep = () => bar.append(el('span', 'nt-tbSep'));
    b('undo-2', '元に戻す', () => { ta.focus(); document.execCommand('undo'); changed(ta.value); }, '⌘Z');
    b('redo-2', 'やり直す', () => { ta.focus(); document.execCommand('redo'); changed(ta.value); }, '⇧⌘Z');
    sep();
    b('heading-1', '見出し1', () => linePrefix(ta, l => '# ' + l, /^(\s*)#\s+/), '⌘1');
    b('heading-2', '見出し2', () => linePrefix(ta, l => '## ' + l, /^(\s*)##\s+/), '⌘2');
    b('heading-3', '見出し3', () => linePrefix(ta, l => '### ' + l, /^(\s*)###\s+/), '⌘3');
    sep();
    b('bold', '太字', () => wrapSel(ta, '**', '**', '太字'), '⌘B');
    b('italic', '斜体', () => wrapSel(ta, '*', '*', '斜体'), '⌘I');
    b('strikethrough', '取り消し線', () => wrapSel(ta, '~~', '~~', '取り消し'), '⇧⌘X');
    b('highlighter', 'ハイライト', () => wrapSel(ta, '==', '==', 'ハイライト'), '⇧⌘H');
    b('underline', '下線', () => wrapSel(ta, '<u>', '</u>', '下線'), '⌘U');
    b('code', 'インラインコード', () => wrapSel(ta, '`', '`', 'code'), '⌘`');
    sep();
    b('link', 'ノートへのリンク [[ ]]', () => { wrapSel(ta, '[[', ']]'); suggest(ta); });
    b('link-2', 'URLのリンク', () => {
      const s = ta.selectionStart, e = ta.selectionEnd, t = ta.value.slice(s, e) || 'リンク';
      put(ta, s, e, `[${t}](https://)`, s + t.length + 3, s + t.length + 11);
    });
    sep();
    b('list', '箇条書き', () => linePrefix(ta, l => '- ' + l, /^(\s*)[-*+]\s+(?!\[[ xX]\])/), '⇧⌘8');
    b('list-ordered', '番号付きリスト', () => linePrefix(ta, (l, i) => `${i + 1}. ` + l, /^(\s*)\d+[.)]\s+/), '⇧⌘7');
    b('list-todo', 'チェックリスト', () => linePrefix(ta, l => '- [ ] ' + l, /^(\s*)[-*+]\s+\[[ xX]\]\s+/), '⇧⌘9');
    b('quote', '引用', () => linePrefix(ta, l => '> ' + l, /^(\s*)>\s?/), '⇧⌘.');
    // コールアウト（種類を選ぶ）
    const cb = b('message-square-text', 'コールアウト', () => {
      const m = el('div', 'nt-menu');
      for (const [type, label] of CALLOUTS) {
        const it = el('button', 'nt-menuItem');
        it.type = 'button';
        it.append(el('span', 'nt-cdot ' + type), `${label}`, el('small', '', type));
        it.addEventListener('mousedown', e => { e.preventDefault(); m.remove(); callout(ta, type); });
        m.append(it);
      }
      const r = cb.getBoundingClientRect();
      m.style.left = Math.min(r.left, innerWidth - 220) + 'px';
      m.style.top = r.bottom + 6 + 'px';
      document.body.append(m);
      setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
    });
    b('square-code', 'コードブロック', () => {
      const s = ta.selectionStart, e = ta.selectionEnd, t = ta.value.slice(s, e);
      insertBlock(ta, '```\n' + t + '\n```', 4 + t.length);
    });
    b('table', '表', () => insertBlock(ta, '| 見出し | 見出し |\n| --- | --- |\n| ここに | 入力 |', 2));
    b('minus', '区切り線', () => insertBlock(ta, '---\n'));
    b('image', '画像を入れる（ファイルを選ぶ。貼り付け・ドラッグでも入れられます）', () => pickImages(ta));
    sep();
    b('text-quote', 'テンプレートを入れる（テンプレートのタブのもの・Obsidian のテンプレート）', () => insertTemplate(ta), '⌘T');
    b('list-plus', 'プロパティのひな形を入れる', () => templateMenu({ target: bar.querySelector('.nt-tb:last-child') }));
    return bar;
  }
  // 書式のショートカット
  function formatKey(e, ta) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return false;
    const k = e.key.toLowerCase();
    const map = {
      b: () => wrapSel(ta, '**', '**', '太字'), i: () => wrapSel(ta, '*', '*', '斜体'), u: () => wrapSel(ta, '<u>', '</u>', '下線'),
      '`': () => wrapSel(ta, '`', '`', 'code'), 1: () => linePrefix(ta, l => '# ' + l, /^(\s*)#\s+/),
      2: () => linePrefix(ta, l => '## ' + l, /^(\s*)##\s+/), 3: () => linePrefix(ta, l => '### ' + l, /^(\s*)###\s+/),
    };
    const shift = {
      x: () => wrapSel(ta, '~~', '~~', '取り消し'), h: () => wrapSel(ta, '==', '==', 'ハイライト'),
      8: () => linePrefix(ta, l => '- ' + l, /^(\s*)[-*+]\s+(?!\[[ xX]\])/), '*': () => linePrefix(ta, l => '- ' + l, /^(\s*)[-*+]\s+(?!\[[ xX]\])/),
      7: () => linePrefix(ta, (l, i) => `${i + 1}. ` + l, /^(\s*)\d+[.)]\s+/), "'": () => linePrefix(ta, (l, i) => `${i + 1}. ` + l, /^(\s*)\d+[.)]\s+/),
      9: () => linePrefix(ta, l => '- [ ] ' + l, /^(\s*)[-*+]\s+\[[ xX]\]\s+/), ')': () => linePrefix(ta, l => '- [ ] ' + l, /^(\s*)[-*+]\s+\[[ xX]\]\s+/),
      '.': () => linePrefix(ta, l => '> ' + l, /^(\s*)>\s?/), '>': () => linePrefix(ta, l => '> ' + l, /^(\s*)>\s?/),
    };
    if (k === 't' && !e.shiftKey) { e.preventDefault(); insertTemplate(ta); return true; }
    const fn = e.shiftKey ? shift[k] : map[k];
    if (!fn) return false;
    e.preventDefault();
    fn();
    return true;
  }

  // ---------- [[ の入力候補 ----------
  let sug = null;   // { el, items, sel, start }
  function suggest(ta) {
    const s = ta.selectionStart;
    const before = ta.value.slice(Math.max(0, s - 120), s);
    const m = /\[\[([^\]\n|#]*)$/.exec(before);
    if (!m) return hideSuggest();
    const q = m[1].toLowerCase();
    const items = data.notes.filter(n => !q || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
      .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) || b.mtime - a.mtime).slice(0, 8);
    const createNew = q && !data.notes.some(n => n.name.toLowerCase() === q) ? m[1] : null;
    if (!items.length && !createNew) return hideSuggest();
    if (!sug) { sug = { el: el('div', 'nt-sug') }; document.body.append(sug.el); }
    sug.items = items.map(n => ({ label: n.name, sub: n.folder, value: n.name }));
    if (createNew) sug.items.push({ label: createNew, sub: '新しいノートとしてリンク', value: createNew, isNew: true });
    sug.sel = Math.min(sug.sel || 0, sug.items.length - 1);
    sug.start = s - m[1].length;
    sug.ta = ta;
    drawSuggest();
    const c = caretXY(ta);
    sug.el.style.left = Math.min(c.x, innerWidth - 300) + 'px';
    sug.el.style.top = Math.min(c.y + 24, innerHeight - 240) + 'px';
  }
  function drawSuggest() {
    sug.el.innerHTML = '';
    sug.items.forEach((it, i) => {
      const r = el('div', 'nt-sugRow' + (i === sug.sel ? ' on' : '') + (it.isNew ? ' new' : ''));
      r.innerHTML = icon(it.isNew ? 'file-plus' : 'file-text');
      r.append(el('b', '', it.label));
      if (it.sub) r.append(el('small', '', it.sub));
      r.addEventListener('mousedown', e => { e.preventDefault(); sug.sel = i; pickSuggest(); });
      sug.el.append(r);
    });
  }
  function sugKey(e) {
    if (e.isComposing) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); sug.sel = (sug.sel + 1) % sug.items.length; drawSuggest(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sug.sel = (sug.sel - 1 + sug.items.length) % sug.items.length; drawSuggest(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSuggest(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); hideSuggest(); return true; }
    return false;
  }
  function pickSuggest() {
    const it = sug.items[sug.sel];
    const ta = sug.ta;
    const after = ta.value.slice(ta.selectionStart);
    const close = after.startsWith(']]') ? '' : ']]';
    ta.setRangeText(it.value + close, sug.start, ta.selectionStart, 'end');
    if (!close) ta.selectionStart = ta.selectionEnd = ta.selectionStart + 2;
    hideSuggest();
    changed(ta.value);
  }
  function hideSuggest() { sug?.el.remove(); sug = null; }
  // テキストエリアのカーソルの画面上の位置（同じ見た目の見えない箱で測る）
  function caretXY(ta) {
    const cs = getComputedStyle(ta);
    const m = el('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize']) m.style[p] = cs[p];
    Object.assign(m.style, { position: 'fixed', visibility: 'hidden', top: 0, left: 0, width: ta.clientWidth + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
    m.textContent = ta.value.slice(0, ta.selectionStart);
    const sp = el('span', '', '|');
    m.append(sp);
    document.body.append(m);
    const r = ta.getBoundingClientRect();
    const x = r.left + sp.offsetLeft - ta.scrollLeft, y = r.top + sp.offsetTop - ta.scrollTop;
    m.remove();
    return { x, y };
  }

  // ---------- 表示の切り替え ----------
  // 表示は列ごと（次に開く列と、並べていないときの表示として設定にも残す）
  function setView(v) {
    paneMode = v;
    stash();
    ctx.api.settings.set({ notesView: v });
  }
  function filterTag(t) {
    tagFilter = tagFilter === t ? null : t;
    if (tagFilter) { cur = null; }
    ctx.go('notes');
    ctx.refresh();
  }

  // ---------- サイドバー ----------
  function renderSide(container) {
    const hadFocus = !!document.activeElement?.closest?.('#sideNotes .nt-tree');
    const srchFocus = srch && document.activeElement === srch.input ? [srch.input.selectionStart, srch.input.selectionEnd] : null;
    // 描き直してもスクロールの位置はそのまま（フォルダを開くたびに一覧が上に戻って、押したフォルダが下の端へ飛ばないように）
    const SCROLLERS = ['.nt-treeScroll', '.nt-tagList', '.nt-outline', '.nt-searchList'];
    const kept = SCROLLERS.map(q => container.querySelector(q)?.scrollTop ?? null);
    const restoreScroll = () => SCROLLERS.forEach((q, i) => { const e = kept[i] != null && container.querySelector(q); if (e && e.scrollTop !== kept[i]) e.scrollTop = kept[i]; });
    side = container;
    side.innerHTML = '';
    if (!loaded) { side.append(withIcon('p', 'nt-sideNote', 'loader', 'ノートを読み込んでいます…')); return; }
    if (!info.ready) {
      side.append(withIcon('p', 'nt-sideNote', 'info', 'フォルダを選ぶと、ここにノートの一覧が出ます'));
      return;
    }
    const top = el('div', 'nt-sideTop');
    const nb = btn('btn primary', 'file-plus', () => newNote(), '新しいノート');
    nb.append(el('span', 'lbl-long', '新しいノート'), el('span', 'lbl-short', '新規'));
    top.append(nb, btn('btn white', 'folder-plus', () => newFolder(), 'フォルダを作る（選んでいるフォルダの中に）'), btn('btn white', 'calendar-days', daily, '今日のノート'));
    side.append(top);
    if (tagFilter) {
      const f = el('div', 'nt-filter');
      f.append(withIcon('span', '', 'hash', tagFilter), btn('iconBtn', 'x', () => { tagFilter = null; ctx.refresh(); }, '絞り込みをやめる'));
      side.append(f);
    }
    // フォルダとノート（VS Code のような操作：選ぶ・まとめてドラッグ・⌘X/⌘V・⌘Z・右クリック）
    const tree = el('nav', 'navCard nt-tree');
    const scroller = el('div', 'nt-treeScroll');
    const notes = filtered();
    const byFolder = new Map();
    for (const n of notes) { if (!byFolder.has(n.folder)) byFolder.set(n.folder, []); byFolder.get(n.folder).push(n); }
    // フォルダの並びは1回だけ作る（フォルダを描くたびに全部を並べ直さない）
    const kids = new Map();
    for (const f of [...data.folders].sort(jaSort)) {
      if (tagFilter && !notes.some(n => n.folder === f || n.folder.startsWith(f + '/'))) continue;
      const p = folderOf(f);
      if (kids.has(p)) kids.get(p).push(f); else kids.set(p, [f]);
    }
    const childFolders = parent => kids.get(parent) || [];
    const act = (ic, title, fn) => { const x = btn('nt-rowBtn', ic, fn, title); x.addEventListener('mousedown', e => e.stopPropagation()); x.draggable = false; return x; };
    visible = []; rows = new Map(); zones = new Map([['', [scroller]]]);
    const row = (b, k) => {
      b.dataset.key = k;
      b.tabIndex = -1;
      b.addEventListener('click', e => onRowClick(e, k));
      b.addEventListener('contextmenu', e => { e.preventDefault(); rowMenu(k, e); });
      dragSource(b, k);
      visible.push(k);
      rows.set(k, b);
    };
    // 子どもは字下げした箱に入れ、左に細い線を引く（どこに入っているか分かるように）
    const drawFolder = (folder, into) => {
      for (const sub of childFolders(folder)) {
        const isOpen = openFolders.has(sub) || !!tagFilter;
        const b = el('div', 'nav nt-folder' + (isOpen ? ' open' : ''));
        b.innerHTML = icon('chevron-right');
        b.insertAdjacentHTML('beforeend', icon(isOpen ? 'folder-open' : 'folder-closed'));
        b.append(el('span', 'name', sub.split('/').pop()));
        const cnt = data.notes.filter(n => n.folder === sub || n.folder.startsWith(sub + '/')).length;
        b.append(el('small', '', cnt || ''));
        const acts = el('span', 'nt-rowActs');
        acts.append(act('file-plus', 'このフォルダにノートを作る', () => { openFolders.add(sub); newNote(sub); }),
          act('folder-plus', 'この中にフォルダを作る', () => newFolder(sub)),
          act('ellipsis', 'そのほか', e => rowMenu('f:' + sub, e)));
        b.append(acts);
        row(b, 'f:' + sub);
        into.append(b);
        zones.set(sub, [b]);
        if (isOpen) {
          const kids = el('div', 'nt-kids');
          drawFolder(sub, kids);
          if (kids.children.length) { into.append(kids); zones.get(sub).push(kids); }
        }
      }
      for (const n of (byFolder.get(folder) || []).sort((a, b) => jaSort(a.name, b.name))) {
        const b = el('div', 'nav nt-file' + (cur && cur.path === n.path ? ' on' : panes.some(p => curOf(p)?.path === n.path) ? ' open' : ''));
        b.innerHTML = icon('file-text');
        b.append(el('span', 'name', n.name));
        b.title = n.path;
        row(b, 'n:' + n.path);
        into.append(b);
      }
    };
    drawFolder('', scroller);
    if (!scroller.children.length) scroller.append(el('p', 'nt-sideNote', 'ノートはまだありません'));
    // 選択から消えたもの（削除・移動）を外す
    for (const k of [...sel]) if (!rows.has(k)) sel.delete(k);
    if (focusKey && !rows.has(focusKey)) focusKey = null;
    tree.append(scroller);
    dropArea(scroller);
    tree.addEventListener('focusin', e => { const r = e.target.closest('.nav[data-key]'); if (r && focusKey !== r.dataset.key) { focusKey = r.dataset.key; paintSel(); } });
    const head = el('div', 'nt-sideHead');
    head.append(el('p', 'sideTitle', 'ノート'));
    const hb = el('span', 'nt-headBtns');
    hb.append(act('file-plus', 'いちばん上にノートを作る', () => newNote('')), act('folder-plus', 'フォルダを作る', () => newFolder('')),
      act('chevrons-down-up', 'フォルダをすべて閉じる', () => { openFolders.clear(); renderSide(side); }));
    head.append(hb);
    dropArea(head, '');
    zones.get('').push(head);
    // 切り替え：ファイル／タグ／目次（選んだほうだけを、サイドバーの高さいっぱいに出す）
    const counts = new Map();
    data.notes.forEach(n => n.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    const tab = sideTab();
    const seg = el('div', 'seg nt-sideSeg');
    for (const [id, ic, label, n] of [['files', 'files', 'ファイル', data.notes.length], ['search', 'search', '検索', null], ['tags', 'hash', 'タグ', counts.size], ['outline', 'list', '目次', null]]) {
      const b = el('button', tab === id ? 'on' : '');
      b.type = 'button';
      b.dataset.tab = id;
      b.title = id === 'outline' ? '目次（見出し・バックリンク）' : id === 'search' ? 'すべてのノートの本文から検索（⇧⌘F）' : label;
      b.innerHTML = icon(ic);
      b.append(el('span', 'lbl', label));
      if (n != null) b.append(el('small', '', String(n)));
      b.addEventListener('click', () => { if (tab !== id) setSideTab(id); });
      seg.append(b);
    }
    side.append(seg);
    const pane = el('div', 'nt-sidePane');
    if (tab === 'files') {
      pane.append(head, tree);
      side.append(pane);
      restoreScroll();
      paintSel();
      if (hadFocus && (!document.activeElement || document.activeElement === document.body)) focusRow();
    } else if (tab === 'search') {
      pane.append(searchPane());
      side.append(pane);
      if (srchFocus) { srch.input.focus(); srch.input.setSelectionRange(...srchFocus); }
    } else if (tab === 'outline') {
      const ol = el('div', 'nt-outline');
      pane.append(ol);
      side.append(pane);
      if (cur) fillInfo(ol);
      else ol.append(el('p', 'nt-sideNote', 'ノートを開くと、見出しとバックリンクがここに出ます'));
    } else {
      const list = el('nav', 'navCard nt-tagList');
      const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
      for (const [t, c] of sorted) {
        const b = el('button', 'nav nt-tagRow' + (tagFilter === t ? ' on' : ''));
        b.type = 'button';
        b.innerHTML = icon('hash');
        b.append(el('span', 'name', t), el('small', '', String(c)));
        b.title = tagFilter === t ? '絞り込みをやめる' : `#${t} のノートだけを出す`;
        b.addEventListener('click', () => filterTag(t));
        list.append(b);
      }
      if (!sorted.length) list.append(el('p', 'nt-sideNote', 'タグはまだありません。本文に #タグ と書くか、プロパティの tags に入れると出てきます'));
      pane.append(list);
      side.append(pane);
    }
    // フォルダ名と操作ボタンを1行にまとめる（縦幅を取らないように）
    const foot = el('div', 'nt-sideFoot');
    foot.append(el('small', 'nt-root', info.isVault ? `Obsidian の Vault：${info.root.split('/').pop()}` : info.root.split('/').pop()));
    if (ctx.api.notes.reveal) foot.append(btn('iconBtn', 'folder-open', () => ctx.api.notes.reveal(''), 'Finder で表示'));   // MDWS
    foot.append(
      btn('iconBtn', 'settings', async () => { const r = await ctx.api.notes.choose(); if (r) { cur = null; await load(); ctx.refresh(); } }, 'ノートのフォルダを変更'));
    side.append(foot);
    restoreScroll();
    sideSig = sideSigNow();
  }
  // サイドバーの中身（ノートの一覧・開いているフォルダ・タブ・絞り込み）が前に作ったときと同じか
  let sideSig = '';
  const sideSigNow = () => [dataVer, sideTab(), tagFilter || '', [...openFolders].sort().join('\n'), info.ready].join('\t');
  // ノートを開いた・列を切りかえただけのとき：同じ中身なら作り直さず、開いているノートの印と選択だけ合わせる
  function syncSide() {
    if (!side) return;
    if (!side.isConnected || sideTab() !== 'files' || !rows?.size || sideSig !== sideSigNow()) return renderSide(side);
    for (const [k, b] of rows) {
      if (!k.startsWith('n:')) continue;
      const p = k.slice(2);
      b.classList.toggle('on', !!cur && cur.path === p);
      b.classList.toggle('open', !(cur && cur.path === p) && panes.some(q => curOf(q)?.path === p));
    }
    paintSel();
  }

  // ---------- すべてのノートの本文から検索（サイドバーの「検索」タブ・⇧⌘F）----------
  // VS Code の検索と同じく、ノートごとに見つかった行を並べる。行を押すと、そのノートを開いて ⌘F の検索でその場所へ
  let srch = null;
  function searchPane() {
    if (srch) return srch.el;
    const S = srch = { q: '', matchCase: false, res: null, seq: 0, timer: 0, folded: new Set() };
    S.el = el('div', 'nt-search');
    const row = el('div', 'nt-searchRow');
    const ic = el('span', 'nt-findIc');
    ic.innerHTML = icon('search');
    S.input = el('input', 'nt-searchInp');
    S.input.type = 'text';
    S.input.placeholder = 'ノートの本文から検索';
    S.input.spellcheck = false;
    S.caseBtn = btn('iconBtn nt-findCase', 'case-sensitive', () => { S.matchCase = !S.matchCase; S.caseBtn.classList.toggle('on', S.matchCase); runSearch(); S.input.focus(); }, '大文字と小文字を区別する');
    row.append(ic, S.input, S.caseBtn);
    S.status = el('p', 'nt-searchStatus');
    S.list = el('div', 'nt-searchList');
    S.el.append(row, S.status, S.list);
    S.input.addEventListener('input', () => { clearTimeout(S.timer); S.timer = setTimeout(runSearch, 180); });
    S.input.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(S.timer); runSearch(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); S.list.querySelector('.nt-hit')?.focus(); }
      else if (e.key === 'Escape' && S.input.value) { e.preventDefault(); e.stopPropagation(); S.input.value = ''; runSearch(); }
    });
    // 結果の中は ↑↓ で移動、Enter で開く
    S.list.addEventListener('keydown', e => {
      const rows = [...S.list.querySelectorAll('.nt-hit')];
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); rows[i + 1]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (rows[i - 1] || S.input).focus(); }
    });
    drawSearch();
    return S.el;
  }
  async function runSearch() {
    const S = srch;
    if (!S) return;
    const q = S.input.value;
    const seq = ++S.seq;
    if (!q.trim()) { S.q = ''; S.res = null; drawSearch(); return; }
    const r = await ctx.api.notes.search(q, { matchCase: S.matchCase });
    if (seq !== S.seq) return;
    S.q = q;
    S.res = r && !r.error ? r : { files: [], total: 0 };
    drawSearch();
  }
  function drawSearch() {
    const S = srch;
    S.list.innerHTML = '';
    const r = S.res;
    if (!r) { S.status.textContent = 'すべてのノートの本文から探します。行を押すと、そのノートのその場所が開きます'; return; }
    S.status.textContent = r.total ? `${r.files.length}${r.more ? '+' : ''} 件のノートで ${r.total} か所` : '見つかりませんでした';
    for (const f of r.files) {
      const g = el('div', 'nt-hitGroup' + (S.folded.has(f.path) ? ' folded' : ''));
      const hd = el('button', 'nt-hitFile');
      hd.type = 'button';
      hd.title = f.path;
      hd.innerHTML = icon('chevron-down') + icon('file-text');
      hd.append(el('span', 'name', f.name), el('small', 'dir', f.folder), el('span', 'cnt', String(f.count)));
      hd.addEventListener('click', () => { if (S.folded.has(f.path)) S.folded.delete(f.path); else S.folded.add(f.path); g.classList.toggle('folded'); });
      g.append(hd);
      f.hits.forEach((h, nth) => {
        const b = el('button', 'nt-hit');
        b.type = 'button';
        b.title = `${h.line + 1} 行目（⌥クリックで横に開く）`;
        b.append(document.createTextNode(h.before), el('mark', '', h.match), document.createTextNode(h.after));
        b.addEventListener('click', e => openHit(f, h, nth, e.altKey));
        b.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); openHit(f, h, nth, e.altKey); } });
        g.append(b);
      });
      if (f.count > f.hits.length) g.append(el('p', 'nt-hitMore', `ほか ${f.count - f.hits.length} か所（開いて ⌘F で続きを）`));
      S.list.append(g);
    }
  }
  // 結果の行から開く：ノートを開いて、⌘F の検索をその一致に合わせる
  async function openHit(f, h, nth, side) {
    const q = srch.q, matchCase = srch.matchCase;
    if (side) await openSide(f.path); else await open(f.path);
    if (!cur || cur.path !== f.path) return;
    // 読む画面は本文だけ（先頭のプロパティは出ない）なので、プロパティの中の一致は数えない
    const fmLen = cur.text.length - splitFrontmatter(cur.text).body.length;
    const before = srch.res?.files.find(x => x.path === f.path)?.hits.filter(x => x.offset < fmLen).length || 0;
    requestAnimationFrame(() => openFind(active, q, { offset: h.offset, nth: nth - before, matchCase }));
  }
  // ⇧⌘F・パレットから：検索タブを開いて、入力欄へ
  async function openSearch(q) {
    ctx.go('notes');
    ctx.showSide?.();
    if (sideTab() !== 'search') await setSideTab('search');
    else if (side) renderSide(side);
    searchPane();
    if (q != null && q !== '') { srch.input.value = q; runSearch(); }
    // ⌘K から来たときは、閉じたダイアログがフォーカスを戻し終えてから入力欄へ
    setTimeout(() => { srch.input.focus(); srch.input.select(); }, 30);
  }

  // ---------- プロジェクトとのひも付け ----------
  const projectsOf = n => [].concat(n.frontmatter?.project ?? []).map(v => String(v).replace(/^\[\[|\]\]$/g, ''));
  async function setProject(path, name, add) {
    for (const pn of panes) if (curOf(pn)?.path === path && curOf(pn).dirty) await withPane(pn, () => saveNow());
    const r = await ctx.api.notes.setProject(path, name, add);
    if (r && r.error) { toast(r.error, 'warn'); return false; }
    await load();
    for (const pn of panes) {
      const c = curOf(pn);
      if (c && c.path === path) { const n = await ctx.api.notes.read(path); if (!n.error) Object.assign(c, { text: n.text, mtime: n.mtime, base: n.text }); }
    }
    return true;
  }
  // 既存のノートを選んでプロジェクトに追加（ノートのプロパティに project: 名前 が入る）
  function pickForProject(name, onDone) {
    const d = el('dialog', 'bmPick ntPick');
    const head = el('div', 'bmp-head');
    head.append(withIcon('h2', '', 'notebook-text', `「${name}」にノートを追加`), btn('iconBtn', 'x', () => d.close(), '閉じる'));
    const q = el('input', 'inp'); q.placeholder = 'ノートの名前・フォルダ・タグで検索'; q.type = 'search';
    const list = el('div', 'bmp-list');
    let added = 0;
    const draw = () => {
      list.innerHTML = '';
      const w = q.value.trim().toLowerCase();
      const items = data.notes.filter(n => !w || (n.name + ' ' + n.path + ' ' + n.tags.join(' ') + ' ' + n.excerpt).toLowerCase().includes(w))
        .sort((a, b) => b.mtime - a.mtime).slice(0, 80);
      for (const n of items) {
        const on = projectsOf(n).includes(name);
        const r = el('button', 'bmp-row' + (on ? ' on' : ''));
        r.type = 'button';
        r.disabled = on;
        const ic = el('span', 'ck-ic'); ic.innerHTML = icon('file-text');
        const tx = el('span', 'tx');
        tx.append(el('b', '', n.name), el('small', '', [n.folder || 'いちばん上', ...projectsOf(n).filter(x => x !== name).map(x => '📁' + x)].join('・')));
        r.append(ic, tx, on ? withIcon('span', 'st done', 'check', '追加済み') : withIcon('span', 'st', 'plus', '追加'));
        r.addEventListener('click', async () => { if (await setProject(n.path, name, true)) { added++; draw(); } });
        list.append(r);
      }
      if (!items.length) list.append(withIcon('p', 'pj-empty', 'search', data.notes.length ? '見つかりませんでした' : 'ノートはまだありません'));
    };
    q.addEventListener('input', draw);
    const foot = el('div', 'dlgBtns');
    const close = el('button', 'btn primary', '完了'); close.type = 'button'; close.addEventListener('click', () => d.close());
    foot.append(el('small', 'nt-note', 'ノートのプロパティに「project: ' + name + '」を書き足します（Obsidian でも見えます）'), close);
    d.append(head, q, list, foot);
    document.body.append(d);
    d.addEventListener('close', () => { d.remove(); if (added) toast(`${added}件のノートを追加しました`); onDone?.(); });
    draw();
    d.showModal();
    q.focus();
  }

  // ---------- 画面の幅に合わせた並び ----------
  // 広いとき：右に「見出し・バックリンク」の列（ボタンで隠せる）
  // 狭いとき：右の列は出さず（本文に被るので）、ボタンでサイドバーの「目次」タブに切り替える。さらに狭いと「並べる」は上下に並べる
  let lastListTab = 'files';
  const infoPref = () => ctx.get().settings.notesInfo !== false;
  const sideTab = () => { const t = ctx.get().settings.notesSideTab; return ['tags', 'outline', 'search'].includes(t) ? t : 'files'; };
  async function setSideTab(id) {
    if (id !== 'outline') lastListTab = id;
    await ctx.api.settings.set({ notesSideTab: id });
    if (side) renderSide(side);
    applyLayout();
  }
  // 幅は列（box）から測る。作ったばかりでまだ画面に入れていない wrap は幅 0 になり、
  // 「狭い」と間違えて並びを作ったあと、次のフレームで作り直していた（右のパネルが遅れて出て、画面全体の計算が2回走る）
  const widthOf = wrap => (wrap?.isConnected ? wrap.clientWidth : 0) || box?.clientWidth || 0;
  function isNarrow(wrap) {
    return widthOf(wrap || box) < (view() === 'split' ? 1100 : 820);
  }
  function applyLayout(wrap = box?.querySelector('.nt-wrap'), withBtn = true) {
    if (!wrap) return;
    const narrow = isNarrow(wrap);
    wrap.classList.toggle('info-col', !narrow && infoPref());
    wrap.classList.toggle('stack', view() === 'split' && widthOf(wrap) < 720);
    const b = withBtn && document.getElementById('ntInfoBtn');
    if (b) {
      const shown = narrow ? sideTab() === 'outline' : infoPref();
      b.classList.toggle('on', shown);
      const ic = narrow ? (shown ? 'panel-left-close' : 'panel-left') : (shown ? 'panel-right-close' : 'panel-right');
      if (b.dataset.ic !== ic) { b.dataset.ic = ic; b.innerHTML = icon(ic); }
      const t = narrow ? (shown ? 'サイドバーをファイルの一覧に戻す' : 'サイドバーに目次（見出し・バックリンク）を出す')
        : (shown ? '右のパネル（見出し・バックリンク）を隠す' : '右のパネル（見出し・バックリンク）を出す');
      if (b.title !== t) b.title = t;
    }
  }
  function toggleInfo() {
    const wrap = box?.querySelector('.nt-wrap');
    if (wrap && isNarrow(wrap)) setSideTab(sideTab() === 'outline' ? lastListTab : 'outline');
    else ctx.api.settings.set({ notesInfo: !infoPref() });
  }

  // ---------- 上のボタン ----------
  function toolbar(tr, mk2) {
    if (!info.ready) return;
    const seg = el('div', 'seg nt-mode');
    for (const [v, ic, label] of [['edit', 'pen-line', '書く'], ['split', 'columns-2', '並べる'], ['preview', 'book-open', '読む']]) {
      const b = el('button', view() === v ? 'on' : '');
      b.type = 'button';
      b.innerHTML = icon(ic);
      b.append(el('span', 'lbl', label));
      b.title = label + '（⌘E で 読む⇔並べる）';
      b.addEventListener('click', () => setView(v));
      seg.append(b);
    }
    const saved = el('span', 'nt-saved'); saved.id = 'ntSaved';
    if (cur) {
      tr.append(saved);
      if (ctx.api.notes.insertLog && data.notes.find(n => n.path === cur.path)?.day) tr.append(mk2('btn white nt-logBtn', 'clipboard-list', '今日の記録', insertLog, 'その日の集中・完了したタスク・毎日確認を「## 今日の記録」に入れる（もう一度押すと入れかえ）'));
      tr.append(seg);
      const more = el('div', 'nt-more');
      more.append(btn('iconBtn', 'search', () => openFind(active), 'このノートの中を検索（⌘F）。すべてのノートの本文からは、サイドバーの「検索」（⇧⌘F）'));
      more.append(btn('iconBtn', 'square-split-horizontal', splitRight, `右に分割（⌘\\）。サイドバーやリンクを ⌥クリックすると横に開きます（${MAX_PANES}列まで）`));
      more.append(btn('iconBtn', 'pencil', rename, '名前・フォルダを変更'));
      more.append(btn('iconBtn', 'keyboard', showKeys, 'キー操作の一覧（VS Code と同じ。⇧⌘P → 「キー」でも）'));
      if (info.isVault && ctx.api.notes.openInObsidian) more.append(btn('iconBtn', 'arrow-up-right', () => ctx.api.notes.openInObsidian(cur.path), 'Obsidian で開く'));   // MDWS
      if (ctx.api.notes.reveal) more.append(btn('iconBtn', 'folder-open', () => ctx.api.notes.reveal(cur.path), 'Finder で表示'));   // MDWS
      more.append(btn('iconBtn del', 'trash-2', remove, '削除'));
      const ib2 = btn('iconBtn nt-infoBtn', 'panel-right', toggleInfo, '右のパネル');
      ib2.id = 'ntInfoBtn';
      more.append(ib2);
      tr.append(more);
      requestAnimationFrame(() => applyLayout());
    } else {
      tr.append(mk2('btn white', 'text-quote', 'テンプレートから', newFromTemplate), mk2('btn white', 'calendar-days', '今日のノート', daily), mk2('btn primary', 'file-plus', '新しいノート', () => newNote('')));
    }
  }

  // ---------- 画面のクリック（リンク・タグ） ----------
  document.addEventListener('click', e => {
    const a = e.target.closest?.('#notesView a, .pj-notes a');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.href) {
      // ⌥／⌘クリック：横（右の列）に開く
      const n = (e.altKey || e.metaKey || e.ctrlKey) && a.closest('#notesView') ? resolve(String(a.dataset.href).split('#')[0], cur?.path) : null;
      n ? openSide(n.path) : openLink(a.dataset.href);
    }
    else if (a.dataset.tag) filterTag(a.dataset.tag);
    else if (/^https?:/i.test(a.getAttribute('href') || '')) ctx.api.app.openUrl(a.getAttribute('href'));
  });

  // ================= テンプレートとの連携 =================
  // Obsidian のテンプレートの {{title}} {{date}} {{time}} {{date:YYYY-MM-DD}} を埋める
  function obsidianFill(text, title) {
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const fmt = (f, def) => (f || def).replace(/YYYY|MM|DD|HH|mm|ss|M|D/g, t => ({ YYYY: d.getFullYear(), MM: p2(d.getMonth() + 1), DD: p2(d.getDate()), HH: p2(d.getHours()), mm: p2(d.getMinutes()), ss: p2(d.getSeconds()), M: d.getMonth() + 1, D: d.getDate() }[t]));
    return text.replace(/\{\{\s*title\s*\}\}/g, title || '').replace(/\{\{\s*date(?::([^}]+))?\s*\}\}/g, (_, f) => fmt(f, 'YYYY-MM-DD')).replace(/\{\{\s*time(?::([^}]+))?\s*\}\}/g, (_, f) => fmt(f, 'HH:mm'));
  }
  // 使えるテンプレート：Workstation のテンプレート ＋ Vault のテンプレートフォルダのノート
  function templateSources() {
    const out = [];
    for (const t of (window.Templates ? Templates.all() : [])) out.push({ kind: 'ws', t, title: t.title, sub: [Templates.folderOf(t).name, ...(t.tags || []).map(x => '#' + x)].filter(Boolean).join(' '), uses: t.uses || 0, pinned: t.pinned });
    const tf = info.templatesFolder;
    if (tf) for (const n of data.notes.filter(n => n.path.startsWith(tf + '/'))) out.push({ kind: 'obs', note: n, title: n.name, sub: 'Obsidian のテンプレート', uses: 0 });
    return out;
  }
  function pickTemplate(title, onPick) {
    const d = el('dialog', 'bmPick ntPick');
    const head = el('div', 'bmp-head');
    head.append(withIcon('h2', '', 'text-quote', title), btn('iconBtn', 'x', () => d.close(), '閉じる'));
    const q = el('input', 'inp'); q.placeholder = 'テンプレートを検索'; q.type = 'search';
    const list = el('div', 'bmp-list');
    let sel = 0, items = [];
    const draw = () => {
      list.innerHTML = '';
      const w = q.value.trim().toLowerCase();
      items = templateSources().filter(x => !w || (x.title + ' ' + x.sub + ' ' + (x.t?.body || '')).toLowerCase().includes(w))
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.uses - a.uses);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      items.forEach((x, i) => {
        const r = el('button', 'bmp-row' + (i === sel ? ' on' : ''));
        r.type = 'button';
        const ic = el('span', 'ck-ic'); ic.innerHTML = icon(x.kind === 'obs' ? 'file-text' : (Templates.folderOf(x.t).icon || 'text-quote'));
        const tx = el('span', 'tx');
        tx.append(el('b', '', x.title), el('small', '', x.sub || ''));
        const vars = x.kind === 'ws' ? Templates.vars(x.t.body).filter(v => v.kind !== 'auto').length : 0;
        r.append(ic, tx, withIcon('span', 'st', vars ? 'text-cursor-input' : 'plus', vars ? `入力 ${vars}つ` : '入れる'));
        r.addEventListener('click', () => { d.close(); onPick(x); });
        list.append(r);
      });
      if (!items.length) list.append(withIcon('p', 'pj-empty', 'search', templateSources().length ? '見つかりませんでした' : 'テンプレートはまだありません（テンプレートのタブで作れます）'));
    };
    q.addEventListener('input', () => { sel = 0; draw(); });
    q.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      if (e.key === 'Enter' && items[sel]) { e.preventDefault(); e.stopPropagation(); d.close(); onPick(items[sel]); }
    });
    d.append(head, q, list);
    document.body.append(d);
    d.addEventListener('close', () => d.remove());
    draw();
    d.showModal();
    q.focus();
  }
  // 入力欄のあるテンプレートは、小さな画面で入力してもらう → 埋めた文字を返す
  // askName があれば、新しいノートの名前もいっしょに聞く（{ text, name } を返す）
  async function resolveTemplate(x, noteTitle, askName) {
    const t = x.kind === 'ws' ? x.t : null;
    const vars = t ? Templates.vars(t.body).filter(v => v.kind !== 'auto') : [];
    let obsText = '';
    if (x.kind === 'obs') {
      const r = await ctx.api.notes.read(x.note.path);
      if (r.error) { toast(r.error, 'warn'); return null; }
      obsText = r.text;
    }
    const finish = (vals, name) => {
      if (x.kind === 'obs') return obsFill(obsText, name);
      const last = Object.fromEntries(vars.filter(v => v.kind !== 'long').map(v => [v.name, vals[v.name]]));
      Templates.markUsed(t, last);
      return Templates.fill(t.body, vals);
    };
    const obsFill = (text, name) => obsidianFill(text, name || noteTitle);
    if (!vars.length && askName == null) return finish({}, noteTitle);
    return new Promise(resolve => {
      const d = el('dialog', 'ntFill');
      const f = el('form'); f.method = 'dialog';
      const inputs = {};
      f.append(el('h2', '', x.title), el('p', 'nt-note', askName != null ? '新しいノートを作ります' : '入力すると、ノートに入れる文章ができます'));
      let nameInp = null;
      if (askName != null) {
        const lab = el('label', 'field');
        nameInp = el('input', 'inp'); nameInp.value = askName; nameInp.required = true;
        lab.append('ノートの名前', nameInp);
        f.append(lab);
      }
      for (const v of vars) {
        const lab = el('label', 'field');
        lab.append(v.name);
        let inp;
        if (v.kind === 'choice') { inp = el('select', 'inp'); v.options.forEach(o => inp.append(new Option(o, o))); }
        else if (v.kind === 'long') { inp = el('textarea', 'inp'); inp.rows = 4; }
        else inp = el('input', 'inp');
        inp.value = t.last?.[v.name] ?? v.def ?? (v.kind === 'choice' ? v.options[0] : '');
        inputs[v.name] = inp;
        lab.append(inp);
        f.append(lab);
      }
      const row = el('div', 'dlgBtns');
      const cancel = el('button', 'btn', 'キャンセル'); cancel.type = 'button'; cancel.addEventListener('click', () => d.close('cancel'));
      const ok = el('button', 'btn primary', askName != null ? 'ノートを作る' : 'ノートに入れる'); ok.value = 'ok';
      row.append(el('span', 'spacer'), cancel, ok);
      f.append(row);
      d.append(f);
      document.body.append(d);
      d.addEventListener('close', () => {
        d.remove();
        if (d.returnValue !== 'ok') return resolve(null);
        const vals = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
        const name = nameInp ? nameInp.value.trim() || askName : noteTitle;
        const text = finish(vals, name);
        resolve(askName != null ? { text, name } : text);
      });
      d.showModal();
      (nameInp || Object.values(inputs)[0])?.focus();
      nameInp?.select();
    });
  }
  // 書いているノートのカーソルの位置にテンプレートを入れる
  function insertTemplate(ta) {
    const pos = [ta.selectionStart, ta.selectionEnd];
    pickTemplate('テンプレートを入れる', async x => {
      let text = await resolveTemplate(x, cur ? nameOf(cur.path) : '');
      if (text == null) return;
      // 行の途中なら改行してから入れる
      if (pos[0] > 0 && ta.value[pos[0] - 1] !== '\n' && !fmParse(text).props.length) text = '\n' + text;
      // 先頭のプロパティ（---）つきのテンプレートで、ノートにもうプロパティがあるときは、本文だけ入れて項目はまとめる
      const tf = fmParse(text);
      ta.focus();
      ta.setSelectionRange(pos[0], pos[1]);
      if (tf.props.length && cur && /^---\r?\n/.test(cur.text)) {
        put(ta, pos[0], pos[1], tf.body);
        const { props } = fmParse(cur.text);
        for (const p of tf.props) if (!props.some(q => q.key === p.key)) props.push(p);
        writeProps(props);
        renderProps(true);
      } else if (tf.props.length && cur && !cur.text.trim()) {
        put(ta, 0, ta.value.length, text);
      } else put(ta, pos[0], pos[1], text);
      toast(`「${x.title}」を入れました`);
    });
  }
  // テンプレートから新しいノートを作る
  function newFromTemplate() {
    if (!info.ready) { ctx.go('notes'); return; }
    pickTemplate('テンプレートからノートを作る', async x => {
      const d = new Date(), p2 = n => String(n).padStart(2, '0');
      const r = await resolveTemplate(x, '', `${x.title} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
      if (r == null) return;
      await newNote(undefined, r.name, r.text);
    });
  }
  // テンプレートのタブから：入力した文章を、新しいノート／開いているノート／今日のノートへ
  function chooseTarget(e, title, text, onDone) {
    const go = async fn => { await fn(); onDone?.(); };
    const appendTo = async path => {
      const r = await ctx.api.notes.read(path);
      if (r.error) return toast(r.error, 'warn');
      const sep = r.text && !r.text.endsWith('\n') ? '\n\n' : r.text ? '\n' : '';
      const w = await ctx.api.notes.write(path, r.text + sep + text, { expectMtime: r.mtime });
      if (w.error || w.conflict) return toast('書き込めませんでした。もう一度お試しください', 'warn');
      await load();
      await open(path, { edit: true, end: true });
      toast(`「${nameOf(path)}」に入れました`);
    };
    const items = [
      { icon: 'file-plus', label: `新しいノート「${title}」を作る`, run: () => go(async () => { await load(); const r = await ctx.api.notes.create(activeFolder || '', title, text); if (r.error) return toast(r.error, 'warn'); await load(); await open(r.path); toast('ノートを作りました'); }) },
      { icon: 'calendar-days', label: '今日のノートの最後に入れる', run: () => go(async () => { const r = await ctx.api.notes.daily(); if (r.error) return toast(r.error, 'warn'); await appendTo(r.path); }) },
    ];
    if (cur) items.splice(1, 0, { icon: 'file-text', label: `開いていたノート「${nameOf(cur.path)}」の最後に入れる`, run: () => go(async () => { await saveNow(); await appendTo(cur.path); }) });
    menu(items, e);
  }

  // ---------- サイドバーの幅（右端をドラッグで変える。ダブルクリックで元に戻す） ----------
  function setupResizer() {
    const sideEl = document.querySelector('aside.side');
    if (!sideEl || sideEl.querySelector('.nt-resizer')) return;
    const h = el('div', 'nt-resizer');
    h.title = 'ドラッグで幅を変える（ダブルクリックで元に戻す）';
    sideEl.append(h);
    const apply = w => { if (w) document.body.style.setProperty('--nt-side', w + 'px'); else document.body.style.removeProperty('--nt-side'); };
    apply(ctx.get().settings.notesSideW);
    h.addEventListener('pointerdown', e => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      h.classList.add('dragging');
      document.body.classList.add('nt-resizing');
      const left = sideEl.getBoundingClientRect().left;
      let w = sideEl.offsetWidth;
      const move = ev => { w = Math.round(Math.min(560, Math.max(180, ev.clientX - left))); apply(w); };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.classList.remove('dragging');
        document.body.classList.remove('nt-resizing');
        ctx.api.settings.set({ notesSideW: w });
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up, { once: true });
    });
    h.addEventListener('dblclick', () => { apply(0); ctx.api.settings.set({ notesSideW: 0 }); });
  }

  window.NotesApp = {
    init(o) {
      ctx = o;
      ctx.api.on.notes(async ch => {
        if (!(await patch(ch?.files))) await load();
        // 開いているノートがほかのアプリで書き換えられたら、こちらで書きかけでなければ読み直す（どの列も）
        for (const p of [...panes]) {
          const c = curOf(p);
          if (!c || c.dirty) continue;
          const r = await ctx.api.notes.read(c.path);
          if (curOf(p) !== c) continue;
          if (r.error) withPane(p, () => { cur = null; });
          else if (Math.abs(r.mtime - c.mtime) > 1) { c.mtime = r.mtime; c.base = r.text; if (r.text !== c.text) c.text = r.text; }
        }
        if (srch?.res) runSearch();
        ctx.refresh();
      });
    },
    // はじめの読み込み（ノートが多いと時間がかかるので、起動の画面は待たせない。ノートの画面は読み込み終わってから出す）
    start() {
      if (!startP) { started = true; setupResizer(); startP = load().then(() => { loaded = true; warmFonts(); }); }
      return startP;
    },
    loading: () => !loaded,
    split: splitRight,
    openSide,
    load,
    show(container) {
      viewEl = container;
      if (!loaded) { container.innerHTML = ''; container.append(withIcon('p', 'nt-sideNote nt-loading', 'loader', 'ノートを読み込んでいます…')); startP?.then(() => ctx.refresh()); return; }
      renderPanes();
    },
    renderSide,
    syncSide,
    toolbar,
    title: () => (info.ready ? (cur ? nameOf(cur.path) : tagFilter ? `#${tagFilter}` : 'ノート') : 'ノート'),
    sub: () => (cur ? folderOf(cur.path) || (info.isVault ? 'Vault' : '') : ''),
    all: () => data.notes,
    ready: () => info.ready,
    open,
    newNote,
    newFromTemplate,
    chooseTarget,
    setProject,
    pickForProject,
    projectsOf,
    daily,
    insertLog,
    find: t => resolve(t, cur?.path || ''),
    findInNote: opt => openFind(active, undefined, null, opt),
    showKeys,
    gotoLine: () => { const ta = active?.body.querySelector('.nt-editor'); if (ta && view() !== 'preview') gotoLinePrompt(ta); else toast('書く・並べる画面で使えます', 'warn'); },
    recent: () => [...data.notes].sort((a, b) => b.mtime - a.mtime),
    searchAll: openSearch,
    openLink: t => (info.ready ? openLink(t) : ctx.go('notes')),
    notesWithUrl,
    menu,
    onKey(e) {
      if (document.activeElement?.closest?.('#sideNotes .nt-tree') && onTreeKey(e)) return true;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveNow(); return true; }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'f' || e.code === 'KeyF')) { e.preventDefault(); if (e.shiftKey) openSearch(selectedText()); else openFind(active, undefined, null, { replace: e.altKey }); return true; }
      // 次・前の一致：Mac は ⌘G／⇧⌘G、Windows は F3／Shift+F3（どちらでも F3 は使える）
      if (active?.find && ((Keys.isMac && e.metaKey && e.key.toLowerCase() === 'g') || e.key === 'F3')) { e.preventDefault(); stepFind(active, e.shiftKey ? -1 : 1); return true; }
      // Windows の置換は Ctrl+H（VS Code と同じ）
      if (!Keys.isMac && e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); openFind(active, undefined, null, { replace: true }); return true; }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); splitRight(); return true; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') { e.preventDefault(); setView(view() === 'preview' ? 'split' : 'preview'); return true; }
      return false;
    },
    flush: saveNow,
    applySnippets,
  };
})();
