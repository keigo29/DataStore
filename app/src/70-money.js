  // ================= お金（finance） =================
  // 書き方：- 💸 1,200 ランチ #食費（出費）／- 💰 250,000 給料（収入）／- 🏦 30,000 [[引越し資金]]（貯金目標へ）
  // 貯金目標：ノートの先頭に type: 目標・target: 500000・due: 2027-03-31（Finance/引越し資金.md など）
  let moneyMonth = null;        // 'YYYY-MM'
  let moneyCat = null;          // 記録の一覧をカテゴリでしぼる
  const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const ymOf = k => k.slice(0, 7);
  const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  // 家計アプリと同じカテゴリ（名前・色）
  const KAKEI_CATS = { food: ['食費', '#f76b15'], daily: ['日用品', '#12a594'], transport: ['交通', '#0090ff'], housing: ['住まい', '#6e56cf'], utility: ['水道光熱', '#e2a336'], phone: ['通信', '#05a2c2'],
    hobby: ['趣味', '#8e4ec6'], social: ['交際', '#d6409f'], clothes: ['衣服', '#e54666'], beauty: ['美容', '#ab4aba'], medical: ['医療', '#e5484d'], study: ['教育', '#30a46c'],
    subscription: ['サブスク', '#3e63dd'], cafe: ['カフェ', '#a07553'], 'other-ex': ['その他', '#8b8b93'], salary: ['給与', '#30a46c'], side: ['副業', '#12a594'], bonus: ['臨時収入', '#d6409f'], 'other-in': ['その他', '#8b8b93'] };
  const ACCT_TYPES = { cash: '現金', bank: '銀行', card: 'クレジットカード', emoney: '電子マネー' };
  let kakeiCache = { text: null, v: null };
  function kakei() {
    const t = S.cfg?.['Data/kakei.json'];
    if (!t) return null;
    if (kakeiCache.text === t) return kakeiCache.v;
    let v = null;
    try {
      const d = JSON.parse(t);
      const accounts = (d.accounts || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      const txs = (d.txs || []).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.amount > 0).map(x => {
        const c = KAKEI_CATS[x.category] || [x.category || 'その他', '#8b8b93'];
        const acc = accounts.find(a => a.id === x.accountId);
        return { type: 'money', src: 'kakei', kind: x.type === 'income' ? 'in' : x.type === 'expense' ? 'out' : 'move', amount: x.amount, date: x.date, title: x.memo || c[0], cat: c[0], color: c[1], account: acc?.name || '', tx: x, line: 0, tags: [], links: [] };
      });
      v = { accounts, txs, budget: d.settings?.budget || 0 };
    } catch (e) { console.error(e); v = { error: true, accounts: [], txs: [], budget: 0 }; }
    kakeiCache = { text: t, v };
    return v;
  }
  // 口座の残高（家計アプリと同じ：はじめの残高 ＋ 収入 − 出費 ± 振替）。until までの分
  function balanceOf(a, until) {
    let b = a.initial || 0;
    for (const t of kakei()?.txs || []) {
      if (until && t.date > until) continue;
      const x = t.tx;
      if (x.type === 'income' && x.accountId === a.id) b += x.amount;
      if (x.type === 'expense' && x.accountId === a.id) b -= x.amount;
      if (x.type === 'transfer') { if (x.accountId === a.id) b -= x.amount; if (x.toAccountId === a.id) b += x.amount; }
    }
    return b;
  }
  // 家計のデータ ＋ ノートに書いた 💸💰🏦
  const moneyItems = () => [...(kakei()?.txs || []), ...items.filter(i => i.type === 'money' && i.date)];
  const catOf = i => i.cat || (i.tags && i.tags[0]) || (i.kind === 'in' ? '収入' : i.kind === 'save' ? '貯金' : 'その他');
  function goals() {
    const out = [];
    for (const [p, f] of Object.entries(S.files)) {
      const { props } = splitFrontmatter(f.text);
      const get = k => (props || []).find(x => x.k.toLowerCase() === k)?.v[0];
      if (!/^(目標|貯金|goal|savings?)$/i.test(get('type') || '') && !get('target')) continue;
      const target = parseFloat(String(get('target') || get('目標') || '0').replace(/[,¥￥円]/g, '')) || 0;
      const base = parseFloat(String(get('saved') || '0').replace(/[,¥￥円]/g, '')) || 0;
      const due = /^\d{4}-\d{2}-\d{2}$/.test(get('due') || '') ? get('due') : null;
      out.push({ path: p, name: nameOf(p), target, base, due, color: get('color') || null, saved: base });
    }
    for (const it of moneyItems()) {
      if (it.kind !== 'save') continue;
      for (const l of it.links || []) { const r = resolve(l, it.path); const g = out.find(x => x.path === r); if (g) { g.saved += it.amount; break; } }
    }
    const cols = ['#4ade80', '#a78bfa', '#fb923c', '#38bdf8', '#f472b6'];
    out.forEach((g, i) => { if (!g.color) g.color = cols[i % cols.length]; });
    return out.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  }
  // その月の数字
  function monthStats(ym) {
    const list = moneyItems().filter(i => ymOf(i.date) === ym);
    const n = daysIn(ym), day = Array.from({ length: n }, () => ({ in: 0, out: 0, save: 0 }));
    let tin = 0, tout = 0, tsave = 0;
    for (const i of list) { if (i.kind === 'move') continue; const d = +i.date.slice(8) - 1; day[d][i.kind] += i.amount; if (i.kind === 'in') tin += i.amount; else if (i.kind === 'out') tout += i.amount; else tsave += i.amount; }
    return { list, day, tin, tout, tsave, rest: tin - tout };
  }
  const cum = arr => { let s = 0; return arr.map(v => (s += v)); };

  // なめらかな線（Catmull-Rom → ベジェ）
  function smoothPath(pts) {
    if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
    // 曲げるための点が、データの上下（いちばん大きい・小さい）をはみ出さないように（0 より下に見えないように）
    const ys = pts.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), cy = y => Math.max(lo, Math.min(hi, y));
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, cy(p1[1] + (p2[1] - p0[1]) / 6)], c2 = [p2[0] - (p3[0] - p1[0]) / 6, cy(p2[1] - (p3[1] - p1[1]) / 6)];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }
  let svgId = 0;
  // 小さな線のグラフ（下を色でうすくぬる）
  function spark(vals, color, w = 120, h = 56, fromZero = true) {
    const id = 'sg' + ++svgId, max = fromZero ? Math.max(1, ...vals) : Math.max(...vals), min = fromZero ? Math.min(0, ...vals) : Math.min(...vals);
    const pts = vals.map((v, i) => [vals.length < 2 ? w : (i / (vals.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 8)]);
    const line = smoothPath(pts);
    return `<svg class="fSpark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".38"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line} L${w},${h} L0,${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" class="fGlow" style="--g:${color}"/></svg>`;
  }
  // 大きな線のグラフ：押す・マウスを乗せると、その日の額
  function bigChart(vals, keys, color, fmt) {
    const W = 600, H = 200, id = 'bg' + ++svgId, max = Math.max(1, ...vals) * 1.12;
    const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * W, H - 6 - (v / max) * (H - 18)]);
    const box = el('div', 'fBig');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <g class="fGrid">${[0.25, 0.5, 0.75].map(y => `<line x1="0" x2="${W}" y1="${H * y}" y2="${H * y}"/>`).join('')}</g>
      <path d="${smoothPath(pts)} L${W},${H} L0,${H} Z" fill="url(#${id})"/>
      <path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke" class="fGlow" style="--g:${color}"/></svg>`;
    const tip = el('div', 'fTip'); tip.hidden = true;
    const dot = el('i', 'fDot'); dot.hidden = true; dot.style.setProperty('--g', color);
    const vl = el('i', 'fVline'); vl.hidden = true;
    box.append(vl, dot, tip);
    const at = x => {
      const r = box.getBoundingClientRect(), i = Math.max(0, Math.min(vals.length - 1, Math.round(((x - r.left) / r.width) * (vals.length - 1))));
      const px = (pts[i][0] / W) * r.width, py = (pts[i][1] / H) * r.height;
      dot.hidden = tip.hidden = vl.hidden = false;
      dot.style.left = px + 'px'; dot.style.top = py + 'px'; vl.style.left = px + 'px'; vl.style.top = py + 'px';
      tip.textContent = `${md(keys[i])}  ${fmt(vals[i])}`;
      tip.style.left = Math.max(50, Math.min(r.width - 50, px)) + 'px'; tip.style.top = Math.max(0, py - 38) + 'px';
    };
    box.addEventListener('pointermove', e => at(e.clientX));
    box.addEventListener('pointerdown', e => at(e.clientX));
    box.addEventListener('pointerleave', () => { dot.hidden = tip.hidden = vl.hidden = true; });
    return box;
  }

  function renderMoney(main) {
    const tk = todayKey(), ym = moneyMonth || ymOf(tk);
    const K = kakei();
    const cur = monthStats(ym), prev = monthStats(ymAdd(ym, -1));
    const wrap = el('div', 'fin');
    const [yy, mm] = ym.split('-').map(Number);
    const isNow = ym === ymOf(tk), upto = isNow ? +tk.slice(8) : ym > ymOf(tk) ? 0 : daysIn(ym);
    // 月を変える
    const bar = el('div', 'fBar');
    bar.append(btn('iconBtn', 'chevron-left', () => { moneyMonth = ymAdd(ym, -1); render(); }, '前の月'),
      el('h2', 'fTtl', `${yy}年${mm}月`), btn('iconBtn', 'chevron-right', () => { moneyMonth = ymAdd(ym, 1); render(); }, '次の月'));
    if (!isNow) bar.append(btn('btn small white', '今月', () => { moneyMonth = null; render(); }));
    bar.append(el('span', 'fPill', `${cur.list.filter(i => i.kind !== 'move').length}件`));
    const last = K?.txs.reduce((m, t) => (t.date > m ? t.date : m), '') || '';
    if (last) bar.append(el('span', 'fSub fLast', `家計のデータ：${md(last)} まで`));
    wrap.append(bar);
    if (!K && !moneyItems().length) {
      const c = el('div', 'fCard fEmptyCard');
      c.append(el('h3', '', '家計のデータがまだありません'));
      c.insertAdjacentHTML('beforeend', '<p class="fSub">リポジトリの <code>Data/kakei.json</code>（家計アプリのバックアップと同じ形）を読みます。ノートに <code>- 💸 1,200 ランチ #食費</code>・<code>- 💰 250,000 給料</code> と書いた分も入ります。</p>');
      wrap.append(c); main.append(wrap); return;
    }
    // 上の数字のカード
    const delta = (a, b, good) => {
      if (!b) return el('span', 'fDelta', a ? '先月の記録はなし' : '');
      const r = ((a - b) / Math.abs(b)) * 100, up = r >= 0;
      const s2 = el('span', 'fDelta');
      s2.append(el('b', up === good ? 'g' : 'r', `${up ? '+' : ''}${r.toFixed(1)}%`), ' 先月から');
      return s2;
    };
    const kpi = (title, sub, val, color, vals, dl, extra) => {
      const c = el('div', 'fCard fKpi');
      c.style.setProperty('--k', color);
      c.append(el('h3', '', title), el('p', 'fSub', sub));
      const v = el('div', 'fVal');
      v.append(el('small', '', val < 0 ? '−¥' : '¥'), Math.round(Math.abs(val)).toLocaleString('ja-JP'));
      c.append(v, dl);
      if (extra) c.append(extra);
      const sp = el('div', 'fSpk'); sp.innerHTML = spark(vals, color); c.append(sp);
      return c;
    };
    let budgetEl = null;
    if (K?.budget) {
      const pct = (cur.tout / K.budget) * 100;
      budgetEl = el('div', 'fBudget' + (pct > 100 ? ' over' : ''));
      const pb = el('i'); pb.style.width = Math.min(100, pct) + '%';
      const bb = el('span', 'bar'); bb.append(pb);
      budgetEl.append(bb, el('small', '', `予算 ${yen(K.budget)} の ${Math.round(pct)}%`));
    }
    const ks = el('div', 'fKpis');
    ks.append(
      kpi('収入', `${mm}月に入ったお金`, cur.tin, '#4ade80', cum(cur.day.map(d => d.in)), delta(cur.tin, prev.tin, true)),
      kpi('出費', `${mm}月につかったお金`, cur.tout, '#fb923c', cum(cur.day.map(d => d.out)), delta(cur.tout, prev.tout, false), budgetEl),
      kpi('のこり', '収入 − 出費', cur.rest, '#a78bfa', cum(cur.day.map(d => d.in - d.out)), delta(cur.rest, prev.rest, true)));
    wrap.append(ks);

    // 出費の推移 ＋ 口座
    const row = el('div', 'fRow');
    const ch = el('div', 'fCard fChart');
    const n1 = Math.max(upto, 1);
    const dvals = cur.day.slice(0, n1).map(d => d.out), dkeys = dvals.map((_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
    ch.append(el('h3', '', '出費の推移'), el('p', 'fSub', `1日ごとの出費・${mm}月1日〜${n1}日`));
    ch.append(dvals.length > 1 && cur.tout ? bigChart(dvals, dkeys, '#4ade80', yen) : el('div', 'fEmpty', 'この月の出費はまだありません'));
    const ft = el('div', 'fFoot');
    const f1 = el('div'); f1.append(el('small', '', '1日あたり'), el('b', '', yen(cur.tout / n1)));
    const f2 = el('div', 'r'); f2.append(el('small', '', '期間'), el('span', '', `${yy}/${mm}/1 – ${yy}/${mm}/${n1}`));
    ft.append(f1, f2); ch.append(ft);
    row.append(ch);
    if (K?.accounts.length) {
      const ac = el('div', 'fCard fAccts');
      ac.append(el('h3', '', '口座'), el('p', 'fSub', `${isNow ? 'いま' : mm + '月末'}の残高（家計のデータから）`));
      const end = isNow ? tk : `${ym}-${String(daysIn(ym)).padStart(2, '0')}`;
      let total = 0;
      const AC = { bank: '#0090ff', card: '#f76b15', emoney: '#8e4ec6', cash: '#30a46c' };
      for (const a of K.accounts) {
        const bal = balanceOf(a, end); total += bal;
        const series = Array.from({ length: Math.max(n1, 2) }, (_, i) => balanceOf(a, `${ym}-${String(Math.min(i + 1, daysIn(ym))).padStart(2, '0')}`));
        const r = el('div', 'fCat fAcct');
        const ic = el('span', 'fIc', a.name.slice(0, 1)); ic.style.background = AC[a.type] || '#8b8b93';
        const nm = el('span', 'fNm'); nm.append(el('b', '', a.name), el('small', '', `${ACCT_TYPES[a.type] || ''}・${yen(bal)}`));
        const sp = el('span', 'fCs'); sp.innerHTML = spark(series, '#4ade80', 90, 26);
        r.append(ic, nm, sp); ac.append(r);
      }
      const f = el('div', 'fFoot'); const a1 = el('div'); a1.append(el('small', '', '合計'), el('b', '', yen(total))); f.append(a1); ac.append(f);
      row.append(ac);
    }
    wrap.append(row);

    // カテゴリ ＋ 貯金の目標
    const row2 = el('div', 'fRow');
    const cats = el('div', 'fCard fCats');
    cats.append(el('h3', '', 'カテゴリ'), el('p', 'fSub', '出費の多い順（押すと記録をしぼる）'));
    const byCat = new Map();
    for (const i of cur.list.filter(i => i.kind === 'out')) { const c = catOf(i); const o = byCat.get(c) || { sum: 0, color: i.color, day: Array(daysIn(ym)).fill(0) }; o.sum += i.amount; o.day[+i.date.slice(8) - 1] += i.amount; byCat.set(c, o); }
    const CC = ['#fb923c', '#38bdf8', '#a78bfa', '#4ade80', '#f472b6', '#facc15'];
    const top = [...byCat.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 7);
    if (!top.length) cats.append(el('div', 'fEmpty', '出費がまだありません'));
    top.forEach(([name, o], i) => {
      const r = btn('fCat' + (moneyCat === name ? ' on' : ''), [], () => { moneyCat = moneyCat === name ? null : name; render(); }, name);
      const ic = el('span', 'fIc', name.slice(0, 1)); ic.style.background = o.color || CC[i % CC.length];
      const nm = el('span', 'fNm'); nm.append(el('b', '', name), el('small', '', `${yen(o.sum)}・${Math.round((o.sum / cur.tout) * 100)}%`));
      const sp = el('span', 'fCs'); sp.innerHTML = spark(cum(o.day.slice(0, Math.max(n1, 2))), '#4ade80', 90, 26);
      r.append(ic, nm, sp); cats.append(r);
    });
    row2.append(cats);
    const gs = goals();
    const gc = el('div', 'fCard fGoals');
    const gh2 = el('div', 'fHead'); gh2.append(el('h3', '', '貯金の目標'), btn('iconBtn fPlus', 'plus', () => newGoal(), '目標をつくる'));
    gc.append(gh2, el('p', 'fSub', 'ノートの先頭の target（目標の金額）・saved（貯めた額）・due（期限）'));
    if (!gs.length) gc.append(el('div', 'fEmpty', '目標はまだありません。＋ でつくるか、プロジェクトのノートの先頭に target: を書きます'));
    for (const g of gs) {
      const r = el('div', 'fGoal');
      const pct = g.target ? Math.min(100, (g.saved / g.target) * 100) : 0;
      const t2 = el('div', 'fGTop');
      t2.append(btn('fGName', g.name, () => openNote(g.path)), el('span', 'fGPct', `${Math.round(pct)}%`));
      const pb = el('div', 'fProg'); const pi = el('i'); pi.style.width = pct + '%'; pi.style.setProperty('--g', g.color); pb.append(pi);
      const sub = el('div', 'fGSub');
      sub.append(el('span', '', `${yen(g.saved)} / ${yen(g.target)}`));
      if (g.due) {
        const left = Math.round((parseKey(g.due) - parseKey(tk)) / 864e5), rest = Math.max(0, g.target - g.saved);
        const months = Math.max(1, Math.ceil(left / 30.4));
        sub.append(el('span', '', left >= 0 ? (rest ? `あと${left}日・月に${yen(rest / months)}` : `あと${left}日・達成`) : `期限を${-left}日すぎています`));
      }
      r.append(t2, pb, sub);
      gc.append(r);
    }
    row2.append(gc);
    wrap.append(row2);

    // 記録の一覧
    const lc = el('div', 'fCard fList');
    const lh = el('div', 'fHead'); lh.append(el('h3', '', moneyCat ? `記録・${moneyCat}` : '記録'));
    if (moneyCat) lh.append(btn('btn small white', ['x', 'しぼりこみを外す'], () => { moneyCat = null; render(); }));
    lc.append(lh);
    const rows = cur.list.filter(i => i.kind !== 'move' && (!moneyCat || catOf(i) === moneyCat)).sort((a, b) => b.date.localeCompare(a.date) || (b.tx?.createdAt || '').localeCompare(a.tx?.createdAt || '')).slice(0, 60);
    if (!rows.length) lc.append(el('div', 'fEmpty', '記録はまだありません'));
    for (const i of rows) {
      const r = el(i.src === 'kakei' ? 'div' : 'button', 'fRec');
      if (i.src !== 'kakei') { r.type = 'button'; r.addEventListener('click', () => openNote(i.path)); }
      const ic = el('span', 'fIc sm', catOf(i).slice(0, 1)); ic.style.background = i.color || (i.kind === 'in' ? '#30a46c' : '#8b8b93');
      const nm = el('span', 'fRn'); nm.append(el('b', '', i.title || catOf(i)), el('small', '', [md(i.date), catOf(i), i.account || (i.src ? '' : 'ノート')].filter(Boolean).join('・')));
      r.append(ic, nm, el('span', 'fRa ' + i.kind, (i.kind === 'in' ? '+' : i.kind === 'out' ? '−' : '') + yen(i.amount)));
      lc.append(r);
    }
    wrap.append(lc);
    main.append(wrap);
  }

  // 貯金の目標をつくる（Finance/名前.md）
  function newGoal() {
    const inn = $('#sheetIn');
    sheetHead(inn, '貯金の目標をつくる');
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const nm = el('input', 'inp'); nm.placeholder = '例：引越し資金';
    const tg = el('input', 'inp'); tg.inputMode = 'numeric'; tg.placeholder = '例：500000';
    const du = el('input', 'inp'); du.type = 'date';
    inn.append(fld('名前', nm), fld('目標の金額（円）', tg), fld('期限（なくても可）', du), el('div', 'hint sub', 'Finance/名前.md に書きます'));
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['target', 'つくる'], async () => {
      const name = nm.value.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim(), target = parseFloat(tg.value.replace(/[,¥￥円]/g, ''));
      if (!name) { nm.focus(); return; }
      if (!target) { tg.focus(); return; }
      const rel = `Finance/${name}.md`;
      if (S.files[rel]) { toast('同じ名前の目標があります', 'warn'); return; }
      sheet.close();
      const text = `---\ntype: 目標\ntags: [お金]\ntarget: ${target}\n${du.value ? `due: ${du.value}\n` : ''}---\n# ${name}\n\n貯めた分は、デイリーノートなどに \`- 🏦 30,000 [[${name}]]\` と書きます。\n`;
      if (await edit(rel, () => text, `目標: ${name}`)) toast(`目標「${name}」をつくりました`);
    }));
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => nm.focus(), 50);
  }

