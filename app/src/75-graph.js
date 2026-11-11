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

