  // ================= 毎日確認（旧 Workstation の「毎日確認」と同じ画面） =================
  // 項目と休みの日：Notes/毎日確認.md（表と「## 休みの日」のリスト）
  // チェック：その日のデイリーノートの先頭のプロパティ（例 運動: 1）。外すと 0。TEDDY が書いても同じ
  const HB_FILE = 'Notes/毎日確認.md';
  const HB_COLORS = ['#005cff', '#00c230', '#ff5a00', '#8600ff', '#1fb8cc', '#f2280d', '#ffae00', '#717680'];
  // アイコンは Lucide（表の「アイコン」の列に名前を書く。例 dumbbell）
  const HB_ICONS = ['dumbbell', 'footprints', 'bike', 'activity', 'heart-pulse', 'droplet', 'glass-water', 'coffee', 'apple', 'salad', 'utensils', 'pill', 'book-open', 'notebook-pen', 'pen-line', 'languages', 'graduation-cap', 'code', 'laptop', 'brain', 'mountain', 'waves', 'wind', 'leaf', 'sprout', 'flower-2', 'sun', 'sunrise', 'moon', 'bed', 'alarm-clock', 'timer', 'shower-head', 'bath', 'sparkles', 'smile', 'heart', 'users', 'phone-off', 'smartphone', 'cigarette-off', 'wine-off', 'piggy-bank', 'wallet', 'music', 'guitar', 'palette', 'camera', 'gamepad-2', 'dog', 'cat', 'house', 'briefcase', 'clipboard-list', 'target', 'star', 'zap'];
  const HB_ORDER = [1, 2, 3, 4, 5, 6, 0];   // 月曜はじまり
  const HB_HEAT = 18;                        // カレンダーの週の数
  const OFF_KINDS = ['有給', '祝日', '夏休み', '冬休み', '代休', '休み'];
  const HB_HEAD = ['項目', 'アイコン', '色', '曜日', 'プロパティ', '休みの日', '始めた日'];
  let hbFocus = null, hbMonth = 0, hbWeek = 0;
  let hbCache = { v: -1, d: null };

  // ---------- 読む・書く ----------
  const hbDaysText = days => {
    const s = HB_ORDER.filter(d => days.includes(d));
    if (s.length === 7) return '毎日';
    if (s.join() === '1,2,3,4,5') return '平日';
    if (s.join() === '6,0') return '週末';
    return s.map(d => WD[d]).join('');
  };
  function hbDaysParse(s) {
    s = (s || '').trim();
    if (!s || /毎日/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
    if (/平日/.test(s)) return [1, 2, 3, 4, 5];
    if (/週末|土日/.test(s)) return [0, 6];
    const d = [...new Set([...s].map(c => WD.indexOf(c)).filter(i => i >= 0))];
    return d.length ? d : [0, 1, 2, 3, 4, 5, 6];
  }
  const cellsOf = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  function hbParse(text) {
    const habits = [], off = new Map();
    const L = (text || '').split(/\r?\n/);
    const hi = L.findIndex(l => /^\s*\|/.test(l) && cellsOf(l)[0] === '項目');
    if (hi >= 0) {
      const head = cellsOf(L[hi]), col = n => head.indexOf(n);
      for (let i = hi + 1; i < L.length && /^\s*\|/.test(L[i]); i++) {
        const c = cellsOf(L[i]);
        if (c.every(x => /^:?-+:?$/.test(x)) || !c[0]) continue;
        const g = n => (col(n) >= 0 ? c[col(n)] || '' : '');
        const name = c[0].replace(/\\\|/g, '|');
        const color = /^#[0-9a-f]{3,8}$/i.test(g('色')) ? g('色') : HB_COLORS[habits.length % HB_COLORS.length];
        habits.push({ name, icon: g('アイコン'), color, days: hbDaysParse(g('曜日')), prop: g('プロパティ') || name, keep: /続ける/.test(g('休みの日')), start: /^\d{4}-\d{2}-\d{2}$/.test(g('始めた日')) ? g('始めた日') : null });
      }
    }
    const oi = L.findIndex(l => /^#{1,6}\s+休みの日\s*$/.test(l));
    if (oi >= 0) for (let i = oi + 1; i < L.length && !/^#{1,6}\s/.test(L[i]); i++) {
      const m = L[i].match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:\s*[〜~～]\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/);
      if (!m) continue;
      const to = m[2] && m[2] >= m[1] ? m[2] : m[1];
      for (let k = m[1], n = 0; k <= to && n < 400; k = addDays(k, 1), n++) off.set(k, m[3].trim() || '休み');
    }
    return { habits, off };
  }
  // 続いている同じ種類の休みは1行にまとめる（例：2026-12-29〜2027-01-03 冬休み）
  function offRanges(off) {
    const out = [];
    for (const k of [...off.keys()].sort()) {
      const last = out[out.length - 1];
      if (last && off.get(k) === last.label && addDays(last.to, 1) === k) { last.to = k; last.days.push(k); }
      else out.push({ from: k, to: k, label: off.get(k), days: [k] });
    }
    return out;
  }
  function hbText(text, d) {
    const esc = s => String(s).replace(/\|/g, '\\|');
    const table = [`| ${HB_HEAD.join(' | ')} |`, `|${HB_HEAD.map(() => '---').join('|')}|`,
      ...d.habits.map(h => `| ${[esc(h.name), h.icon || '', h.color, hbDaysText(h.days), esc(h.prop), h.keep ? '続ける' : '休む', h.start || ''].join(' | ')} |`)];
    const offs = offRanges(d.off).map(r => `- ${r.from}${r.to !== r.from ? '〜' + r.to : ''} ${r.label}`);
    if (!text) text = `---\ntags: [習慣]\n---\n# 毎日確認\n\nMD Workstation の「毎日確認」のタブで使う項目です。チェックは、その日のデイリーノートの先頭のプロパティ（例 \`運動: 1\`）に入ります。外すと 0 です。\n\n## 項目\n\n## 休みの日\n`;
    let L = text.split('\n');
    const hi = L.findIndex(l => /^\s*\|/.test(l) && cellsOf(l)[0] === '項目');
    if (hi >= 0) { let e = hi; while (e + 1 < L.length && /^\s*\|/.test(L[e + 1])) e++; L.splice(hi, e - hi + 1, ...table); }
    else {
      let h = L.findIndex(l => /^#{1,6}\s+項目\s*$/.test(l));
      if (h < 0) { L.push('', '## 項目'); h = L.length - 1; }
      L.splice(h + 1, 0, '', ...table);
    }
    let oi = L.findIndex(l => /^#{1,6}\s+休みの日\s*$/.test(l));
    if (oi < 0) { while (L.length && !L[L.length - 1].trim()) L.pop(); L.push('', '## 休みの日'); oi = L.length - 1; }
    let e = oi + 1; while (e < L.length && !/^#{1,6}\s/.test(L[e])) e++;
    L.splice(oi + 1, e - oi - 1, '', ...offs, ...(e < L.length ? [''] : []));
    return L.join('\n').replace(/\n*$/, '\n');
  }
  const hbWrite = (fn, msg) => edit(HB_FILE, t => { const d = hbParse(t || ''); if (fn(d) === false) return null; return hbText(t || '', d); }, msg);

  const HB_YES = /^(1|true|yes|y|x|✓|✔|o|◯|○|はい|済|できた|done)$/i;
  function hbData() {
    if (hbCache.v === filesVersion) return hbCache.d;
    const d = hbParse(S.files[HB_FILE]?.text || '');
    const byProp = new Map();
    for (const h of d.habits) { h.done = new Set(); byProp.set(h.prop, h); }
    if (d.habits.length) for (const [p, f] of Object.entries(S.files)) {
      if (!f.text.startsWith('---')) continue;
      const fm = p.match(/^(\d{4})\/(\d{2})\/(\d{2})\//), day = Daily.dateOf(p, dailyCfg) || (fm ? `${fm[1]}-${fm[2]}-${fm[3]}` : null);
      if (!day) continue;
      const { props } = splitFrontmatter(f.text);
      for (const x of props || []) { const h = byProp.get(x.k); if (h && HB_YES.test((x.v[0] || '').trim())) h.done.add(day); }
    }
    hbCache = { v: filesVersion, d };
    return d;
  }

  // ---------- 集計 ----------
  const hbIsOff = k => hbData().off.has(k);
  const hbDow = k => parseKey(k).getDay();
  const hbSched = (h, k) => h.days.includes(hbDow(k)) && (h.keep || !hbIsOff(k));
  const hbRest = (h, k) => h.days.includes(hbDow(k)) && !h.keep && hbIsOff(k);
  function hbStart(h) { let s = h.start || todayKey(); for (const k of h.done) if (k < s) s = k; return s; }
  function hbStreak(h) {   // 予定のない日（休み）は飛ばす。今日がまだでも切れない
    const tk = todayKey(), st = hbStart(h);
    let n = 0;
    for (let k = tk, i = 0; k >= st && i < 3000; k = addDays(k, -1), i++) {
      if (h.done.has(k)) { n++; continue; }
      if (!hbSched(h, k) || i === 0) continue;
      break;
    }
    return n;
  }
  function hbBest(h) {
    const tk = todayKey(); let best = 0, cur = 0;
    for (let k = hbStart(h), i = 0; k <= tk && i < 3000; k = addDays(k, 1), i++) {
      if (h.done.has(k)) best = Math.max(best, ++cur);
      else if (hbSched(h, k) && k !== tk) cur = 0;
    }
    return best;
  }
  function hbRate30(h) {
    const tk = todayKey(); let from = addDays(tk, -29); const st = hbStart(h); if (st > from) from = st;
    const to = h.done.has(tk) ? tk : addDays(tk, -1);
    let s = 0, dn = 0;
    for (let k = from; k <= to; k = addDays(k, 1)) if (hbSched(h, k)) { s++; if (h.done.has(k)) dn++; }
    return s ? Math.round((dn / s) * 100) : null;
  }
  const hbYm = o => { const t = parseKey(todayKey()); const d = new Date(t.getFullYear(), t.getMonth() + o, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  function hbDay(hs, k, tk) {
    let target = 0, done = 0, extra = 0;
    for (const h of hs) {
      if (k < hbStart(h)) continue;
      const dn = h.done.has(k);
      if (hbSched(h, k)) { if (dn) { target++; done++; } else if (k !== tk) target++; }
      else if (dn) extra++;
    }
    return { target, done, extra };
  }
  function hbMonthStat(hs, ym) {
    const tk = todayKey();
    let target = 0, done = 0, total = 0, perfect = 0, offDays = 0;
    const days = [];
    for (let i = 1; i <= daysIn(ym); i++) {
      const k = `${ym}-${String(i).padStart(2, '0')}`;
      if (hbIsOff(k) && k <= tk) offDays++;
      if (k > tk) { days.push(null); continue; }
      const s = hbDay(hs, k, tk);
      days.push(s);
      target += s.target; done += s.done; total += s.done + s.extra;
      if (s.target > 0 && s.done === s.target) perfect++;
    }
    return { target, done, total, perfect, offDays, days, rate: target ? Math.round((done / target) * 100) : null };
  }
  function hbToday() {
    const d = hbData(), tk = todayKey();
    const list = d.habits.filter(h => hbSched(h, tk) || h.done.has(tk));
    return { list, done: list.filter(h => h.done.has(tk)).length, total: list.length, off: d.off.get(tk) ?? null };
  }

  // ---------- 操作 ----------
  async function hbToggle(h, k) {
    if (k > todayKey()) return;
    const on = !h.done.has(k);
    const ok = await edit(dailyPathOf(k), t => setProp(t == null ? newDailyText(k) : t, h.prop, on ? 1 : 0), `毎日確認: ${h.name}${on ? ' できた' : ' を外す'}（${k}）`);
    if (ok && on && k === todayKey()) { const s = hbToday(); if (s.total && s.done === s.total) toast('今日は全部できました！'); }
  }
  const hbToggleOff = k => hbWrite(d => { if (d.off.has(k)) d.off.delete(k); else d.off.set(k, '休み'); }, `毎日確認：休みの日 ${k}`);

  // ---------- 部品 ----------
  function hbIcon(h, cls = 'hb-icon') {
    const i = el('span', cls);
    const n = (h.icon || '').replace(/^lucide:/, '');
    if (window.ICONS[n]) i.innerHTML = icon(n); else i.textContent = h.icon || h.name.trim()[0] || '•';   // 名前が Lucide にないときは、その文字のまま
    i.style.setProperty('--c', h.color);
    return i;
  }
  const tbtn = (...a) => { const b = btn(...a); if (a[3]) b.title = a[3]; return b; };   // 乗せると説明が出るボタン
  const withIc = (tag, cls, ic, text) => { const e = el(tag, cls); e.innerHTML = icon(ic); e.append(text); return e; };
  function hbVChart(cols, { color, labels }) {
    const wrap = el('div', 'hb-vchart');
    const y = el('div', 'yaxis'), plot = el('div', 'plot');
    plot.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
    for (const p of [0, 50, 100]) { const s = el('span', '', p + '%'); s.style.bottom = p + '%'; y.append(s); if (p) { const g = el('div', 'gl'); g.style.bottom = p + '%'; plot.append(g); } }
    for (const c of cols) {
      const col = el('button', 'hcol' + (c.dim ? ' dim' : '') + (c.rest ? ' rest' : '')); col.type = 'button';
      if (c.onClick) col.addEventListener('click', c.onClick); else col.tabIndex = -1;
      col.title = c.tip; col.style.setProperty('--c', c.color || color);
      if (c.value != null) {
        const bar = el('span', 'hbar' + (c.value === 0 ? ' zero' : '')); bar.style.height = c.value + '%'; col.append(bar);
        if (c.label) { const v = el('span', 'vlabel', c.label); v.style.bottom = c.value + '%'; col.append(v); }
      } else if (c.rest) col.append(el('span', 'restMark', '休'));
      plot.append(col);
    }
    const x = el('div', 'xaxis'); x.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
    labels.forEach(l => x.append(el('span', l.now ? 'now' : '', l.text)));
    wrap.append(y, plot, x);
    return wrap;
  }

  // 今日：リング＋項目の一覧（サイドバー・スマホの上）
  function hbTodayPanel() {
    const d = hbData(), tk = todayKey(), s = hbToday();
    const p = el('section', 'hb-panel hb-today');
    const top = el('div', 'hb-todayTop' + (s.total && s.done === s.total ? ' all' : ''));
    const C = 2 * Math.PI * 27, ring = el('div', 'hb-ring');
    ring.innerHTML = `<svg viewBox="0 0 64 64"><circle class="bgc" cx="32" cy="32" r="27"/><circle class="fgc" cx="32" cy="32" r="27" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - (s.total ? s.done / s.total : 0))}"/></svg>`;
    ring.append(el('b', '', s.total ? `${s.done}/${s.total}` : '—'));
    const tx = el('div', 'hb-todayText');
    tx.append(el('div', 'date', md(tk)),
      s.off != null ? withIc('div', 'msg', 'tree-palm', `今日は${s.off}。「休みの日も続ける」項目だけが予定です`)
        : !s.total ? el('div', 'msg', d.habits.length ? '今日の予定はなし' : '項目を足して始めます')
        : s.done === s.total ? withIc('div', 'msg', 'party-popper', '今日は全部達成！')
        : el('div', 'msg', `あと ${s.total - s.done} つ`));
    top.append(ring, tx);
    p.append(top);
    const ob = tbtn('btn white hb-offBtn', [s.off != null ? 'undo-2' : 'tree-palm', s.off != null ? '休みを取り消す' : '今日を休みにする'], () => hbToggleOff(tk), '休みの日は予定から外れます（達成率や連続日数が下がりません）');
    p.append(ob);
    const list = el('div', 'hb-list');
    if (d.habits.length) {
      const all = el('div', 'hb-row allRow' + (!hbFocus ? ' focused' : ''));
      const an = btn('hb-name', [], () => { hbFocus = null; render(); });
      const ai = el('span', 'hb-icon'); ai.innerHTML = icon('chart-column');
      const at = el('span', 'txt'); at.append(el('span', 'nm', 'すべての項目'), el('small', '', `${d.habits.length}件`));
      an.append(ai, at); all.append(an); list.append(all);
    }
    for (const h of d.habits) {
      const row = el('div', 'hb-row' + (hbFocus === h.name ? ' focused' : ''));
      const done = h.done.has(tk), sc = hbSched(h, tk), rest = hbRest(h, tk);
      const chk = tbtn('hb-chk' + (done ? ' done' : '') + (sc ? '' : ' off'), done ? 'check' : null, () => hbToggle(h, tk),
        done ? '今日のチェックを外す' : sc ? '今日できた！' : rest ? '今日は休み（押すとできたことになる）' : '今日は予定なし（押すとできたことになる）');
      chk.style.setProperty('--c', h.color);
      const nm = btn('hb-name', [], () => { hbFocus = hbFocus === h.name ? null : h.name; render(); }, 'グラフをこの項目に絞り込む');
      const sk = hbStreak(h);
      const t2 = el('span', 'txt');
      t2.append(el('span', 'nm', h.name), sk > 0 ? withIc('small', 'hot', 'flame', `${sk}日連続`) : el('small', '', rest ? '今日は休み' : sc ? '今日の予定' : '今日は予定なし'));
      nm.append(hbIcon(h), t2);
      row.append(chk, nm, btn('hb-edit', 'pencil', () => hbSheet(h), '編集'));
      list.append(row);
    }
    list.append(btn('hb-add', ['plus', '確認項目を追加'], () => hbSheet(null)));
    p.append(list);
    return p;
  }

  function renderHabits(main) {
    const d = hbData();
    const box = el('div', 'hb-view');
    if (!isWide()) box.append(hbTodayPanel());
    if (!d.habits.length) {
      const e = el('div', 'hb-panel hb-empty');
      e.innerHTML = icon('calendar-check');
      e.append(el('b', '', '毎日確認の項目はまだありません'), el('p', '', '「確認項目を追加」から始めます。項目は Notes/毎日確認.md の表に、チェックはその日のデイリーノートのプロパティ（例 運動: 1）に入ります。'));
      e.append(btn('btn primary', ['plus', '確認項目を追加'], () => hbSheet(null)));
      box.append(e); main.append(box); return;
    }
    const f = d.habits.find(h => h.name === hbFocus) || null;
    if (!f) hbFocus = null;
    const hs = f ? [f] : d.habits, ym = hbYm(hbMonth), st = hbMonthStat(hs, ym);
    // 月の切りかえ
    const bar = el('div', 'hb-monthBar');
    const nx = btn('btn white hb-sq', 'chevron-right', () => { if (hbMonth < 0) { hbMonth++; render(); } }, '次の月'); nx.disabled = hbMonth >= 0;
    bar.append(btn('btn white hb-sq', 'chevron-left', () => { hbMonth--; render(); }, '前の月'), el('b', 'hb-month', `${ym.slice(0, 4)}年${+ym.slice(5)}月`), nx);
    if (hbMonth) bar.append(btn('btn white', [], () => { hbMonth = 0; render(); }, '今月に戻る')), bar.lastChild.textContent = '今月に戻る';
    const chip = el('div', 'hb-focusChip' + (f ? '' : ' solo'));
    if (f) { const lab = el('span'); lab.style.setProperty('--c', f.color); lab.append(hbIcon(f, 'hb-miniIcon'), f.name); chip.append(lab, btn('', 'x', () => { hbFocus = null; render(); }, '絞り込みを解除')); }
    else chip.append(withIc('span', '', 'chart-column', 'すべての項目'));
    bar.append(chip, btn('btn white', ['tree-palm', '休みの日'], () => offSheet(), '休みの日を登録する'));
    box.append(bar);
    // 数字
    const prev = hbMonthStat(hs, hbYm(hbMonth - 1)), diff = st.rate != null && prev.rate != null ? st.rate - prev.rate : null;
    const ks = el('div', 'hb-kpis');
    for (const [ic, label, value, note] of [
      ['target', '達成率', st.rate == null ? '—' : st.rate + '%', diff == null ? el('div', 'note', `${st.done} / ${st.target} 回`) : withIc('div', 'note', diff > 0 ? 'trending-up' : diff < 0 ? 'trending-down' : 'minus', `先月比 ${diff > 0 ? '+' : ''}${diff}pt`)],
      ['repeat', '達成回数', st.total + '回', el('div', 'note', `予定 ${st.target} 回`)],
      ['trophy', f ? 'できた日' : '全部できた日', st.perfect + '日', el('div', 'note', '予定がすべて達成できた日')],
      ['tree-palm', '休みの日', st.offDays + '日', el('div', 'note', '予定から外して計算')],
    ]) { const t = el('div', 'hb-kpi'); t.append(withIc('div', 'label', ic, label), el('div', 'value', value), note); ks.append(t); }
    box.append(ks);
    // 日ごとの達成率
    const color = f ? f.color : 'var(--accent)', tk = todayKey();
    const dp = el('section', 'hb-panel'); dp.append(withIc('h3', '', 'chart-column', '日ごとの達成率'));
    const cols = st.days.map((s, i) => {
      const k = `${ym}-${String(i + 1).padStart(2, '0')}`, head = `${+ym.slice(5)}/${i + 1}(${WD[hbDow(k)]})`, ol = hbIsOff(k) ? `\n${d.off.get(k)}（予定から外しています）` : '';
      if (!s) return { value: null, rest: hbIsOff(k), tip: `${head}\nまだ先の日${ol}` };
      if (!s.target) return { value: null, rest: hbIsOff(k), tip: `${head}${ol || '\n予定なし'}${s.extra ? `\n予定外に${s.extra}回できた` : ''}` };
      const v = Math.round((s.done / s.target) * 100);
      return { value: v, rest: hbIsOff(k), tip: `${head}\n${s.done} / ${s.target} できた（${v}%）${s.extra ? `\n＋予定外 ${s.extra}回` : ''}${ol}` };
    });
    const labels = st.days.map((_, i) => { const day = i + 1, now = `${ym}-${String(day).padStart(2, '0')}` === tk; return { text: day === 1 || day % 5 === 0 || now ? String(day) : '', now }; });
    dp.append(st.target || st.total || st.offDays ? hbVChart(cols, { color, labels }) : el('p', 'hb-noData', 'この月の記録はまだありません。'));
    box.append(dp);
    // 項目ごと（絞り込み中は連続記録）＋月ごとの推移
    const cs = el('div', 'hb-cols');
    const lp = el('section', 'hb-panel');
    if (f) { lp.append(withIc('h3', '', 'flame', '連続記録とカレンダー')); hbStreakCard(f, lp); }
    else {
      lp.append(withIc('h3', '', 'chart-bar', '項目ごとの達成率'));
      const hc = el('div', 'hb-hchart');
      for (const h of d.habits) {
        const s = hbMonthStat([h], ym);
        const lb = btn('hl', [], () => { hbFocus = h.name; render(); }, 'この項目に絞り込む'); lb.append(hbIcon(h), el('span', '', h.name));
        const tr = el('div', 'track'), fill = el('span'); fill.style.width = (s.rate || 0) + '%'; fill.style.setProperty('--c', h.color); tr.append(fill);
        tr.title = `${h.name}\n${s.done} / ${s.target} 回できた${s.rate == null ? '' : `（${s.rate}%）`}`;
        const v = el('div', 'hv', s.rate == null ? '—' : s.rate + '%'); v.append(el('small', '', `${s.done}/${s.target}`));
        hc.append(lb, tr, v);
      }
      lp.append(hc);
    }
    const tp = el('section', 'hb-panel');
    const h3 = withIc('h3', '', 'calendar-range', '月ごとの推移'); h3.append(el('span', 'right', '棒を押すとその月へ')); tp.append(h3);
    const end = hbMonth < -11 ? hbMonth : 0, tc = [], tl = [];
    for (let o = end - 11; o <= end; o++) {
      const m2 = hbYm(o), s = hbMonthStat(hs, m2), sel = o === hbMonth;
      tc.push({ value: s.rate, dim: !sel, label: sel && s.rate != null ? s.rate + '%' : '', tip: `${m2.slice(0, 4)}年${+m2.slice(5)}月\n${s.rate == null ? '記録なし' : `達成率 ${s.rate}%（${s.done} / ${s.target} 回）`}${s.offDays ? `\n休み ${s.offDays}日` : ''}`, onClick: () => { hbMonth = o; render(); } });
      tl.push({ text: `${+m2.slice(5)}月`, now: sel });
    }
    tp.append(hbVChart(tc, { color, labels: tl }));
    cs.append(lp, tp);
    box.append(cs, hbWeekPanel());
    if (!f) {
      const g = el('div', 'hb-streaks');
      for (const h of d.habits) { const c = el('section', 'hb-panel'); const hd = el('div', 'hb-statHead'); hd.append(hbIcon(h), el('span', '', h.name)); c.append(hd); hbStreakCard(h, c); g.append(c); }
      box.append(g);
    }
    main.append(box);
  }

  // 週のチェック表（日付を押すとその日を休みに切りかえ）
  function hbWeekPanel() {
    const d = hbData(), tk = todayKey();
    const mon = addDays(addDays(tk, -((hbDow(tk) + 6) % 7)), hbWeek * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    const p = el('section', 'hb-panel');
    const h3 = withIc('h3', '', 'list-checks', '週のチェック表');
    const nav = el('span', 'right hb-weekNav');
    const nx = btn('btn white hb-sq', 'chevron-right', () => { if (hbWeek < 0) { hbWeek++; render(); } }, '次の週'); nx.disabled = hbWeek >= 0;
    nav.append(btn('btn white hb-sq', 'chevron-left', () => { hbWeek--; render(); }, '前の週'), el('span', 'lbl', `${sd(days[0])}〜${sd(days[6])}`), nx);
    if (hbWeek) { const b = btn('btn white', [], () => { hbWeek = 0; render(); }); b.textContent = '今週'; nav.append(b); }
    h3.append(nav); p.append(h3);
    const wrap = el('div', 'hb-gridWrap'), grid = el('div', 'hb-grid');
    grid.append(el('div', 'gh'));
    for (const k of days) {
      const o = d.off.has(k), w = hbDow(k);
      const g = tbtn('gh' + (k === tk ? ' is-today' : '') + (w === 6 ? ' sat' : w === 0 ? ' sun' : '') + (o ? ' rest' : ''), [], () => hbToggleOff(k),
        o ? `${md(k)} は${d.off.get(k)}。押すと休みを取り消します` : `${md(k)}。押すとこの日を休みにします`);
      g.append(el('span', 'wd', WD[w]), el('span', 'md', sd(k)));
      if (o) g.append(el('span', 'restTag', d.off.get(k)));
      grid.append(g);
    }
    grid.append(el('div', 'gh', '週'));
    for (const h of d.habits) {
      const nm = el('div', 'hname' + (hbFocus === h.name ? ' focused' : '')); nm.append(hbIcon(h), el('span', 'nm', h.name)); grid.append(nm);
      let sch = 0, dn = 0;
      for (const k of days) {
        const done = h.done.has(k), sc = hbSched(h, k), fut = k > tk, rest = hbRest(h, k);
        if (sc) sch++; if (done) dn++;
        const c = tbtn('cell' + (done ? ' done' : '') + (sc ? '' : ' off') + (rest ? ' rest' : ''), done ? 'check' : null, () => hbToggle(h, k),
          `${md(k)}\n${fut ? 'まだ先の日' : done ? 'できた' : sc ? 'まだ' : rest ? `${d.off.get(k)}のため予定なし` : '予定なし'}`);
        c.style.setProperty('--c', h.color); c.disabled = fut;
        grid.append(c);
      }
      const r = el('div', 'wrate' + (sch && dn >= sch ? ' full' : ''), `${dn}/${sch}`); r.title = 'この週のできた数 / 予定の数'; grid.append(r);
    }
    wrap.append(grid); p.append(wrap);
    const lg = el('div', 'hb-legend');
    lg.innerHTML = '<span><i class="d"></i>できた</span><span><i></i>まだ</span><span><i class="o"></i>予定のない曜日（押すとできたことになる）</span><span><i class="r"></i>休み（日付を押して切りかえ）</span>';
    p.append(lg);
    return p;
  }
  function hbStreakCard(h, parent) {
    const r = hbRate30(h);
    const nums = el('div', 'hb-nums');
    for (const [v, l] of [[hbStreak(h) + '日', '現在の連続'], [hbBest(h) + '日', '最長の連続'], [r == null ? '—' : r + '%', '直近30日']]) { const n = el('div', 'hnum'); n.append(el('b', '', v), el('span', '', l)); nums.append(n); }
    parent.append(nums);
    const tk = todayKey(), first = addDays(addDays(tk, -((hbDow(tk) + 6) % 7)), -(HB_HEAT - 1) * 7);
    const heat = el('div', 'hb-heat'); heat.style.setProperty('--c', h.color);
    for (let i = 0; i < HB_HEAT * 7; i++) {
      const k = addDays(first, i), fut = k > tk, done = h.done.has(k), sc = hbSched(h, k), rest = hbRest(h, k);
      const b = el('button', fut ? 'fut' : done ? 'on' : rest ? 'rest' : sc ? '' : 'off'); b.type = 'button'; b.tabIndex = -1;
      if (!fut) b.addEventListener('click', () => hbToggle(h, k));
      if (k === tk) b.classList.add('today');
      b.title = `${k.replace(/-/g, '/')}(${WD[hbDow(k)]})\n${done ? 'できた' : sc ? 'まだ' : rest ? hbData().off.get(k) : '予定なし'}`;
      heat.append(b);
    }
    parent.append(heat);
    const lab = el('div', 'hb-heatLabel'); lab.append(el('span', '', first.replace(/-/g, '/')), el('span', '', '今日')); parent.append(lab);
  }

  // ---------- 追加・編集 ----------
  function hbSheet(h) {
    const d = hbData();
    const inn = $('#sheetIn');
    sheetHead(inn, h ? '確認項目を編集' : '確認項目を追加');
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const name = el('input', 'inp'); name.placeholder = '例：運動・読書・水を2L'; name.maxLength = 40; name.value = h?.name || '';
    let ic = h ? h.icon.replace(/^lucide:/, '') : HB_ICONS[d.habits.length % HB_ICONS.length], color = h ? h.color : HB_COLORS[d.habits.length % HB_COLORS.length];
    let days = h ? [...h.days] : [0, 1, 2, 3, 4, 5, 6];
    const icBox = el('div', 'hb-iconPick');
    const drawIc = () => { icBox.style.setProperty('--c', color); icBox.replaceChildren(...HB_ICONS.map(n => { const b = btn(n === ic ? 'on' : '', [n], () => { ic = n; drawIc(); }, n); b.title = n; return b; })); };
    drawIc();
    const sw = el('div', 'swatches');
    const drawSw = () => sw.replaceChildren(...HB_COLORS.map(c => { const b = btn('sw' + (c === color ? ' on' : ''), [], () => { color = c; drawSw(); drawIc(); }, c); b.style.background = c; return b; }));
    drawSw();
    const dw = el('div', 'hb-daysPick');
    const drawDays = () => {
      dw.replaceChildren();
      const pre = el('div', 'hb-presets');
      [['毎日', [0, 1, 2, 3, 4, 5, 6]], ['平日', [1, 2, 3, 4, 5]], ['週末', [0, 6]]].forEach(([l, v]) => { const b = btn(hbDaysText(days) === l ? 'on' : '', [], () => { days = v; drawDays(); }); b.textContent = l; pre.append(b); });
      const wk = el('div', 'hb-wds');
      HB_ORDER.forEach(n => { const b = btn(days.includes(n) ? 'on' : '', [], () => { days = days.includes(n) ? days.filter(x => x !== n) : [...days, n]; if (!days.length) days = [n]; drawDays(); }); b.textContent = WD[n]; wk.append(b); });
      dw.append(pre, wk);
    };
    drawDays();
    const keep = el('input'); keep.type = 'checkbox'; keep.checked = !!h?.keep;
    const kl = el('label', 'hb-keep'); kl.append(keep, '休みの日も続ける（休みでも予定に残す）');
    const prop = el('input', 'inp'); prop.placeholder = '例：exercise（空なら名前と同じ）'; prop.value = h ? h.prop : ''; prop.setAttribute('list', 'hbPropList');
    const dl = el('datalist'); dl.id = 'hbPropList';
    const keys = new Set();
    for (const [p, f] of Object.entries(S.files)) if (Daily.dateOf(p, dailyCfg) && f.text.startsWith('---')) (splitFrontmatter(f.text).props || []).forEach(x => { if (!/^(tags?|aliases|date|project|cssclass)$/i.test(x.k)) keys.add(x.k); });
    [...keys].sort().forEach(k => { const o = el('option'); o.value = k; dl.append(o); });
    inn.append(fld('名前', name));
    const icf = el('div', 'fld'); icf.append(el('span', '', 'アイコン'), icBox); inn.append(icf);
    const cf = el('div', 'fld'); cf.append(el('span', '', '色'), sw); inn.append(cf);
    const df = el('div', 'fld'); df.append(el('span', '', '実施する曜日'), dw); inn.append(df, kl);
    inn.append(fld('今日のノートのプロパティ', prop), dl, el('div', 'hint sub', 'チェックすると、その日のデイリーノートの先頭に「プロパティ: 1」と書きます（外すと 0）。ノートや TEDDY で 1 にしても、チェックが付きます'));
    const bs = el('div', 'shBtns');
    if (h) {
      const i = d.habits.findIndex(x => x.name === h.name);
      if (d.habits.length > 1) {
        const mv = dir => { sheet.close(); hbWrite(dd => { const a = dd.habits.findIndex(x => x.name === h.name), b = a + dir; if (a < 0 || b < 0 || b >= dd.habits.length) return false; [dd.habits[a], dd.habits[b]] = [dd.habits[b], dd.habits[a]]; }, `毎日確認：並び順 ${h.name}`); };
        const up = btn('btn white', ['arrow-up', '上へ'], () => mv(-1)); up.disabled = i === 0;
        const dn = btn('btn white', ['arrow-down', '下へ'], () => mv(1)); dn.disabled = i === d.habits.length - 1;
        bs.append(up, dn);
      }
      let armed = false;
      const del = btn('btn danger', ['trash-2', '削除'], () => {
        if (!armed) { armed = true; del.lastChild.textContent = 'もう一度押すと削除'; return; }
        sheet.close(); if (hbFocus === h.name) hbFocus = null;
        hbWrite(dd => { dd.habits = dd.habits.filter(x => x.name !== h.name); }, `毎日確認：${h.name} を削除`);
        toast(`「${h.name}」を削除しました（ノートのチェックの記録は残っています）`);
      });
      bs.append(del);
    }
    const save = () => {
      const nm = name.value.replace(/\s+/g, ' ').trim();
      if (!nm) { name.focus(); return; }
      if (d.habits.some(x => x.name === nm && x !== h && x.name !== h?.name)) { toast('同じ名前の項目があります', 'warn'); name.focus(); return; }
      const pr = (prop.value.trim() || nm).replace(/[:#\s]/g, '_');
      sheet.close();
      hbWrite(dd => {
        const v = { name: nm, icon: ic || '', color, days: days.slice().sort(), prop: pr, keep: keep.checked };
        if (h) { const x = dd.habits.find(y => y.name === h.name); if (!x) return false; Object.assign(x, v); }
        else dd.habits.push({ ...v, start: todayKey() });
      }, `毎日確認：${h ? '編集' : '追加'} ${nm}`);
      if (hbFocus === h?.name) hbFocus = nm;
    };
    bs.append(btn('btn primary', ['check', h ? '保存' : '追加'], save));
    name.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) save(); });
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => name.focus(), 50);
  }

  // ---------- 休みの日 ----------
  function offSheet() {
    const inn = $('#sheetIn');
    sheetHead(inn, '休みの日');
    const tk = todayKey();
    const from = el('input', 'inp'); from.type = 'date'; from.value = tk;
    const to = el('input', 'inp'); to.type = 'date'; to.value = tk;
    const q = el('div', 'hb-presets');
    [['今日', 0], ['昨日', -1], ['明日', 1]].forEach(([l, n]) => { const b = btn('', [], () => { from.value = to.value = addDays(tk, n); }); b.textContent = l; q.append(b); });
    const lab = el('input', 'inp'); lab.value = '有給'; lab.placeholder = '種類';
    const kinds = el('div', 'hb-presets');
    const mark = () => kinds.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === lab.value));
    OFF_KINDS.forEach(k => { const b = btn('', [], () => { lab.value = k; mark(); }); b.textContent = k; kinds.append(b); });
    lab.addEventListener('input', mark); mark();
    const row = el('div', 'hb-offDates'); row.append(from, el('span', '', '〜'), to);
    const f1 = el('div', 'fld'); f1.append(el('span', '', '日にち'), q, row);
    const f2 = el('div', 'fld'); f2.append(el('span', '', '種類'), kinds, lab);
    inn.append(f1, f2, el('div', 'hint sub', '登録した日は、毎日確認の予定から外れます。達成率や連続日数が下がりません（Notes/毎日確認.md の「休みの日」に書きます）'));
    const list = el('div', 'hb-offList');
    const draw = () => {
      list.replaceChildren(el('p', 'hLbl', '登録済み'));
      const rs = offRanges(hbData().off).reverse();
      if (!rs.length) list.append(el('p', 'hb-noData', 'まだ登録はありません。'));
      for (const r of rs) {
        const rw = el('div', 'hb-offRow');
        rw.append(withIc('span', 'when', 'calendar-days', r.from === r.to ? md(r.from) : `${md(r.from)} 〜 ${md(r.to)}（${r.days.length}日）`), el('span', 'lab', r.label),
          btn('iconBtn', 'x', async () => { await hbWrite(dd => { r.days.forEach(k => dd.off.delete(k)); }, `毎日確認：休みを取り消す ${r.from}`); draw(); }, '取り消す'));
        list.append(rw);
      }
    };
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['plus', '休みとして登録'], async () => {
      const a = from.value, b = to.value && to.value >= from.value ? to.value : from.value;
      if (!a) { from.focus(); return; }
      const l = lab.value.replace(/\s+/g, '').trim() || '休み';
      await hbWrite(dd => { for (let k = a, n = 0; k <= b && n < 400; k = addDays(k, 1), n++) dd.off.set(k, l); }, `毎日確認：休みの日 ${a}${b !== a ? '〜' + b : ''}`);
      draw();
    }));
    inn.append(bs, list);
    draw();
    sheet.showModal();
  }

  // ---------- ホームの「今日の毎日確認」 ----------
  function hbStrip(box) {
    const d = hbData();
    if (!d.habits.length) return null;
    const tk = todayKey(), s = hbToday();
    box.classList.add('hb-strip');
    const head = btn('hb-stripHead', ['calendar-check'], () => switchTab('habits'), '毎日確認を開く');
    head.append(el('span', '', '今日の毎日確認'), el('b', s.total && s.done === s.total ? 'all' : '', s.total ? `${s.done}/${s.total}` : '—'));
    box.append(head);
    if (s.off != null) box.append(withIc('span', 'hb-pill rest', 'tree-palm', `今日は${s.off}`));
    for (const h of s.list) {
      const done = h.done.has(tk);
      const p = btn('hb-pill' + (done ? ' done' : ''), [], () => hbToggle(h, tk), done ? 'チェックを外す' : 'できた！');
      p.style.setProperty('--c', h.color);
      const c = el('span', 'hb-chk' + (done ? ' done' : '')); if (done) c.innerHTML = icon('check');
      const nm = el('span', 'nm'); nm.append(hbIcon(h, 'hb-miniIcon'), h.name);
      p.append(c, nm);
      box.append(p);
    }
    if (!s.list.length && s.off == null) box.append(el('span', 'hb-none', '今日の予定はありません'));
    return box;
  }
