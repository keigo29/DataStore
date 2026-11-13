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
    requestAnimationFrame(() => { body.scrollTop = keep != null ? keep : Math.max(0, Math.floor(start / 60) * P - 12) /* ちょうどの時刻から（時刻の字が切れないように少し上） */; cgScroll = { key: sk, top: body.scrollTop }; });
    body.addEventListener('scroll', () => { cgScroll = { key: sk, top: body.scrollTop }; }, { passive: true });
    return wrap;
  }

  // 月：マス目に予定を並べる（スマホは点）
  // 期間のあるやること（🛫 開始日〜📅 期限）：月のカレンダーで、週をまたぐ帯にする（ガントと同じ中身）
  const isRange = i => i.type === 'todo' && i.start && i.date && i.start < i.date;
  function weekBars(ws, we) {
    const list = items.filter(i => isRange(i) && i.start <= we && i.date >= ws)
      .sort((x, y) => x.start.localeCompare(y.start) || y.date.localeCompare(x.date));
    const lanes = [];   // 列ごとの最後の日
    return list.map(i => {
      const a = i.start < ws ? ws : i.start, b = i.date > we ? we : i.date;
      let l = lanes.findIndex(e => e < a); if (l < 0) l = lanes.length;
      lanes[l] = b;
      return { i, a, b, lane: l };
    });
  }
  function monthGrid(compact) {
    const today = todayKey(), d0 = parseKey(calSel);
    const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
    const start = addDays(keyOf(first), -((first.getDay() + 6) % 7));
    const days = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((((first.getDay() + 6) % 7) + days) / 7);
    const wrap = el('div', 'cm' + (compact ? ' compact' : ''));
    const wd = el('div', 'cmWd');
    [1, 2, 3, 4, 5, 6, 0].forEach(i => wd.append(el('span', i === 0 || i === 6 ? 'we' : '', WD[i])));
    const grid = el('div', 'cmGrid cmWeeks');
    const hb = hbData(), hbOn = hb.habits.length > 0;
    let anyBar = false, anyLate = false;
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(start, w * 7), we = addDays(ws, 6);
      const bars = weekBars(ws, we), L = bars.length ? Math.max(...bars.map(x => x.lane)) + 1 : 0;
      const row = el('div', 'cmWeek');
      row.style.gridTemplateRows = `auto${L ? ` repeat(${L}, var(--cmBarH))` : ''} minmax(0, 1fr)`;
      for (let c = 0; c < 7; c++) {
        const k = addDays(ws, c), d = parseKey(k);
        const st = (d.getMonth() !== d0.getMonth() ? ' out' : '') + ([0, 6].includes(d.getDay()) ? ' we' : '') + (k === today ? ' today' : '') + (k === calSel ? ' sel' : '');
        const off = hbOn && hb.off.has(k);
        const cell = el('div', 'cmCell c' + (c + 1) + st + (off ? ' off' : ''));
        cell.style.gridColumn = c + 1; cell.style.gridRow = '1 / -1';
        if (off) cell.title = hb.off.get(k);
        const go = () => (compact ? (calSel === k ? newEvent(k) : calGo(k)) : newEvent(k));
        cell.addEventListener('click', go);
        const top = el('div', 'cmTop' + st); top.style.gridColumn = c + 1; top.style.gridRow = 1;
        const num = btn('cmNum', String(d.getDate()), e => { e.stopPropagation(); if (compact) { if (calSel === k) newEvent(k); else calGo(k); } else calGo(k, 'day'); }, `${md(k)}${compact ? '' : 'を開く'}`);
        top.append(num);
        if (hbOn && k <= today) { const s = hbDay(hb.habits, k, today); if (s.target && s.done === s.target) { const g = el('i', 'cmHb'); g.title = '確認項目を全部できた'; top.append(g); } }
        const { timed, allDay, todos } = dayItems(k);
        const list = [...allDay, ...timed, ...todos.filter(i => !isRange(i))];
        const ls = el('div', compact ? 'cmMini' + st : 'cmList');
        ls.style.gridColumn = c + 1; ls.style.gridRow = L + 2;
        if (compact) {
          const MAXM = 3;
          list.slice(0, MAXM).forEach(i => {
            const t = el('span', 'mi' + (i.type === 'todo' ? ' todo' + (k < today ? ' late' : '') : !i.time ? ' allday' : '') + (i.done ? ' done' : ''));
            t.textContent = i.title;
            ls.append(t);
          });
          if (list.length > MAXM) ls.append(el('span', 'miMore', `+${list.length - MAXM}`));
          if (dayFiles(k).length) top.append(el('i', 'cmNote'));
          ls.addEventListener('click', go);
        } else {
          const MAX = Math.max(2, 5 - L);   // マスがたて長なので少し多めに
          list.slice(0, MAX).forEach(i => ls.append(calChip(i)));
          if (list.length > MAX) ls.append(btn('calMore', `ほか ${list.length - MAX} 件`, e => { e.stopPropagation(); calGo(k, 'day'); }));
          ls.addEventListener('click', e => { if (!e.target.closest('button')) newEvent(k); });
          cell.title = (off ? hb.off.get(k) + '・' : '') + '空いているところを押すと、この日に予定を入れる';
        }
        row.append(cell, top, ls);
      }
      for (const { i, a, b, lane } of bars) {
        const pj = i.project && projByPath(i.project);
        const late = !i.done && i.date < today;
        anyBar = true; anyLate = anyLate || late;
        const ca = (parseKey(a) - parseKey(ws)) / 864e5, cb = (parseKey(b) - parseKey(ws)) / 864e5;
        const bar = btn('cmBar' + (i.start < ws ? ' cl' : '') + (i.date > we ? ' cr' : '') + (late ? ' late' : '') + (i.done ? ' done' : ''), [], e => { e.stopPropagation(); openItem(i); },
          `${i.title}（${sd(i.start)}〜${sd(i.date)}）${pj ? '・' + pj.name : ''}${late ? '・期限切れ' : ''}`);
        bar.title = bar.getAttribute('aria-label');
        bar.textContent = i.title;
        bar.style.gridColumn = `${ca + 1} / ${cb + 2}`; bar.style.gridRow = lane + 2;
        bar.style.setProperty('--c', pj?.color || 'var(--ev)');
        row.append(bar);
      }
      grid.append(row);
    }
    wrap.append(wd, grid);
    if (hbOn || anyBar) {
      const lg = el('div', 'cmLegend');
      if (hbOn) { lg.append(el('span', 'hb', '確認項目を全部できた'), el('span', 'off', '休みの日')); }
      if (anyBar) lg.append(el('span', 'lbar', '期間のあるやること'));
      if (anyLate) lg.append(el('span', 'late', '期限切れ'));
      wrap.append(lg);
    }
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
    if (hbData().habits.length) { const off = hbData().off.has(k); hd.append(btn('btn small white', [off ? 'undo-2' : 'tree-palm', off ? '休みを取り消す' : '休みにする'], () => hbToggleOff(k))); }
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
    main.classList.toggle('calMonth', W && calV() === 'month');   // 月は、マスをたて長にしてスクロールで見る
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

