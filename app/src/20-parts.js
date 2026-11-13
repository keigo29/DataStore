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
    inp.placeholder = isWide() ? '例：14時 MTG／明日 10:00-11:30 歯医者' : '例：明日14時 歯医者';
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

