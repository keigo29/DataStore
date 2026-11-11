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
    const i = ls.findIndex(l => new RegExp(`^${key}\\s*:`, 'i').test(l));
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

