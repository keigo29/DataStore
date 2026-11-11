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

