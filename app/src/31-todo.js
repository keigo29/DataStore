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

