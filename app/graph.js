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
  const COLORS = ['#ff8fd0', '#9aa8ff', '#7fe3ff', '#b58cff', '#7ff0c0', '#ffc27a', '#ff9a8a', '#c6f07a', '#8fd0ff', '#f0a8ff'];
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
    let mode = 'glow';   // soft（やわらか）/ glow（光る）/ focus（しぼる：選んだものだけ）
    let listHost = null, fitted = false, settled = false, userMoved = false;
    const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + .2, a: Math.random() * .5 + .1 }));
    const sprites = new Map();

    // ---------- データ ----------
    function setData(d) {
      const old = new Map(nodes.map(n => [n.id, n]));
      groups = d.groups.map((g, i) => ({ ...g, color: COLORS[i % COLORS.length] }));
      const gc = new Map(groups.map(g => [g.id, g.color]));
      const R = 140 + groups.length * 22;
      nodes = [];
      groups.forEach((g, i) => {
        const a = (i / Math.max(1, groups.length)) * Math.PI * 2;
        const o = old.get('g:' + g.id);
        nodes.push({ id: 'g:' + g.id, hub: true, group: g.id, name: g.name, color: g.color, count: g.count, r: 9 + Math.sqrt(g.count) * 3.2,
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
      for (const n of nodes) if (!n.hub) n.r = 3 + Math.min(4, Math.sqrt(edges.filter(e => !e.hub && (e.a === n || e.b === n)).length) * 1.2);
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
    function sprite(color) {
      if (sprites.has(color)) return sprites.get(color);
      const s = el('canvas'); s.width = s.height = 64; const c = s.getContext('2d');
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, color); g.addColorStop(.25, color + 'aa'); g.addColorStop(1, color + '00');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64); sprites.set(color, s); return s;
    }
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
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .75);
      bg.addColorStop(0, '#141a3e'); bg.addColorStop(1, '#05060f');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      for (const s of stars) { ctx.globalAlpha = s.a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      const L = lit(), focus = mode === 'focus' && L;
      const glow = mode === 'soft' ? .45 : 1;
      // カテゴリのまわりの星雲
      ctx.globalCompositeOperation = 'lighter';
      for (const n of nodes) if (n.hub) {
        if (focus && !L.has(n.id)) continue;
        const [x, y] = toScreen(n.x, n.y), r = (90 + Math.sqrt(n.count) * 26) * cam.k;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, n.color + (L && !L.has(n.id) ? '0c' : mode === 'soft' ? '18' : '2c')); g.addColorStop(1, n.color + '00');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      // 線
      ctx.lineCap = 'round';
      for (const e of edges) {
        const on = L ? L.has(e.a.id) && L.has(e.b.id) : true;
        if (focus && !on) continue;
        const [x1, y1] = toScreen(e.a.x, e.a.y), [x2, y2] = toScreen(e.b.x, e.b.y);
        if ((x1 < -50 && x2 < -50) || (x1 > W + 50 && x2 > W + 50) || (y1 < -50 && y2 < -50) || (y1 > H + 50 && y2 > H + 50)) continue;
        ctx.strokeStyle = e.hub ? (e.b.color || '#fff') : '#ffffff';
        ctx.globalAlpha = (e.hub ? (e.primary ? .22 : .08) : .42) * (L ? (on ? 2 : .25) : 1);
        ctx.lineWidth = e.hub ? .8 : 1.1;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // 点
      for (const n of nodes) {
        const on = L ? L.has(n.id) : true;
        if (focus && !on) continue;
        const [x, y] = toScreen(n.x, n.y);
        if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
        const r = n.r * Math.max(.7, Math.min(1.6, cam.k));
        ctx.globalAlpha = on ? 1 : .22;
        const gs = r * (n.hub ? 4.2 : 3.6) * glow;
        ctx.drawImage(sprite(n.color), x - gs, y - gs, gs * 2, gs * 2);
        ctx.fillStyle = n.hub ? '#ffffff' : n.color;
        ctx.beginPath(); ctx.arc(x, y, n.hub ? r * .62 : r * .7, 0, 7); ctx.fill();
        if (n.hub) {
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
          ctx.globalAlpha = (on ? .55 : .15); ctx.beginPath(); ctx.arc(x, y, r * 1.05, 0, 7); ctx.stroke();
          ctx.globalAlpha = (on ? .25 : .08); ctx.beginPath(); ctx.arc(x, y, r * 1.45, 0, 7); ctx.stroke();
        }
        if (n.id === sel || (hover && n.id === hover.id)) { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); }
      }
      ctx.globalCompositeOperation = 'source-over';
      // 名前
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const n of nodes) {
        const on = L ? L.has(n.id) : true;
        if (focus && !on) continue;
        const show = n.hub || (L && on) || cam.k > 1.35 || nodes.length < 45;
        if (!show) continue;
        const [x, y] = toScreen(n.x, n.y);
        if (x < -100 || x > W + 100 || y < -40 || y > H + 40) continue;
        const r = n.r * Math.max(.7, Math.min(1.6, cam.k));
        ctx.font = n.hub ? '600 13px system-ui, -apple-system, "Hiragino Sans", sans-serif' : '500 11px system-ui, -apple-system, "Hiragino Sans", sans-serif';
        ctx.globalAlpha = on ? (n.hub ? .95 : .78) : .3;
        ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 4;
        ctx.fillStyle = '#fff';
        const label = n.hub && n.name.length > 18 ? n.name.slice(0, 17) + '…' : !n.hub && n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name;
        ctx.fillText(label, x, y + r + (n.hub ? 8 : 4));
        ctx.shadowBlur = 0;
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
        if (n) { tip.hidden = false; tip.textContent = n.hub ? `${n.name}（${n.count}件）` : n.name; tip.style.left = p[0] + 14 + 'px'; tip.style.top = p[1] + 14 + 'px'; } else tip.hidden = true;
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
        const dot = el('i', 'dot'); dot.style.background = g.color; dot.style.boxShadow = `0 0 8px ${g.color}`;
        b.append(dot, el('span', 'nm', g.name), el('small', '', String(g.count)));
        b.addEventListener('click', () => selectGroup(selGroup === g.id ? null : g.id));
        host.append(b);
      }
    }
    function renderBar() {
      bar.innerHTML = '';
      const seg = el('div', 'ngSeg');
      for (const [k, l] of [['soft', 'やわらか'], ['glow', '光る'], ['focus', 'しぼる']]) {
        const b = el('button', mode === k ? 'on' : '', l); b.type = 'button';
        b.title = k === 'focus' ? '選んだカテゴリ・ノートのつながりだけを出す' : '';
        b.addEventListener('click', () => { mode = k; renderBar(); kick(); });
        seg.append(b);
      }
      const fitB = el('button', 'ngFit'); fitB.type = 'button'; fitB.innerHTML = ic('scan'); fitB.title = '全体を見る';
      fitB.addEventListener('click', () => fit(true));
      bar.append(seg, el('span', 'ngCount', `${nodes.filter(n => !n.hub).length} ノート・${noteLinks()} リンク`), fitB);
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
        const dot = el('i', 'dot'); dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}`;
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
