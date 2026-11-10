// ノートのつながり（Obsidian のグラフのように）
// ・カテゴリ（タグ／フォルダ）ごとに大きな玉（ハブ）を置き、そのノートがまわりに集まる
// ・線：ノート → カテゴリの玉、[[リンク]] でつながったノートどうし
// ・canvas に描く。動き（力のつり合い）は requestAnimationFrame で1フレーム1回、止まったら描くのもやめる
// 使い方：const g = NoteGraph.create({ onOpen(path) {} }); host.append(g.el); g.setData(data); g.listInto(el)
(() => {
  window.ICONS = window.ICONS || {};
  window.ICONS.orbit ||= '<circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M10.4 21.9a10 10 0 0 0 9.941-15.416"/><path d="M13.5 2.1a10 10 0 0 0-9.841 15.416"/>';
  window.ICONS.scan ||= '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>';
  const ic = n => (window.svgIcon ? window.svgIcon(n) : '');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // カテゴリの色（暗い背景で光って見える、やわらかい色）
  const COLORS = ['#6ab0de', '#7ccf6a', '#e2c15c', '#a565dc', '#5fd2b5', '#e0605e', '#5a5ad6', '#d8d8d8', '#e89a5c', '#c77fd6'];
  const GRAY = '#6e7075', BG = '#1e1f22', ACCENT = '#a882ff';
  const NONE = '（なし）';

  function create(opts = {}) {
    const root = el('div', 'ng');
    const cv = el('canvas', 'ngCanvas');
    const tip = el('div', 'ngTip'); tip.hidden = true;
    const panel = el('div', 'ngPanel'); panel.hidden = true;
    const bar = el('div', 'ngBar');
    const srchBox = el('div', 'ngSearch');
    const srch = el('input', 'ngSearchInp'); srch.placeholder = 'ノートを探す'; srch.type = 'search';
    srchBox.innerHTML = ic('search'); srchBox.append(srch);
    const listOverlay = el('div', 'ngList');
    root.append(cv, listOverlay, srchBox, tip, panel, bar);
    const ctx = cv.getContext('2d');

    let nodes = [], edges = [], groups = [], byId = new Map(), adj = new Map();
    let W = 0, H = 0, DPR = 1;
    const cam = { x: 0, y: 0, k: 1 };
    let alpha = 0, raf = 0, hover = null, sel = null, selGroup = null, query = '';
    let mode = 'all';   // all（すべて）/ focus（しぼる：選んだものだけ）
    let listHost = null, fitted = false, settled = false, userMoved = false;
    let labels = false;   // 名前をいつも出す

    // ---------- データ ----------
    function setData(d) {
      const old = new Map(nodes.map(n => [n.id, n]));
      let ci = 0;
      groups = d.groups.map(g => ({ ...g, color: g.id === NONE ? GRAY : COLORS[ci++ % COLORS.length] }));
      const gc = new Map(groups.map(g => [g.id, g.color]));
      const R = 140 + groups.length * 22;
      nodes = [];
      groups.forEach((g, i) => {
        const a = (i / Math.max(1, groups.length)) * Math.PI * 2;
        const o = old.get('g:' + g.id);
        nodes.push({ id: 'g:' + g.id, hub: true, group: g.id, name: g.name, color: g.color, count: g.count, r: 4.5 + Math.min(6, Math.sqrt(g.count) * 1.4),
          x: o ? o.x : Math.cos(a) * R, y: o ? o.y : Math.sin(a) * R, vx: 0, vy: 0 });
      });
      const hubPos = new Map(nodes.map(n => [n.group, n]));
      for (const n of d.nodes) {
        const o = old.get(n.id), h = hubPos.get(n.groups[0]);
        nodes.push({ ...n, hub: false, group: n.groups[0], color: gc.get(n.groups[0]) || '#cfd6ff', r: 3.2,
          x: o ? o.x : (h ? h.x : 0) + (Math.random() - .5) * 80, y: o ? o.y : (h ? h.y : 0) + (Math.random() - .5) * 80, vx: 0, vy: 0 });
      }
      byId = new Map(nodes.map(n => [n.id, n]));
      edges = [];
      for (const n of d.nodes) for (const g of n.groups) if (byId.has('g:' + g)) edges.push({ a: byId.get(n.id), b: byId.get('g:' + g), hub: true, primary: g === n.groups[0] });
      const seen = new Set();
      for (const [a, b] of d.links) {
        const k = a < b ? a + '|' + b : b + '|' + a;
        if (a === b || seen.has(k) || !byId.has(a) || !byId.has(b)) continue;
        seen.add(k); edges.push({ a: byId.get(a), b: byId.get(b), hub: false });
      }
      adj = new Map(nodes.map(n => [n.id, new Set()]));
      for (const e of edges) { adj.get(e.a.id).add(e.b.id); adj.get(e.b.id).add(e.a.id); }
      for (const n of nodes) if (!n.hub) n.r = 2.6 + Math.min(4, Math.sqrt(edges.filter(e => !e.hub && (e.a === n || e.b === n)).length) * 1.1);
      if (sel && !byId.has(sel)) sel = null;
      if (selGroup && !groups.some(g => g.id === selGroup)) selGroup = null;
      alpha = old.size ? Math.max(alpha, .35) : 1;
      if (!old.size) { fitted = false; settled = false; userMoved = false; }
      renderList(); renderBar(); renderPanel();
      kick();
    }
    const noteLinks = () => edges.filter(e => !e.hub).length;

    // ---------- 動き（力のつり合い） ----------
    function step() {
      const CELL = 110, grid = new Map();
      for (const n of nodes) { const k = Math.floor(n.x / CELL) + ',' + Math.floor(n.y / CELL); (grid.get(k) || grid.set(k, []).get(k)).push(n); }
      // 近くどうしは離れる（近いマスだけ見る）
      for (const n of nodes) {
        const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const arr = grid.get((cx + i) + ',' + (cy + j)); if (!arr) continue;
          for (const m of arr) {
            if (m === n) continue;
            let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy;
            if (d2 > CELL * CELL) continue;
            if (d2 < .01) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = .25; }
            const s = (n.hub || m.hub ? 900 : 260) / d2 * alpha;
            n.vx += dx * s; n.vy += dy * s;
          }
        }
      }
      // カテゴリの玉どうしは遠くからでも離れる
      const hubs = nodes.filter(n => n.hub);
      for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) {
        const a = hubs[i], b = hubs[j]; const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 1;
        const s = 26000 / d2 * alpha; a.vx += dx * s / Math.sqrt(d2) * 4; a.vy += dy * s / Math.sqrt(d2) * 4; b.vx -= dx * s / Math.sqrt(d2) * 4; b.vy -= dy * s / Math.sqrt(d2) * 4;
      }
      // 線はばね
      for (const e of edges) {
        const L = e.hub ? (e.primary ? 46 + e.b.r * 2 : 150) : 70, K = e.hub ? (e.primary ? .06 : .012) : .03;
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - L) / d * K * alpha;
        const wa = e.a.hub ? .15 : 1, wb = e.b.hub ? .15 : 1;
        e.a.vx += dx * f * wa; e.a.vy += dy * f * wa; e.b.vx -= dx * f * wb; e.b.vy -= dy * f * wb;
      }
      for (const n of nodes) {
        n.vx -= n.x * .004 * alpha; n.vy -= n.y * .004 * alpha;   // まんなかへ少し
        if (n.fixed) { n.vx = n.vy = 0; continue; }
        n.vx *= .6; n.vy *= .6;
        n.x += Math.max(-30, Math.min(30, n.vx)); n.y += Math.max(-30, Math.min(30, n.vy));
      }
      alpha *= .985;
    }

    // ---------- 描く ----------
    const toScreen = (x, y) => [(x - cam.x) * cam.k + W / 2, (y - cam.y) * cam.k + H / 2];
    const toWorld = (sx, sy) => [(sx - W / 2) / cam.k + cam.x, (sy - H / 2) / cam.k + cam.y];
    function lit() {
      // 明るく出すもの：選んだノート・カテゴリと、その近く／検索に合うもの
      if (sel) { const s = new Set([sel, ...adj.get(sel) || []]); return s; }
      if (selGroup) { const s = new Set(['g:' + selGroup]); for (const n of nodes) if (!n.hub && n.groups.includes(selGroup)) { s.add(n.id); for (const m of adj.get(n.id)) if (!byId.get(m).hub) s.add(m); } return s; }
      if (query) { const s = new Set(); for (const n of nodes) if (!n.hub && n.name.toLowerCase().includes(query)) s.add(n.id); return s; }
      if (hover) return new Set([hover.id, ...adj.get(hover.id) || []]);
      return null;
    }
    function draw() {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      const L = lit(), focus = mode === 'focus' && L;
      const hl = !!(hover || sel);   // マウス・選んだ点のつながりは紫の線で
      const sz = Math.max(.75, Math.min(1.8, Math.sqrt(cam.k)));
      // 線
      ctx.lineCap = 'round';
      for (const e of edges) {
        const on = L ? L.has(e.a.id) && L.has(e.b.id) : true;
        if (focus && !on) continue;
        const [x1, y1] = toScreen(e.a.x, e.a.y), [x2, y2] = toScreen(e.b.x, e.b.y);
        if ((x1 < -50 && x2 < -50) || (x1 > W + 50 && x2 > W + 50) || (y1 < -50 && y2 < -50) || (y1 > H + 50 && y2 > H + 50)) continue;
        const key = (hover || byId.get(sel))?.id;
        if (hl && on && key && (e.a.id === key || e.b.id === key)) { ctx.strokeStyle = ACCENT; ctx.globalAlpha = .9; ctx.lineWidth = 1.2; }
        else { ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = (e.hub ? (e.primary ? .14 : .06) : .2) * (L ? (on ? 1.6 : .35) : 1); ctx.lineWidth = .8; }
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // 点
      for (const n of nodes) {
        const on = L ? L.has(n.id) : true;
        if (focus && !on) continue;
        const [x, y] = toScreen(n.x, n.y);
        if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
        const r = n.r * sz;
        ctx.globalAlpha = on ? 1 : .2;
        ctx.fillStyle = n.id === sel || (hover && n.id === hover.id) ? ACCENT : n.color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      // 名前（マウスを乗せた・選んだ・つながり／拡大したとき／ノートが少ないとき）
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = '500 11px system-ui, -apple-system, "Hiragino Sans", sans-serif';
      const fade = labels ? 1 : Math.max(0, Math.min(1, (cam.k - 1.7) / .8));
      for (const n of nodes) {
        const on = L ? L.has(n.id) : true;
        if (focus && !on) continue;
        const strong = (L && on) || nodes.length < 30;
        let a = strong ? .9 : n.hub ? Math.max(fade, .55) : fade * .75;
        if (L && !on) continue;   // 乗せている・選んでいるときは、つながっていない名前は出さない
        if (a < .04) continue;
        const [x, y] = toScreen(n.x, n.y);
        if (x < -100 || x > W + 100 || y < -30 || y > H + 30) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#dcddde';
        const label = n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name;
        ctx.fillText(label, x, y + n.r * sz + 4);
      }
      ctx.globalAlpha = 1;
    }
    function frame() {
      raf = 0;
      if (!root.isConnected) return;   // 画面から外れたら止める
      if (alpha > .02) {
        step();
        if (!fitted && alpha < .5) { fit(false); fitted = true; }
        // 動きが落ち着いたら、もう一度全体が入るように（自分で動かしていなければ）
        if (!settled && alpha < .06) { settled = true; if (!userMoved) fit(true); }
      }
      draw();
      if (alpha > .02 || drag) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function resize() {
      const r = root.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      kick();
    }
    const ro = new ResizeObserver(resize); ro.observe(root);
    function fit(animate = true) {
      const vis = nodes.filter(n => !selGroup || n.group === selGroup || n.id === 'g:' + selGroup);
      if (!vis.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of vis) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      const pad = 90, k = Math.min(2.2, Math.max(.2, Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0))));
      moveCam((x0 + x1) / 2, (y0 + y1) / 2, k, animate);
    }
    let camAnim = 0;
    function moveCam(x, y, k, animate = true) {
      cancelAnimationFrame(camAnim);
      if (!animate) { cam.x = x; cam.y = y; cam.k = k; kick(); return; }
      const s = { ...cam }, t0 = performance.now();
      const tick = t => { const p = Math.min(1, (t - t0) / 380), e = 1 - Math.pow(1 - p, 3); cam.x = s.x + (x - s.x) * e; cam.y = s.y + (y - s.y) * e; cam.k = s.k + (k - s.k) * e; draw(); if (p < 1) camAnim = requestAnimationFrame(tick); };
      camAnim = requestAnimationFrame(tick);
    }

    // ---------- 操作（マウス・指） ----------
    const pts = new Map();
    let drag = null, moved = false, pinch = null, lastTap = 0;
    function pick(sx, sy) {
      const [wx, wy] = toWorld(sx, sy);
      let best = null, bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x - wx, n.y - wy) * cam.k, lim = Math.max(n.r * Math.max(.7, Math.min(1.6, cam.k)) + 6, 14);
        if (d < lim && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e); pts.set(e.pointerId, p);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: cam.k, c: toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; drag = null; return; }
      const n = pick(...p); moved = false;
      drag = n ? { node: n, p } : { pan: true, p, cx: cam.x, cy: cam.y };
      if (n) { n.fixed = true; }
    });
    cv.addEventListener('pointermove', e => {
      const p = pos(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        userMoved = true;
        cam.k = Math.max(.15, Math.min(5, pinch.k * d / pinch.d));
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        cam.x = pinch.c[0] - (m[0] - W / 2) / cam.k; cam.y = pinch.c[1] - (m[1] - H / 2) / cam.k;
        kick(); return;
      }
      if (drag) {
        const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        userMoved = true;
        if (drag.pan) { cam.x = drag.cx - dx / cam.k; cam.y = drag.cy - dy / cam.k; kick(); }
        else { const [wx, wy] = toWorld(...p); drag.node.x = wx; drag.node.y = wy; alpha = Math.max(alpha, .25); kick(); }
        return;
      }
      if (e.pointerType === 'mouse') {
        const n = pick(...p);
        if (n !== hover) { hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; kick(); }

      }
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
      if (!drag) return;
      const d = drag; drag = null;
      if (d.node) d.node.fixed = false;
      if (!moved) {
        const now = Date.now(), dbl = now - lastTap < 320; lastTap = now;
        if (d.node) {
          if (d.node.hub) selectGroup(d.node.group === selGroup && !sel ? null : d.node.group);
          else if (dbl || (sel === d.node.id && e.pointerType !== 'mouse')) opts.onOpen?.(d.node.id);
          else selectNote(d.node.id);
        } else { sel = null; selGroup = null; renderPanel(); renderList(); kick(); }
      }
      kick();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (hover) { hover = null; tip.hidden = true; kick(); } });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      userMoved = true;
      const p = pos(e), [wx, wy] = toWorld(...p);
      cam.k = Math.max(.15, Math.min(5, cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015))));
      cam.x = wx - (p[0] - W / 2) / cam.k; cam.y = wy - (p[1] - H / 2) / cam.k;
      kick();
    }, { passive: false });
    srch.addEventListener('input', () => { query = srch.value.trim().toLowerCase(); sel = null; selGroup = null; renderPanel(); kick(); });
    srch.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const n = nodes.find(x => !x.hub && x.name.toLowerCase().includes(query));
      if (n) { selectNote(n.id); srch.blur(); }
    });

    // ---------- 選ぶ ----------
    function selectGroup(id) {
      sel = null; selGroup = id; query = ''; srch.value = '';
      renderPanel(); renderList(); kick();
      if (id) { const h = byId.get('g:' + id); if (h) setTimeout(() => fit(true)); } else fit(true);
    }
    function selectNote(id) {
      sel = id; selGroup = null;
      const n = byId.get(id);
      renderPanel(); renderList(); kick();
      if (n) moveCam(n.x, n.y, Math.max(cam.k, 1.4));
    }

    // ---------- まわりの部品 ----------
    function renderList() {
      const host = listHost || listOverlay;
      listOverlay.hidden = !!listHost;
      host.innerHTML = '';
      const all = el('button', 'ngItem' + (!selGroup ? ' on' : ''));
      all.type = 'button';
      all.append(el('span', 'nm', 'すべてのノート'), el('small', '', String(nodes.filter(n => !n.hub).length)));
      all.addEventListener('click', () => selectGroup(null));
      host.append(all);
      for (const g of groups) {
        const b = el('button', 'ngItem' + (selGroup === g.id ? ' on' : ''));
        b.type = 'button';
        const dot = el('i', 'dot'); dot.style.background = g.color; 
        b.append(dot, el('span', 'nm', g.name), el('small', '', String(g.count)));
        b.addEventListener('click', () => selectGroup(selGroup === g.id ? null : g.id));
        host.append(b);
      }
    }
    function renderBar() {
      bar.innerHTML = '';
      const seg = el('div', 'ngSeg');
      for (const [k, l, t] of [['all', 'すべて', 'すべてのノートを出す'], ['focus', 'しぼる', '選んだカテゴリ・ノートのつながりだけを出す']]) {
        const b = el('button', mode === k ? 'on' : '', l); b.type = 'button'; b.title = t;
        b.addEventListener('click', () => { mode = k; renderBar(); kick(); });
        seg.append(b);
      }
      const lb = el('button', 'ngLbl2' + (labels ? ' on' : ''), '名前'); lb.type = 'button'; lb.title = 'ノートの名前をいつも出す';
      lb.addEventListener('click', () => { labels = !labels; renderBar(); kick(); });
      const fitB = el('button', 'ngFit'); fitB.type = 'button'; fitB.innerHTML = ic('scan'); fitB.title = '全体を見る';
      fitB.addEventListener('click', () => fit(true));
      bar.append(seg, lb, el('span', 'ngCount', `${nodes.filter(n => !n.hub).length} ノート・${noteLinks()} リンク`), fitB);
    }
    function noteRow(n, sub) {
      const r = el('button', 'ngRow'); r.type = 'button';
      const dot = el('i', 'dot'); dot.style.background = n.color;
      r.append(dot, el('span', 'nm', n.name));
      if (sub) r.append(el('small', '', sub));
      r.addEventListener('click', () => selectNote(n.id));
      r.addEventListener('dblclick', () => opts.onOpen?.(n.id));
      return r;
    }
    function renderPanel() {
      panel.innerHTML = '';
      const head = (color, kind, close = true) => {
        const h = el('div', 'ngPHead');
        const dot = el('i', 'dot'); dot.style.background = color; 
        h.append(dot, el('span', 'kind', kind));
        if (close) { const x = el('button', 'ngClose', '閉じる'); x.type = 'button'; x.addEventListener('click', () => { sel = null; selGroup = null; renderPanel(); renderList(); kick(); }); h.append(x); }
        return h;
      };
      const stat = (a, b) => { const s = el('div', 'ngStats'); for (const [l, v] of [a, b]) { const c = el('div'); c.append(el('small', '', l), el('b', '', String(v))); s.append(c); } return s; };
      if (selGroup) {
        const g = groups.find(x => x.id === selGroup); if (!g) { panel.hidden = true; return; }
        const mine = nodes.filter(n => !n.hub && n.groups.includes(g.id));
        const ids = new Set(mine.map(n => n.id));
        const links = edges.filter(e => !e.hub && (ids.has(e.a.id) || ids.has(e.b.id))).length;
        panel.append(head(g.color, 'カテゴリ'), el('h3', '', g.name), el('p', 'ngSub', `${mine.length} 件のノート`), stat(['ノート', mine.length], ['リンク', links]));
        panel.append(el('p', 'ngLbl', 'ノート（つながりの多い順）'));
        const ls = el('div', 'ngRows');
        mine.sort((a, b) => adj.get(b.id).size - adj.get(a.id).size || a.name.localeCompare(b.name, 'ja')).slice(0, 30).forEach(n => ls.append(noteRow(n, n.day || '')));
        panel.append(ls);
        panel.hidden = false;
      } else if (sel && byId.get(sel)) {
        const n = byId.get(sel);
        const nb = [...adj.get(n.id)].map(id => byId.get(id)).filter(x => !x.hub);
        panel.append(head(n.color, 'ノート'), el('h3', '', n.name), el('p', 'ngSub', [n.folder || 'いちばん上', n.day].filter(Boolean).join('・')));
        const tg = el('div', 'ngTags');
        n.groups.forEach(id => { const g = groups.find(x => x.id === id); if (!g) return; const t = el('button', 'ngTag', g.name); t.type = 'button'; t.style.setProperty('--c', g.color); t.addEventListener('click', () => selectGroup(g.id)); tg.append(t); });
        panel.append(tg, stat(['リンク', nb.length], ['カテゴリ', n.groups.filter(x => x !== NONE).length]));
        if (nb.length) { panel.append(el('p', 'ngLbl', 'つながっているノート')); const ls = el('div', 'ngRows'); nb.slice(0, 30).forEach(m => ls.append(noteRow(m))); panel.append(ls); }
        const ob = el('button', 'ngOpen'); ob.type = 'button'; ob.innerHTML = ic('file-text'); ob.append('ノートを開く');
        ob.addEventListener('click', () => opts.onOpen?.(n.id));
        panel.append(ob);
        panel.hidden = false;
      } else panel.hidden = true;
    }

    return {
      el: root, setData, fit: () => fit(true),
      listInto(h) { listHost = h; renderList(); },
      stats: () => ({ notes: nodes.filter(n => !n.hub).length, links: noteLinks(), groups: groups.length }),
      redraw: kick,
    };
  }
  window.NoteGraph = { create, NONE };
})();
