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

