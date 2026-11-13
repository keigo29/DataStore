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
      const q = el('div', 'navCard calSideQ'); const qb = quickEventBox(calSel); qb.querySelector('.inp').placeholder = '例：14時 MTG'; q.append(qb); sb.append(q);
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
    $('#view').classList.remove('calMode', 'calMonth');
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

