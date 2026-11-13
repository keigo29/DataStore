  // ================= ヘルス（体重・睡眠・歩数・筋トレ） =================
  // 読むもの：
  //   Data/health/health.csv  … iPhone のヘルスケア（ショートカット → Cmd の Actions が作る）。date,weight_kg,body_fat_pct,sleep_min,steps,resting_hr,active_kcal
  //   Data/kintore/sets.csv   … 筋トレメモの全セット（date,start,session_id,exercise,muscle_group,kind,weight_kg,reps,e1rm_kg,volume_kg …）
  //   デイリーノートの「- 体重 70.5kg」「- 体脂肪 18%」の行（ヘルスケアにない日をうめる）
  //   目標：ノートの先頭の goal_weight: 67・goal_due: 2027-02-28、または本文の「目標：67kg（2027-02-28）」
  let healthRange = 30;          // 見る日数（0 は全部）
  const HC = { weight: '#38bdf8', avg: '#a78bfa', sleep: '#818cf8', steps: '#4ade80', lift: '#fb923c', goal: '#f472b6' };

  // CSV を読む（"..." の中のカンマ・改行もそのまま）
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x !== '')) rows.push(row);
    const head = (rows.shift() || []).map(h => h.trim());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

  let healthCache = { key: null, v: null };
  function healthData() {
    const hcsv = S.cfg?.['Data/health/health.csv'] || '', scsv = S.cfg?.['Data/kintore/sets.csv'] || '', zcsv = S.cfg?.['Data/health/sleep.csv'] || '';
    const key = hcsv.length + ':' + scsv.length + ':' + zcsv.length + ':' + hcsv.slice(-80) + scsv.slice(-80) + zcsv.slice(-60) + ':' + filesVersion;
    if (healthCache.key === key) return healthCache.v;
    // 日ごとの体の数字
    const days = new Map();
    const put = (d, k, v) => { if (v == null || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return; const o = days.get(d) || { date: d }; if (o[k] == null) o[k] = v; days.set(d, o); };
    for (const r of parseCSV(hcsv)) {
      put(r.date, 'weight', num(r.weight_kg)); put(r.date, 'fat', num(r.body_fat_pct));
      put(r.date, 'sleep', num(r.sleep_min) ?? (num(r.sleep_h) != null ? num(r.sleep_h) * 60 : null));
      put(r.date, 'steps', num(r.steps)); put(r.date, 'rhr', num(r.resting_hr)); put(r.date, 'kcal', num(r.active_kcal));
      put(r.date, 'deep', num(r.sleep_deep_min)); put(r.date, 'core', num(r.sleep_core_min)); put(r.date, 'rem', num(r.sleep_rem_min)); put(r.date, 'awake', num(r.sleep_awake_min));
      if (/^\d{1,2}:\d{2}$/.test(r.bed_time || '')) put(r.date, 'bed', r.bed_time.padStart(5, '0'));
      if (/^\d{1,2}:\d{2}$/.test(r.wake_time || '')) put(r.date, 'wake', r.wake_time.padStart(5, '0'));
    }
    // デイリーノートの「- 体重 70.5kg」
    for (const [p, f] of Object.entries(S.files)) {
      if (!/体重|体脂肪/.test(f.text)) continue;
      const d = Daily.dateOf(p, dailyCfg);   // デイリーノートだけ（調べもののノートの「体重 70kg の人は…」は数えない）
      if (!d) continue;
      for (const m of f.text.matchAll(/^\s*[-*]\s+体重\s*[:：]?\s*(\d{2,3}(?:\.\d+)?)\s*kg/gim)) put(d, 'weight', +m[1]);
      for (const m of f.text.matchAll(/^\s*[-*]\s+体脂肪率?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)\s*%/gim)) put(d, 'fat', +m[1]);
    }
    const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    // 筋トレ（セッションごと）
    const ses = new Map();
    for (const r of parseCSV(scsv)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      const id = r.session_id || r.date + r.start;
      const s = ses.get(id) || { id, date: r.date, start: r.start || '', volume: 0, sets: 0, ex: new Map(), groups: new Set() };
      if (r.kind && !/normal|本番/.test(r.kind)) { ses.set(id, s); continue; }   // ウォームアップは数えない
      s.sets++; s.volume += num(r.volume_kg) || 0;
      if (r.muscle_group) s.groups.add(r.muscle_group);
      const e = s.ex.get(r.exercise) || { name: r.exercise, group: r.muscle_group, best: 0, e1rm: 0, reps: 0 };
      e.best = Math.max(e.best, num(r.weight_kg) || 0); e.e1rm = Math.max(e.e1rm, num(r.e1rm_kg) || 0); e.reps += num(r.reps) || 0;
      s.ex.set(r.exercise, e); ses.set(id, s);
    }
    const sessions = [...ses.values()].filter(s => s.sets).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    // 1晩の流れ（何時から何時までがどの段階か）
    const segs = new Map();
    const tmin = t => { const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 60000 : null; };
    for (const r of parseCSV(zcsv)) {
      const a = tmin(r.start), b = tmin(r.end);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || a == null || b == null || b <= a || !['deep', 'core', 'rem', 'awake', 'asleep'].includes(r.stage)) continue;
      const l = segs.get(r.date) || []; l.push({ a, b, st: r.stage }); segs.set(r.date, l);
    }
    for (const l of segs.values()) l.sort((x, y) => x.a - y.a);
    const v = { segs, days: list, sessions, goal: weightGoal(), hasHealth: !!hcsv.trim(), hasLift: !!scsv.trim() };
    healthCache = { key, v };
    return v;
  }
  // 減量の目標
  function weightGoal() {
    for (const [p, f] of Object.entries(S.files)) {
      const { props } = splitFrontmatter(f.text);
      const get = k => (props || []).find(x => x.k.toLowerCase() === k)?.v[0];
      const w = num(get('goal_weight') || get('目標体重'));
      if (w) { const due = get('goal_due') || get('due'); return { weight: w, due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : null, path: p }; }
    }
    for (const [p, f] of Object.entries(S.files)) {
      if (!/減量|ダイエット|体重/.test(p)) continue;
      const m = f.text.match(/目標[^\n：:]*[：:]\s*\**\s*(\d{2,3}(?:\.\d+)?)\s*kg\s*[（(]\s*(\d{4}-\d{2}-\d{2})/);
      if (m) return { weight: +m[1], due: m[2], path: p };
    }
    return null;
  }
  // 7日の平均（その日までの7日で、記録のある日）
  function avg7(list, k, date) {
    const from = addDays(date, -6);
    const v = list.filter(x => x.date >= from && x.date <= date && x[k] != null).map(x => x[k]);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  const kg = n => n == null ? '—' : n.toFixed(1);
  const hm = m => m == null ? '—' : `${Math.floor(m / 60)}時間${String(Math.round(m % 60)).padStart(2, '0')}分`;

  // 体重のグラフ：日ごとの点・7日平均の線・目標の線。押す・乗せると、その日の数字
  function weightChart(pts, goal) {
    const W = 600, H = 220, n = pts.length;
    const vals = pts.flatMap(p => [p.weight, p.avg]).filter(v => v != null);
    if (goal) vals.push(goal.weight);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max(0.4, (hi - lo) * 0.12); lo -= pad; hi += pad;
    const X = i => (n < 2 ? W / 2 : (i / (n - 1)) * W), Y = v => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 22);
    const avgPts = pts.map((p, i) => p.avg != null ? [X(i), Y(p.avg)] : null).filter(Boolean);
    const id = 'wg' + ++svgId;
    const box = el('div', 'fBig hW');
    const ticks = [0.25, 0.5, 0.75].map(r => lo + (hi - lo) * (1 - r));
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HC.avg}" stop-opacity=".28"/><stop offset="1" stop-color="${HC.avg}" stop-opacity="0"/></linearGradient></defs>
      <g class="fGrid">${ticks.map(t => `<line x1="0" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/>`).join('')}</g>
      ${goal ? `<line class="hGoalLine" x1="0" x2="${W}" y1="${Y(goal.weight)}" y2="${Y(goal.weight)}" stroke="${HC.goal}" vector-effect="non-scaling-stroke"/>` : ''}
      ${avgPts.length > 1 ? `<path d="${smoothPath(avgPts)} L${avgPts[avgPts.length - 1][0]},${H} L${avgPts[0][0]},${H} Z" fill="url(#${id})"/><path d="${smoothPath(avgPts)}" fill="none" stroke="${HC.avg}" stroke-width="2.4" vector-effect="non-scaling-stroke" class="fGlow" style="--g:${HC.avg}"/>` : ''}
    </svg>`;
    // 点は丸のまま見せたいので、SVG の上に重ねる
    const dots = el('div', 'hDots');
    pts.forEach((p, i) => { if (p.weight == null) return; const d = el('i'); d.style.left = (X(i) / W) * 100 + '%'; d.style.top = (Y(p.weight) / H) * 100 + '%'; dots.append(d); });
    box.append(dots);
    if (goal) { const g = el('span', 'hGoalTag', `目標 ${kg(goal.weight)}kg`); g.style.top = (Y(goal.weight) / H) * 100 + '%'; box.append(g); }
    const ax = el('div', 'hAxis'); ticks.forEach(t => { const s = el('span', '', t.toFixed(1)); s.style.top = (Y(t) / H) * 100 + '%'; ax.append(s); }); box.append(ax);
    const tip = el('div', 'fTip'); tip.hidden = true;
    const vl = el('i', 'fVline'); vl.hidden = true;
    box.append(vl, tip);
    let raf = 0, lastX = 0;
    const at = () => {
      raf = 0;
      const r = box.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((lastX - r.left) / r.width) * (n - 1))));
      const p = pts[i], px = (X(i) / W) * r.width, v = p.weight ?? p.avg;
      if (v == null) return;
      const py = (Y(v) / H) * r.height;
      tip.hidden = vl.hidden = false;
      vl.style.left = px + 'px'; vl.style.top = py + 'px';
      tip.textContent = `${md(p.date)}  ${p.weight != null ? kg(p.weight) + 'kg' : '記録なし'}${p.avg != null ? `（平均 ${kg(p.avg)}）` : ''}`;
      tip.style.left = Math.max(80, Math.min(r.width - 80, px)) + 'px'; tip.style.top = Math.max(0, py - 40) + 'px';
    };
    const move = e => { lastX = e.clientX; if (!raf) raf = requestAnimationFrame(at); };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerdown', move);
    box.addEventListener('pointerleave', () => { tip.hidden = vl.hidden = true; });
    return box;
  }
  // 棒のグラフ（睡眠・歩数・週の挙上量）
  function bars(vals, labels, color, fmt, goalLine) {
    const TH = 84;   // 棒の高さ（px）
    const box = el('div', 'hBars');
    const max = Math.max(1, goalLine || 0, ...vals.map(v => v || 0)) * 1.08;
    const every = Math.ceil(vals.length / 7);
    vals.forEach((v, i) => {
      const c = el('div', 'hBar' + (v == null ? ' none' : ''));
      c.title = `${labels[i]}  ${v == null ? '記録なし' : fmt(v)}`;
      const t = el('span', 't'); const b2 = el('i'); b2.style.height = v == null ? '3px' : Math.max(3, (v / max) * TH) + 'px'; b2.style.setProperty('--g', color); t.append(b2);
      c.append(t, el('small', '', (vals.length - 1 - i) % every === 0 ? labels[i] : ''));
      box.append(c);
    });
    if (goalLine) { const g = el('span', 'hBarGoal'); g.style.bottom = `calc(18px + ${(goalLine / max) * TH}px)`; g.title = '目安 ' + fmt(goalLine); box.append(g); }
    return box;
  }

  function renderHealth(main) {
    const H = healthData(), tk = todayKey();
    const wrap = el('div', 'fin hl');
    const bar = el('div', 'fBar');
    const seg = el('div', 'seg hSeg');
    [[30, '30日'], [90, '90日'], [0, '全部']].forEach(([v, l]) => seg.append(btn(healthRange === v ? 'on' : '', l, () => { healthRange = v; render(); })));
    bar.append(seg, btn('btn small white', ['scale', '体重を書く'], () => weightSheet()));
    const lastH = H.days.length ? H.days[H.days.length - 1].date : '';
    if (lastH) bar.append(el('span', 'fSub fLast', `体の記録：${md(lastH)} まで`));
    wrap.append(bar);
    if (!H.days.length && !H.sessions.length) {
      const c = el('div', 'fCard fEmptyCard');
      c.append(el('h3', '', '体の記録がまだありません'));
      c.insertAdjacentHTML('beforeend', '<p class="fSub">デイリーノートに <code>- 体重 70.5kg</code> と書くか、上の「体重を書く」で入れます。iPhone のヘルスケアの数字は <code>Data/health/health.csv</code>、筋トレメモの記録は <code>Data/kintore/sets.csv</code> から読みます。</p>');
      wrap.append(c); main.append(wrap); return;
    }
    const from = healthRange ? addDays(tk, -(healthRange - 1)) : (H.days[0]?.date || tk);
    const range = []; for (let k = from; k <= tk; k = addDays(k, 1)) range.push(k);
    const byDate = new Map(H.days.map(d => [d.date, d]));
    const wdays = H.days.filter(d => d.weight != null);
    const lastW = wdays[wdays.length - 1];
    const curAvg = lastW ? avg7(H.days, 'weight', lastW.date) : null, weekAgo = lastW ? avg7(H.days, 'weight', addDays(lastW.date, -7)) : null;
    const goal = H.goal;

    // 上の数字のカード
    const kpi = (title, sub, big, unit, color, vals, delta, fromZero = true) => {
      const c = el('div', 'fCard fKpi'); c.style.setProperty('--k', color);
      c.append(el('h3', '', title), el('p', 'fSub', sub));
      const v = el('div', 'fVal'); v.append(big); if (unit) v.append(el('small', '', ' ' + unit)); c.append(v);
      if (delta) c.append(delta);
      const ok = vals.filter(x => x != null);
      if (new Set(ok.map(x => x.toFixed(2))).size > 1) { const sp = el('div', 'fSpk'); sp.innerHTML = spark(ok, color, 120, 56, fromZero); c.append(sp); }
      return c;
    };
    const dl = (txt, good) => { const s = el('span', 'fDelta'); if (txt) s.append(el('b', good == null ? '' : good ? 'g' : 'r', txt[0]), txt[1]); return s; };
    const last14 = Array.from({ length: 14 }, (_, i) => addDays(tk, i - 13));
    const ks = el('div', 'fKpis hKpis');
    const wd = curAvg != null && weekAgo != null ? curAvg - weekAgo : null;
    ks.append(kpi('体重', lastW ? `7日平均（${sd(lastW.date)} は ${kg(lastW.weight)}kg）` : 'まだ記録がありません', kg(curAvg), 'kg', HC.weight,
      range.map(k => avg7(H.days, 'weight', k)), wd == null ? null : dl([`${wd > 0 ? '+' : wd < 0 ? '−' : '±'}${Math.abs(wd).toFixed(2)}kg`, ' 1週間で'], wd <= 0), false));
    if (goal) {
      const rest = curAvg != null ? curAvg - goal.weight : null;
      let sub = `目標 ${kg(goal.weight)}kg${goal.due ? `・${sd(goal.due)} まで` : ''}`, d2 = null;
      if (rest != null && goal.due) {
        const weeks = Math.max(0.1, (parseKey(goal.due) - parseKey(tk)) / 864e5 / 7), need = rest / weeks;
        d2 = rest <= 0 ? dl(['達成', ' おめでとう'], true) : dl([`週 ${need.toFixed(2)}kg`, ` 落とせば間に合う${wd != null ? `（いまは週 ${(-wd).toFixed(2)}kg）` : ''}`], wd != null ? -wd >= need * 0.9 : null);
      }
      ks.append(kpi('目標まで', sub, rest == null ? '—' : rest <= 0 ? '0.0' : kg(rest), 'kg', HC.goal, [], d2));
    }
    const sl = last14.map(k => byDate.get(k)?.sleep ?? null), sAvg = avg7(H.days, 'sleep', tk);   // 睡眠のカード（くわしくは下の「睡眠の質」）
    ks.append(kpi('睡眠', '7日平均', sAvg == null ? '—' : `${Math.floor(sAvg / 60)}:${String(Math.round(sAvg % 60)).padStart(2, '0')}`, sAvg == null ? '' : '時間', HC.sleep, sl, sAvg == null ? dl(['', 'ヘルスケアから入ります'], null) : dl([sAvg >= 420 ? 'よく寝ています' : '7時間より短め', ''], sAvg >= 420)));
    const st = last14.map(k => byDate.get(k)?.steps ?? null), stAvg = avg7(H.days, 'steps', tk);
    ks.append(kpi('歩数', '7日平均', stAvg == null ? '—' : Math.round(stAvg).toLocaleString('ja-JP'), stAvg == null ? '' : '歩', HC.steps, st, stAvg == null ? dl(['', 'ヘルスケアから入ります'], null) : null));
    const wk0 = addDays(tk, -((parseKey(tk).getDay() + 6) % 7));   // 今週の月曜
    const thisWeek = H.sessions.filter(s => s.date >= wk0);
    const wkVol = Array.from({ length: 8 }, (_, i) => { const a = addDays(wk0, (i - 7) * 7), b = addDays(a, 6); return H.sessions.filter(s => s.date >= a && s.date <= b).reduce((x, s) => x + s.volume, 0); });
    ks.append(kpi('筋トレ', '今週（月曜から）', String(thisWeek.length), '回', HC.lift, wkVol,
      dl([`${Math.round(thisWeek.reduce((a, s) => a + s.volume, 0)).toLocaleString('ja-JP')}kg`, ' 今週の総挙上量'], null)));
    wrap.append(ks);

    // 体重の流れ ＋ 体の数字
    const row = el('div', 'fRow');
    const ch = el('div', 'fCard fChart');
    ch.append(el('h3', '', '体重の流れ'), el('p', 'fSub', '点：その日の体重・線：7日平均' + (goal ? '・ピンク：目標' : '')));
    const pts = range.map(k => ({ date: k, weight: byDate.get(k)?.weight ?? null, avg: avg7(H.days, 'weight', k) }));
    ch.append(pts.some(p => p.weight != null) ? weightChart(pts, goal) : el('div', 'fEmpty', 'この期間の体重はまだありません。デイリーノートに「- 体重 70.5kg」と書くと出ます'));
    const inR = wdays.filter(d => d.date >= from);
    const ft = el('div', 'fFoot');
    const f1 = el('div'); f1.append(el('small', '', 'この期間'), el('b', '', inR.length > 1 ? `${(inR[inR.length - 1].weight - inR[0].weight > 0 ? '+' : '')}${(inR[inR.length - 1].weight - inR[0].weight).toFixed(1)}kg` : '—'));
    const f2 = el('div', 'r'); f2.append(el('small', '', '記録した日'), el('span', '', `${inR.length}日 / ${range.length}日`));
    ft.append(f1, f2); ch.append(ft);
    row.append(ch);
    const side = el('div', 'fCard hSide');
    side.append(el('h3', '', '歩数と体の数字'), el('p', 'fSub', '直近14日（ヘルスケアから）'));
    if (st.some(v => v != null)) {
      side.append(bars(st, last14.map(sd), HC.steps, v => Math.round(v).toLocaleString('ja-JP') + '歩', 8000));
    } else {
      side.append(el('div', 'fEmpty', 'まだありません。iPhone のショートカットで毎朝ヘルスケアの数字を送ると入ります'));
      const hn = Object.keys(S.files).find(p => nameOf(p) === 'ヘルスケア連携');
      if (hn) side.append(btn('btn small white', ['book-open', '作り方を見る'], () => openNote(hn)));
    }
    const rows2 = [['安静時心拍', 'rhr', 'bpm'], ['体脂肪率', 'fat', '%'], ['活動カロリー', 'kcal', 'kcal']];
    const mini = el('div', 'hMini');
    for (const [l, k, u] of rows2) { const a = avg7(H.days, k, tk); if (a == null) continue; const d = el('div'); d.append(el('small', '', l), el('b', '', `${k === 'fat' ? a.toFixed(1) : Math.round(a).toLocaleString('ja-JP')} ${u}`)); mini.append(d); }
    if (mini.childElementCount) side.append(mini);
    row.append(side);
    wrap.append(row);

    // 睡眠の質（大きいグラフ）
    wrap.append(sleepCard(H, range));

    // 筋トレ：種目ごとの重さ ＋ 週の挙上量
    if (H.sessions.length) {
      const row2 = el('div', 'fRow');
      const lc = el('div', 'fCard fCats');
      lc.append(el('h3', '', '種目ごとの重さ'), el('p', 'fSub', '推定1RM の流れ（減量中も重さを落とさない）'));
      const byEx = new Map();
      for (const s of H.sessions) for (const e of s.ex.values()) { const a = byEx.get(e.name) || { name: e.name, group: e.group, list: [] }; a.list.push({ date: s.date, best: e.best, e1rm: e.e1rm, reps: e.reps }); byEx.set(e.name, a); }
      const top = [...byEx.values()].sort((a, b) => b.list.length - a.list.length).slice(0, 6);
      for (const e of top) {
        const r = el('div', 'fCat');
        const ic = el('span', 'fIc', (e.group || e.name).slice(0, 1)); ic.style.background = HC.lift;
        const lst = e.list[e.list.length - 1], prev = e.list[e.list.length - 2];
        const key = lst.e1rm || lst.best ? 'e1rm' : 'reps';
        const val = x => (key === 'e1rm' ? x.e1rm || x.best : x.reps);
        const diff = prev ? val(lst) - val(prev) : 0;
        const nm = el('span', 'fNm');
        nm.append(el('b', '', e.name), el('small', '', key === 'e1rm' ? `${sd(lst.date)}・最高 ${lst.best}kg・1RM ${(lst.e1rm || lst.best).toFixed(1)}kg${prev ? `（${diff >= 0 ? '+' : ''}${diff.toFixed(1)}）` : ''}` : `${sd(lst.date)}・${lst.reps}回（自重）${prev ? `（${diff >= 0 ? '+' : ''}${diff}）` : ''}`));
        const sp = el('span', 'fCs'); sp.innerHTML = spark(e.list.map(val), HC.lift, 90, 26, false);
        r.append(ic, nm, sp); lc.append(r);
      }
      row2.append(lc);
      const vc = el('div', 'fCard hSide');
      vc.append(el('h3', '', '週ごとの総挙上量'), el('p', 'fSub', '直近8週（本番セットの 重さ×回数）'));
      vc.append(bars(wkVol, Array.from({ length: 8 }, (_, i) => sd(addDays(wk0, (i - 7) * 7))), HC.lift, v => Math.round(v).toLocaleString('ja-JP') + 'kg'));
      const cnt = Array.from({ length: 8 }, (_, i) => { const a = addDays(wk0, (i - 7) * 7), b = addDays(a, 6); return H.sessions.filter(s => s.date >= a && s.date <= b).length; });
      const ft2 = el('div', 'fFoot'); const a1 = el('div'); a1.append(el('small', '', '8週の回数'), el('b', '', `${cnt.reduce((a, b) => a + b, 0)}回`));
      const a2 = el('div', 'r'); a2.append(el('small', '', '1週あたり'), el('span', '', `${(cnt.reduce((a, b) => a + b, 0) / 8).toFixed(1)}回`));
      ft2.append(a1, a2); vc.append(ft2);
      row2.append(vc);
      wrap.append(row2);

      // 最近のトレーニング
      const lc2 = el('div', 'fCard fList');
      const lh = el('div', 'fHead'); lh.append(el('h3', '', '最近のトレーニング'));
      const kn = Object.keys(S.files).find(p => nameOf(p) === '筋トレの記録');
      if (kn) lh.append(btn('btn small white', ['book-open', '筋トレの記録'], () => openNote(kn)));
      lc2.append(lh);
      for (const s of H.sessions.slice(-8).reverse()) {
        const np = Object.keys(S.files).find(p => p.startsWith(s.date.replace(/-/g, '/') + '/') && /筋トレ/.test(nameOf(p)));
        const r = el(np ? 'button' : 'div', 'fRec');
        if (np) { r.type = 'button'; r.addEventListener('click', () => openNote(np)); }
        const ic = el('span', 'fIc sm', [...s.groups][0]?.slice(0, 1) || '筋'); ic.style.background = HC.lift;
        const nm = el('span', 'fRn'); nm.append(el('b', '', [...s.ex.keys()].join('・')), el('small', '', [md(s.date), s.start, `${s.sets}セット`, [...s.groups].join('・')].filter(Boolean).join('・')));
        r.append(ic, nm, el('span', 'fRa', `${Math.round(s.volume).toLocaleString('ja-JP')}kg`));
        lc2.append(r);
      }
      wrap.append(lc2);
    }
    main.append(wrap);
  }

  // 体重を今日のデイリーノートの「メモ」に書く（- 体重 70.5kg [[減量]]）
  function weightSheet() {
    const inn = $('#sheetIn');
    sheetHead(inn, '体重を書く');
    const tk = todayKey();
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    const w = el('input', 'inp'); w.inputMode = 'decimal'; w.placeholder = '例：70.5';
    const lastW = healthData().days.filter(d => d.weight != null).pop();
    if (lastW) w.placeholder = `例：${kg(lastW.weight)}（${sd(lastW.date)}）`;
    const ft = el('input', 'inp'); ft.inputMode = 'decimal'; ft.placeholder = 'なくても可';
    const goal = healthData().goal;
    inn.append(fld('体重（kg）', w), fld('体脂肪率（%）', ft), el('div', 'hint sub', `${relDay(tk)}のデイリーノートの「メモ」に書きます`));
    const bs = el('div', 'shBtns');
    const save = async () => {
      const v = parseFloat(w.value.replace(/[^\d.]/g, ''));
      if (!(v > 20 && v < 300)) { w.focus(); return; }
      const f = parseFloat(ft.value.replace(/[^\d.]/g, ''));
      const link = goal ? ` [[${nameOf(goal.path)}]]` : '';
      const lines = [`- 体重 ${v}kg${link}`]; if (f > 0 && f < 70) lines.push(`- 体脂肪 ${f}%`);
      sheet.close();
      const rel = dailyPathOf(tk);
      const ok = await edit(rel, t => addToMemo(t == null ? newDailyText(tk) : t, lines), `体重: ${v}kg`);
      if (ok) toast(`${relDay(tk)}のノートに体重を書きました`);
    };
    bs.append(btn('btn primary', ['check', '書く'], save));
    [w, ft].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) save(); }));
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => w.focus(), 50);
  }
  // 「## メモ」の見出しのすぐ下に入れる。もう同じ日に体重があれば、その行を書きかえる
  function addToMemo(text, lines) {
    const L = text.split('\n');
    const wi = L.findIndex(l => /^\s*[-*]\s+体重\s*[:：]?\s*\d/.test(l));
    if (wi >= 0) { L.splice(wi, 1, lines[0]); const fi = L.findIndex(l => /^\s*[-*]\s+体脂肪/.test(l)); if (lines[1]) { if (fi >= 0) L.splice(fi, 1, lines[1]); else L.splice(wi + 1, 0, lines[1]); } return L.join('\n'); }
    const h = L.findIndex(l => /^#{1,6}\s+メモ\s*$/.test(l));
    if (h < 0) return text.replace(/\n*$/, '') + '\n\n## メモ\n' + lines.join('\n') + '\n';
    let at = h + 1;
    if (L[at] != null && /^\s*-\s*$/.test(L[at])) L.splice(at, 1);   // テンプレートの空の「- 」
    L.splice(at, 0, ...lines);
    return L.join('\n');
  }

  // ================= 睡眠の質 =================
  // 1晩の点数（目安・100点）：長さ 40・深い睡眠 20・レム 20・途中で起きた時間 10・寝る時刻のそろい方 10
  // 内訳（深い・コア・レム）がない日は点数を出さない（長さだけでは「質」がわからないので）
  let sleepView = null;          // night：1晩の流れ／line：1日ごとの線／parts：積み上げの棒／time：寝た〜起きた時刻（null：流れがあれば night）
  let sleepSel = null;           // 選んだ日
  const SC = { deep: '#4f46e5', core: '#60a5fa', rem: '#22d3ee', awake: '#fb923c', plain: '#818cf8' };
  const SN = { deep: '深い', core: 'ノンレム（浅い）', rem: 'レム', awake: '途中で起きた' };
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromEve = t => (toMin(t) - 18 * 60 + 1440) % 1440;     // 夕方6時からの分（夜をまたいでも順になる）
  const clock = m => { const x = (m + 18 * 60) % 1440; return `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`; };
  const hmS = m => m == null ? '—' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  function sleepNight(H, d) {
    const o = H.days.find(x => x.date === d);
    if (!o || (o.sleep == null && o.deep == null && o.bed == null)) return null;
    const hasParts = o.deep != null || o.rem != null || o.core != null;
    const asleep = hasParts ? (o.deep || 0) + (o.core || 0) + (o.rem || 0) : o.sleep;
    return { date: d, asleep, deep: o.deep, core: o.core, rem: o.rem, awake: o.awake, bed: o.bed, wake: o.wake, hasParts };
  }
  function sleepScore(n, prevBeds) {
    if (!n || !n.hasParts || !n.asleep) return null;
    const r = [];
    const dur = n.asleep;
    const pDur = dur >= 420 && dur <= 540 ? 40 : dur < 420 ? Math.max(0, 40 * (dur - 300) / 120) : Math.max(25, 40 - (dur - 540) / 6);   // 5時間で0・7〜9時間で満点
    r.push(['長さ', pDur, 40, dur >= 420 ? '7時間以上' : `7時間まで あと ${hmS(420 - dur)}`]);
    const dp = (n.deep || 0) / dur * 100, rp = (n.rem || 0) / dur * 100;
    const pDeep = Math.max(0, Math.min(20, (dp - 5) / 10 * 20)), pRem = Math.max(0, Math.min(20, (rp - 10) / 10 * 20));   // 深い 15%・レム 20% で満点
    r.push(['深い睡眠', pDeep, 20, `${dp.toFixed(0)}%（目安 15〜25%）`]);
    r.push(['レム睡眠', pRem, 20, `${rp.toFixed(0)}%（目安 20〜25%）`]);
    const aw = n.awake ?? 0, pAw = aw <= 10 ? 10 : Math.max(0, 10 - (aw - 10) / 5);   // 10分まで満点・60分で0
    r.push(['途中で起きた', pAw, 10, `${Math.round(aw)}分`]);
    let pReg = 10, regTxt = 'くらべる日がまだない';
    if (n.bed && prevBeds.length >= 2) {
      const avgB = prevBeds.reduce((a, b) => a + b, 0) / prevBeds.length, diff = Math.abs(fromEve(n.bed) - avgB);
      pReg = diff <= 30 ? 10 : Math.max(0, 10 - (diff - 30) / 9); regTxt = `いつもより ${Math.round(diff)}分 ${fromEve(n.bed) > avgB ? 'おそい' : 'はやい'}`;
    } else if (!n.bed) regTxt = '寝た時刻がない';
    r.push(['寝る時刻', pReg, 10, regTxt]);
    return { total: Math.round(r.reduce((a, x) => a + x[1], 0)), parts: r };
  }
  function sleepCard(H, range) {
    const c = el('div', 'fCard sCard');
    const view = sleepView || (H.segs.size ? 'night' : 'line');
    const nights = range.map(d => sleepNight(H, d));
    const beds = [];   // その日より前の7晩の寝た時刻
    const scored = nights.map((n, i) => {
      const prev = nights.slice(Math.max(0, i - 7), i).filter(x => x && x.bed).map(x => fromEve(x.bed));
      return n ? { ...n, score: sleepScore(n, prev) } : null;
    });
    const ok = scored.filter(Boolean);
    const hd = el('div', 'fHead');
    hd.append(el('h3', '', '睡眠の質'));
    const seg = el('div', 'seg hSeg');
    [...(H.segs.size ? [['night', '1晩']] : []), ['line', '線'], ['parts', '積み上げ'], ['time', '時間帯']].forEach(([v, l]) => seg.append(btn(view === v ? 'on' : '', l, () => { sleepView = v; render(); })));
    hd.append(seg); c.append(hd);
    if (!ok.length) {
      c.append(el('p', 'fSub', 'その朝に起きた日に入ります'), el('div', 'fEmpty', 'まだ睡眠の記録がありません。iPhone のショートカットで、睡眠の合計・内訳（深い・コア・レム・覚醒）・寝た時刻と起きた時刻を送ると、ここに大きく出ます'));
      const hn = Object.keys(S.files).find(p => nameOf(p) === 'ヘルスケア連携');
      if (hn) c.append(btn('btn small white', ['book-open', '作り方を見る'], () => openNote(hn)));
      return c;
    }
    // まとめの数字
    const avgOf = f => { const v = ok.map(f).filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const withP = ok.filter(n => n.hasParts && n.asleep);
    const bedsM = ok.filter(n => n.bed).map(n => fromEve(n.bed)), wakesM = ok.filter(n => n.wake).map(n => fromEve(n.wake));
    const sd2 = a => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    const stats = el('div', 'sStats');
    const st = (label, val, note, color) => { const d = el('div', 'sStat'); if (color) d.style.setProperty('--c', color); d.append(el('small', '', label), el('b', '', val)); if (note) d.append(el('span', '', note)); stats.append(d); };
    const sc = avgOf(n => n.score?.total);
    if (sc != null) st('点数（平均）', `${Math.round(sc)}点`, '目安・100点', sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444');
    st('睡眠（平均）', hmS(avgOf(n => n.asleep)), `${ok.filter(n => n.asleep >= 420).length}/${ok.length}晩が7時間以上`);
    if (withP.length) {
      st('深い睡眠', `${(avgOf(n => n.hasParts ? (n.deep || 0) / n.asleep * 100 : null)).toFixed(0)}%`, `平均 ${hmS(avgOf(n => n.hasParts ? n.deep : null))}`, SC.deep);
      st('レム睡眠', `${(avgOf(n => n.hasParts ? (n.rem || 0) / n.asleep * 100 : null)).toFixed(0)}%`, `平均 ${hmS(avgOf(n => n.hasParts ? n.rem : null))}`, SC.rem);
      st('途中で起きた', `${Math.round(avgOf(n => n.awake) || 0)}分`, '1晩の平均', SC.awake);
    }
    if (bedsM.length) st('寝た時刻', clock(bedsM.reduce((a, b) => a + b, 0) / bedsM.length), sd2(bedsM) != null ? `ばらつき ±${Math.round(sd2(bedsM))}分` : '平均');
    if (wakesM.length) st('起きた時刻', clock(wakesM.reduce((a, b) => a + b, 0) / wakesM.length), sd2(wakesM) != null ? `ばらつき ±${Math.round(sd2(wakesM))}分` : '平均');
    c.append(stats);
    // 凡例
    const lg = el('div', 'sLegend');
    if (view !== 'time') {
      if (withP.length) ['deep', 'core', 'rem', 'awake'].forEach(k => { const s2 = el('span'); s2.style.setProperty('--c', SC[k]); s2.append(SN[k]); lg.append(s2); });
      else { const s2 = el('span'); s2.style.setProperty('--c', SC.plain); s2.append('睡眠（内訳はまだありません）'); lg.append(s2); }
      lg.append(el('em', '', view === 'night' ? '1晩の流れ（‹ › で日を変える）' : view === 'parts' ? '点線：7時間' : '点：その日の数字（押すとくわしく）'));
    } else lg.append(el('em', '', '棒：寝た時刻 〜 起きた時刻（上がよる、下があさ）'));
    c.append(lg);
    let sel = (sleepSel && scored.find(n => n && n.date === sleepSel)) || [...scored].reverse().find(Boolean);
    if (view === 'night') {   // 流れのある晩だけ（期間の外でもよい）
      const ds = [...H.segs.keys()].sort(), d = sleepSel && H.segs.has(sleepSel) ? sleepSel : sel && H.segs.has(sel.date) ? sel.date : ds[ds.length - 1];
      sel = scored.find(n => n && n.date === d) || { ...(sleepNight(H, d) || { date: d, asleep: H.segs.get(d).filter(x => x.st !== 'awake').reduce((t, x) => t + x.b - x.a, 0) }), score: null };
    }
    c.append(view === 'night' ? sleepHypno(H, sel) : view === 'line' ? sleepLineChart(scored, sel) : view === 'parts' ? sleepPartsChart(scored, sel) : sleepTimeChart(scored, sel));
    c.append(sleepDetail(sel));
    return c;
  }
  // 1晩の流れ：横が時刻、段が 覚醒・レム・ノンレム（浅い）・深い（ヘルスケアアプリの睡眠のグラフと同じ見方）
  function sleepHypno(H, n) {
    const box = el('div', 'sHypWrap');
    const ds = [...H.segs.keys()].sort(), i = ds.indexOf(n.date), segs = H.segs.get(n.date);
    const nav = el('div', 'sNav');
    const go = d => { sleepSel = d; render(); };
    const pb = btn('sNavB', '‹', () => go(ds[i - 1]), '前の晩'), nb = btn('sNavB', '›', () => go(ds[i + 1]), '次の晩');
    pb.disabled = i <= 0; nb.disabled = i >= ds.length - 1;
    const ttl = el('div', 'sNavT'); ttl.append(el('b', '', hm(n.asleep)), el('span', '', `${md(n.date)} の朝`));
    nav.append(pb, ttl, nb); box.append(nav);
    const ROW = { awake: 0, rem: 1, core: 2, asleep: 2, deep: 3 }, RH = 58;
    const t0 = Math.floor(segs[0].a / 60) * 60, t1 = Math.ceil(Math.max(...segs.map(x => x.b)) / 60) * 60, span = t1 - t0 || 60;
    const pc = t => ((t - t0) / span) * 100 + '%';
    const plot = el('div', 'sHyp'); plot.style.height = RH * 4 + 'px';
    ['awake', 'rem', 'core', 'deep'].forEach((k, r) => { const row = el('div', 'sHRow'); row.append(el('span', '', k === 'awake' ? '覚醒' : SN[k])); row.style.top = r * RH + 'px'; row.style.height = RH + 'px'; plot.append(row); });
    const step = span > 600 ? 180 : span > 300 ? 120 : 60, tfmt = t => { const d = new Date(t * 60000); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const ax = el('div', 'sHAx');
    for (let t = t0; t <= t1; t += step) { const g = el('i', 'sHG'); g.style.left = pc(t); plot.append(g); const l = el('span', '', tfmt(t)); l.style.left = pc(t); ax.append(l); }
    // 段をつなぐ細い線（先に置いて、ブロックの下にする）
    segs.forEach((x, j) => {
      const y = segs[j + 1]; if (!y || y.a - x.b > 5 || ROW[x.st] === ROW[y.st]) return;
      const r1 = Math.min(ROW[x.st], ROW[y.st]), r2 = Math.max(ROW[x.st], ROW[y.st]);
      const c = el('i', 'sHC'); c.style.left = pc(x.b); c.style.top = r1 * RH + RH / 2 + 'px'; c.style.height = (r2 - r1) * RH + 'px'; plot.append(c);
    });
    for (const x of segs) {
      const b = el('i', 'sSeg'); b.style.left = pc(x.a); b.style.width = `max(3px, ${((x.b - x.a) / span) * 100}%)`; b.style.top = ROW[x.st] * RH + 9 + 'px'; b.style.height = RH - 18 + 'px';
      b.style.background = SC[x.st] || SC.plain;
      b.title = `${x.st === 'awake' ? '覚醒' : SN[x.st] || '睡眠'}  ${tfmt(x.a)}〜${tfmt(x.b)}（${Math.round(x.b - x.a)}分）`;
      plot.append(b);
    }
    box.append(plot, ax);
    return box;
  }
  // 線：1日ごとに 深い・ノンレム（浅い）・レム・途中で起きた を線でつなぐ（体重のグラフと同じ見方）
  function sleepLineChart(ns, sel) {
    const box = el('div', 'sChart');
    const n = ns.length, W = 600, HH = 300;
    const anyParts = ns.some(x => x && x.hasParts);
    const keys = anyParts ? ['core', 'rem', 'deep', 'awake'] : ['plain'];
    const val = (x, k) => !x ? null : k === 'plain' ? x.asleep : x.hasParts ? (x[k] ?? null) : null;
    const all = ns.flatMap(x => keys.map(k => val(x, k))).filter(v => v != null);
    const max = Math.max(60, ...all) * 1.1;
    const X = i => ((i + 0.5) / n) * W, Y = v => HH - (v / max) * HH;
    const plot = el('div', 'sPlot line');
    const step = max > 300 ? 120 : 60;
    for (let m = step; m < max; m += step) { const g = el('span', 'sGuide'); g.style.bottom = (m / max) * 100 + '%'; g.dataset.t = `${m / 60}時間`; plot.append(g); }
    let svg = `<svg viewBox="0 0 ${W} ${HH}" preserveAspectRatio="none" aria-hidden="true">`;
    const dots = el('div', 'sDots');
    for (const k of keys) {
      const pts = ns.map((x, i) => (val(x, k) != null ? [X(i), Y(val(x, k))] : null)).filter(Boolean);
      if (pts.length > 1) svg += `<path class="sL fGlow" d="${smoothPath(pts)}" fill="none" stroke="${SC[k]}" stroke-width="2.4" vector-effect="non-scaling-stroke" style="--g:${SC[k]}"/>`;
      if (n <= 45 || pts.length === 1) pts.forEach(([x, y]) => { const d = el('i'); d.style.left = (x / W) * 100 + '%'; d.style.top = (y / HH) * 100 + '%'; d.style.setProperty('--c', SC[k]); dots.append(d); });
    }
    plot.innerHTML += svg + '</svg>';
    plot.append(dots);
    const vl = el('i', 'sVl'); vl.hidden = true;
    const selI = sel ? ns.findIndex(x => x && x.date === sel.date) : -1;
    if (selI >= 0) { const sv = el('i', 'sVl on'); sv.style.left = (X(selI) / W) * 100 + '%'; plot.append(sv); }
    const tip = el('div', 'fTip sTip'); tip.hidden = true;
    plot.append(vl, tip);
    let raf = 0, lastX = 0;
    const idx = () => { const r = plot.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor(((lastX - r.left) / r.width) * n))); };
    const at = () => {
      raf = 0;
      const r = plot.getBoundingClientRect(), i = idx(), x = ns[i];
      if (!x) { tip.hidden = vl.hidden = true; return; }
      const px = (X(i) / W) * r.width;
      tip.hidden = vl.hidden = false;
      vl.style.left = px + 'px';
      tip.textContent = `${md(x.date)}  ` + (x.hasParts ? ['deep', 'core', 'rem', 'awake'].map(k => `${SN[k]} ${hmS(x[k] ?? 0)}`).join('・') : `睡眠 ${hmS(x.asleep)}`);
      const half = tip.offsetWidth / 2 + 4;
      tip.style.left = Math.max(half, Math.min(r.width - half, px)) + 'px'; tip.style.top = '0px';
    };
    plot.addEventListener('pointermove', e => { lastX = e.clientX; if (!raf) raf = requestAnimationFrame(at); });
    plot.addEventListener('pointerleave', () => { tip.hidden = vl.hidden = true; });
    plot.addEventListener('click', e => { lastX = e.clientX; const x = ns[idx()]; if (x) { sleepSel = x.date; render(); } });
    box.append(plot, sleepAxis(ns));
    return box;
  }
  // 内訳：積み上げの棒（下から 深い・コア・レム、いちばん上に 途中で起きた）
  function sleepPartsChart(ns, sel) {
    const box = el('div', 'sChart');
    const max = Math.max(540, ...ns.filter(Boolean).map(n => n.asleep + (n.awake || 0))) * 1.05;
    const plot = el('div', 'sPlot');
    [360, 420, 480].forEach(m => { const g = el('span', 'sGuide' + (m === 420 ? ' main' : '')); g.style.bottom = (m / max) * 100 + '%'; g.dataset.t = `${m / 60}時間`; plot.append(g); });
    const bw = ns.length > 45 ? ' thin' : '';
    ns.forEach((n, i) => {
      const col = el('button', 'sCol' + bw + (n && sel && n.date === sel.date ? ' sel' : '')); col.type = 'button';
      if (n) {
        col.addEventListener('click', () => { sleepSel = n.date; render(); });
        col.title = `${md(n.date)}  ${hmS(n.asleep)}${n.score ? `・${n.score.total}点` : ''}`;
        const stack = el('span', 'sStack'); stack.style.height = ((n.asleep + (n.awake || 0)) / max) * 100 + '%';
        const segs = n.hasParts ? [['awake', n.awake], ['rem', n.rem], ['core', n.core], ['deep', n.deep]] : [['plain', n.asleep]];
        const tot = n.asleep + (n.awake || 0);
        for (const [k, v] of segs) { if (!v) continue; const s2 = el('i'); s2.style.flexGrow = v / tot; s2.style.background = SC[k]; stack.append(s2); }
        col.append(stack);
        if (n.score && ns.length <= 31) col.append(el('b', 'sScore' + (n.score.total >= 80 ? ' g' : n.score.total < 60 ? ' r' : ''), String(n.score.total)));
      } else col.disabled = true;
      plot.append(col);
    });
    box.append(plot, sleepAxis(ns));
    return box;
  }
  // 時間帯：寝た時刻 〜 起きた時刻の棒
  function sleepTimeChart(ns, sel) {
    const box = el('div', 'sChart');
    const has = ns.filter(n => n && n.bed && n.wake);
    if (!has.length) { box.append(el('div', 'fEmpty', '寝た時刻と起きた時刻がまだありません（ショートカットで bed_time・wake_time を送ると出ます）')); return box; }
    let lo = Math.min(...has.map(n => fromEve(n.bed))), hi = Math.max(...has.map(n => fromEve(n.wake)));
    lo = Math.floor((lo - 30) / 60) * 60; hi = Math.ceil((hi + 30) / 60) * 60;
    const span = hi - lo || 60;
    const plot = el('div', 'sPlot time');
    for (let m = lo; m <= hi; m += 60) { if ((m - lo) % (span > 720 ? 120 : 60)) continue; const g = el('span', 'sGuide' + (clock(m) === '0:00' ? ' main' : '')); g.style.top = ((m - lo) / span) * 100 + '%'; g.dataset.t = clock(m); plot.append(g); }
    const bw = ns.length > 45 ? ' thin' : '';
    ns.forEach(n => {
      const col = el('button', 'sCol' + bw + (n && sel && n.date === sel.date ? ' sel' : '')); col.type = 'button';
      if (n && n.bed && n.wake) {
        col.addEventListener('click', () => { sleepSel = n.date; render(); });
        col.title = `${md(n.date)}  ${n.bed} 〜 ${n.wake}`;
        let a = fromEve(n.bed), b = fromEve(n.wake); if (b < a) b = a;
        const bar = el('span', 'sRange'); bar.style.top = ((a - lo) / span) * 100 + '%'; bar.style.height = Math.max(2, ((b - a) / span) * 100) + '%';
        bar.style.background = `linear-gradient(${SC.plain}, ${SC.deep})`;
        col.append(bar);
      } else col.disabled = !n;
      plot.append(col);
    });
    box.append(plot, sleepAxis(ns));
    return box;
  }
  function sleepAxis(ns) {
    const ax = el('div', 'sAxis'), every = Math.ceil(ns.length / (isWide() ? 8 : 5));
    const range = ns.map((n, i) => n?.date);
    const first = ns.findIndex(Boolean);
    ns.forEach((n, i) => ax.append(el('span', '', (ns.length - 1 - i) % every === 0 ? sd(range[i] || addDays(ns[first]?.date || todayKey(), i - first)) : '')));
    return ax;
  }
  // 選んだ晩のくわしい中身
  function sleepDetail(n) {
    const d = el('div', 'sDetail');
    if (!n) return d;
    const hd = el('div', 'sDHd');
    hd.append(el('b', '', `${md(n.date)} の朝`), el('span', 'fSub', [n.bed && n.wake ? `${n.bed} に寝て ${n.wake} に起きた` : '', `眠っていた時間 ${hm(n.asleep)}`].filter(Boolean).join('・')));
    if (n.score) { const s2 = el('span', 'sBig' + (n.score.total >= 80 ? ' g' : n.score.total < 60 ? ' r' : ''), String(n.score.total)); s2.append(el('small', '', '点')); hd.prepend(s2); }
    d.append(hd);
    if (n.hasParts) {
      const tot = n.asleep + (n.awake || 0);
      const bar = el('div', 'sBar');
      ['deep', 'core', 'rem', 'awake'].forEach(k => { if (!n[k]) return; const s2 = el('i'); s2.style.flexGrow = n[k] / tot; s2.style.background = SC[k]; s2.title = `${SN[k]} ${hmS(n[k])}`; bar.append(s2); });
      d.append(bar);
      const ls = el('div', 'sParts');
      ['deep', 'core', 'rem', 'awake'].forEach(k => { const x = el('div'); x.style.setProperty('--c', SC[k]); x.append(el('small', '', SN[k]), el('b', '', hmS(n[k] ?? 0)), el('span', '', k === 'awake' ? '' : `${((n[k] || 0) / n.asleep * 100).toFixed(0)}%`)); ls.append(x); });
      d.append(ls);
    } else d.append(el('p', 'fSub', '内訳（深い・コア・レム）がないので、点数は出していません'));
    if (n.score) {
      const sp = el('div', 'sWhy');
      n.score.parts.forEach(([l, p, mx, note]) => { const r = el('div'); const m = el('span', 'm'); const f = el('i'); f.style.width = (p / mx) * 100 + '%'; m.append(f); r.append(el('small', '', l), m, el('b', '', `${Math.round(p)}/${mx}`), el('span', 'n', note)); sp.append(r); });
      d.append(sp, el('p', 'sNote', '点数はこのアプリの目安です（長さ40・深い20・レム20・途中で起きた10・寝る時刻のそろい方10）。ウォッチの測り方で数字は変わります'));
    }
    return d;
  }
