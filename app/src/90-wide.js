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

