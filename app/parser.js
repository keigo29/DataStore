// Markdown → やること（- [ ]）と予定 を取り出す（ブラウザと Node の両方で動く）
// チェックリストの読み方・足し方は Mac の Workstation（ダッシュボードの「今日のノート」）と同じ
const MDParser = (() => {
  const ISO = /(\d{4})-(\d{2})-(\d{2})/;
  const DUE_RES = [
    /@due\((\d{4}-\d{2}-\d{2})\)/,
    /📅\s*(\d{4}-\d{2}-\d{2})/,
    /(?:^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/,
  ];
  const START_RES = [/🛫\s*(\d{4}-\d{2}-\d{2})/u, /@start\((\d{4}-\d{2}-\d{2})\)/];
  const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  const TIME_RE = /^(\d{1,2}:\d{2})(?:\s*[-~〜–]\s*(\d{1,2}:\d{2}))?\s+/;
  const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s*)?(.*)$/;
  const MONEY_RE = /^(💸|💰|🏦)\s*[¥￥]?\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*円?\s*(.*)$/u;
  const MONEY_KIND = { '💸': 'out', '💰': 'in', '🏦': 'save' };
  const TAG_RE = /(^|[\s(（「、。])#([^\s#.,;:!?()[\]{}"'`、。「」（）<>]+)/g;

  const isoName = path => { const m = path.split('/').pop().match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
  const pad = t => (t.length === 4 ? '0' + t : t);
  const fmLines = text => { const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text); return m ? m[0].split('\n').length - 1 : 0; };

  // 見せる名前：[[リンク|表示名]] は表示名、記号（** == ` など）と日付・タグの印を外す
  function clean(s) {
    return s
      .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      .replace(/@(?:due|start)\(\d{4}-\d{2}-\d{2}\)/g, '')
      .replace(/🏁/gu, '')
      .replace(/[📅✅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu, '')
      .replace(/(^|\s)@\d{4}-\d{2}-\d{2}(?=\s|$)/g, '$1')
      .replace(TAG_RE, '$1')
      .replace(/[*_`=~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // dayOfFile: このファイルがデイリーノートなら、その日（'YYYY-MM-DD'）
  function parse(path, text, dayOfFile) {
    const lines = text.split(/\r?\n/);
    const items = [];
    const base = dayOfFile || isoName(path);
    const stack = [];
    let inCode = false;
    const ctxDate = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].date) return stack[k].date; return base; };

    for (let i = fmLines(text); i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
      if (inCode) continue;

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const dm = h[2].match(ISO);
        stack.push({ level, date: dm ? dm[0] : null, title: h[2].trim() });
        continue;
      }
      const m = line.match(LIST_RE);
      if (!m) continue;
      const isTodo = m[2] !== undefined;
      let body = m[3];
      let explicit = null;
      for (const re of DUE_RES) { const d = body.match(re); if (d) { explicit = d[1]; break; } }
      let start = null;
      for (const re of START_RES) { const d = body.match(re); if (d) { start = d[1]; break; } }
      const links = [...body.matchAll(LINK_RE)].map(x => x[1].trim());
      const milestone = /🏁/u.test(body);
      const tags = [];
      for (const t of body.matchAll(TAG_RE)) if (!/^(\d+|[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t[2])) tags.push(t[2]);
      let time = null, endTime = null;
      const tm = body.match(TIME_RE);
      if (tm) { time = pad(tm[1]); endTime = tm[2] ? pad(tm[2]) : null; body = body.slice(tm[0].length); }
      const title = clean(body);
      const date = explicit || ctxDate();
      const section = stack.length ? stack[stack.length - 1].title : '';
      // start：開始日（🛫 / @start()）。milestone：節目（#節目 / 🏁）。links：[[リンク]]の先（プロジェクトに入れるのに使う）
      const common = { path, line: i, raw: line, title, date, due: explicit, start, milestone: milestone || tags.includes('節目'), links, time, endTime, tags, section };
      // お金：- 💸 1,200 ランチ #食費（出費）／- 💰 250,000 給料（収入）／- 🏦 30,000 [[引越し資金]]（貯金）
      if (!isTodo) {
        const mm = body.match(MONEY_RE);
        if (mm) {
          const amount = Math.abs(parseFloat(mm[2].replace(/,/g, '')));
          if (date && amount) items.push({ type: 'money', kind: MONEY_KIND[mm[1]], amount, ...common, title: clean(mm[3]) || clean(body.replace(MONEY_RE, '$3')) || '' });
          continue;
        }
      }

      if (isTodo) {
        if (!title) continue;
        // 出費の予定：- [ ] 💸 80,000 家賃 📅 2026-11-25（チェックを付けると「払った」）
        const mm = body.match(MONEY_RE), amount = mm ? Math.abs(parseFloat(mm[2].replace(/,/g, ''))) : 0;
        items.push({ type: 'todo', done: m[2] !== ' ', ...common, ...(amount ? { title: common.title.replace(/[💸💰🏦]\uFE0F?\s*/u, '¥'), money: { kind: MONEY_KIND[mm[1]], amount, title: clean(mm[3]) } } : {}) });   // 画面では 💸 を ¥ に
      }
      else if (date && title && (time || explicit || tags.includes('予定'))) items.push({ type: 'event', done: false, ...common });
    }
    return items;
  }

  // 行のチェックを切り替える（行がずれていたら同じ行を探す。見つからなければ null）
  function toggle(text, lineIndex, expectedRaw, done) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const ls = text.split(/\r?\n/);
    const i = ls[lineIndex] === expectedRaw ? lineIndex : ls.indexOf(expectedRaw);
    if (i < 0) return null;
    ls[i] = ls[i].replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
    return ls.join(nl);
  }

  // やることを足す（Mac と同じ順）：空の「- [ ] 」→ 最後のチェックリストの下 → 「やること」の見出しの下 → ノートの最後
  function addTodo(text, v) {
    const ls = text.split('\n');
    const fmEnd = fmLines(text);
    const empty = ls.findIndex((l, i) => i >= fmEnd && /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s*$/.test(l));
    if (empty >= 0) { ls[empty] = ls[empty].replace(/\[ \]\s*$/, `[ ] ${v}`); return ls.join('\n'); }
    let last = -1, fence = false;
    for (let i = fmEnd; i < ls.length; i++) {
      if (/^\s*(```|~~~)/.test(ls[i])) { fence = !fence; continue; }
      if (!fence && /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.test(ls[i])) last = i;
    }
    if (last >= 0) { ls.splice(last + 1, 0, ls[last].match(/^\s*/)[0] + `- [ ] ${v}`); return ls.join('\n'); }
    const h = ls.findIndex((l, i) => i >= fmEnd && /^#{1,6}\s*(やること|TODO|ToDo|タスク)\s*$/i.test(l));
    if (h >= 0) { ls.splice(h + 1, 0, `- [ ] ${v}`); return ls.join('\n'); }
    return text.replace(/\s*$/, '') + `\n\n- [ ] ${v}\n`;
  }

  // 予定を足す（デイリーノートに書く）。ev = { title, time?, endTime? }。時刻がなければ終日（#予定）
  // 入れる場所：「予定」の見出しの下 → ほかの予定の行の並び → ノートの最後に「## 予定」を作る。どれも時刻の順に入れる
  function eventLine(ev) {
    const title = String(ev.title || '').replace(/\s+/g, ' ').trim();
    if (!ev.time) return `- ${title} #予定`;
    return `- ${pad(ev.time)}${ev.endTime ? '-' + pad(ev.endTime) : ''} ${title}`;
  }
  function addEvent(text, ev) {
    const v = ev.line || eventLine(ev);   // ev.line：ほかのノートから移すときの、そのままの行
    const key = ev.time ? pad(ev.time) : '';        // 終日は時刻のある予定より前
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const ls = text.split(/\r?\n/);
    const fmEnd = fmLines(text);
    const fence = [];
    let inF = false;
    for (let i = 0; i < ls.length; i++) { if (/^\s*(```|~~~)/.test(ls[i])) { inF = !inF; fence[i] = true; } else fence[i] = inF; }
    const isList = i => i >= fmEnd && !fence[i] && LIST_RE.test(ls[i]);
    const timeOf = i => { const m = ls[i].match(LIST_RE); const t = m && m[2] === undefined && m[3].match(TIME_RE); return t ? pad(t[1]) : null; };
    const evLine = i => { const m = ls[i].match(LIST_RE); return m && m[2] === undefined && (TIME_RE.test(m[3]) || /(^|\s)#予定(\s|$)/.test(m[3])); };
    // 並び [from, to) の中で、時刻の順になる場所に入れる
    const insertSorted = (idx) => {
      const later = idx.find(i => key ? (timeOf(i) || '') > key : timeOf(i) != null);
      const at = later != null ? later : idx[idx.length - 1] + 1;
      ls.splice(at, 0, v);
      return ls.join(nl);
    };

    const h = ls.findIndex((l, i) => i >= fmEnd && !fence[i] && /^#{1,6}\s*(予定|スケジュール|schedule)\s*$/i.test(l));
    if (h >= 0) {
      let end = ls.findIndex((l, i) => i > h && !fence[i] && /^#{1,6}\s/.test(l));
      if (end < 0) end = ls.length;
      const blank = ls.findIndex((l, i) => i > h && i < end && /^\s*[-*+]\s*$/.test(l));   // テンプレートの空の「- 」
      if (blank >= 0) { ls[blank] = ls[blank].replace(/[-*+]\s*$/, v); return ls.join(nl); }
      const idx = [];
      for (let i = h + 1; i < end; i++) if (isList(i) && /^\S/.test(ls[i])) idx.push(i);
      if (idx.length) return insertSorted(idx);
      ls.splice(h + 1, 0, v);
      return ls.join(nl);
    }
    const evs = [];
    for (let i = fmEnd; i < ls.length; i++) if (isList(i) && /^\S/.test(ls[i]) && evLine(i)) evs.push(i);
    if (evs.length) return insertSorted(evs);
    const body = text.replace(/\s*$/, '');
    return (body ? body + nl + nl : '') + `## 予定${nl}${v}${nl}`;
  }

  // 予定の行を書きかえる。v = { title?, time?, endTime?, date? }
  // ・time が null なら終日（#予定 をつける）。・title を変えるときも [[リンク]]・#タグ・📅 などの印は残す
  // ・date は 📅／@due() の印があるときだけ書きかえる（ないときは、その日のノートへ移すのは呼ぶ側）
  const LINE_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[(?: |x|X)\]\s*)?(.*)$/;
  function findLine(ls, lineIndex, expectedRaw) { return ls[lineIndex] === expectedRaw ? lineIndex : ls.indexOf(expectedRaw); }
  function rewriteEvent(line, v) {
    const m = line.match(LINE_RE);
    if (!m) return null;
    let rest = m[5];
    const tm = rest.match(TIME_RE);
    if (tm) rest = rest.slice(tm[0].length);
    if (v.title != null && v.title !== clean(rest)) {
      const marks = [];
      let title = String(v.title).replace(/\s+/g, ' ').trim();
      // [[リンク]]：見えている名前がタイトルにあれば、そこをリンクに戻す。なければ後ろに残す
      for (const x of rest.matchAll(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g)) {
        const shown = (x[2] || x[1]).trim();
        if (shown && title.includes(shown)) title = title.replace(shown, x[0]); else marks.push(x[0]);
      }
      for (const x of rest.matchAll(TAG_RE)) marks.push('#' + x[2]);
      for (const x of rest.matchAll(/(?:[📅🛫⏳✅]\s*\d{4}-\d{2}-\d{2}|@(?:due|start)\(\d{4}-\d{2}-\d{2}\)|🏁)/gu)) marks.push(x[0]);
      rest = [title, ...marks].join(' ');
    }
    if (v.date) rest = rest.replace(/(📅\s*)\d{4}-\d{2}-\d{2}/u, `$1${v.date}`).replace(/@due\(\d{4}-\d{2}-\d{2}\)/, `@due(${v.date})`);
    let head = '';
    if (v.time) {
      head = `${pad(v.time)}${v.endTime ? '-' + pad(v.endTime) : ''} `;
      rest = rest.replace(/(^|\s)#予定(?=\s|$)/, '$1').replace(/\s+/g, ' ').trim();
    } else {
      const hasDate = DUE_RES.some(re => re.test(rest));
      if (!hasDate && !/(^|\s)#予定(?=\s|$)/.test(rest)) rest = rest.trim() + ' #予定';
    }
    return m[1] + m[2] + m[3] + (m[4] || '') + head + rest;
  }
  function updateEvent(text, lineIndex, expectedRaw, v) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const ls = text.split(/\r?\n/);
    const i = findLine(ls, lineIndex, expectedRaw);
    if (i < 0) return null;
    const nx = rewriteEvent(ls[i], v);
    if (nx == null) return null;
    ls[i] = nx;
    return ls.join(nl);
  }
  // 行を消す（予定の削除・ほかの日へ移すとき）
  // 1行を書きかえる（行がずれていたら同じ行を探す。見つからなければ null）
  function replaceLine(text, lineIndex, expectedRaw, newLine) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const ls = text.split(/\r?\n/);
    const i = findLine(ls, lineIndex, expectedRaw);
    if (i < 0) return null;
    ls[i] = newLine;
    return ls.join(nl);
  }
  function removeLine(text, lineIndex, expectedRaw) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const ls = text.split(/\r?\n/);
    const i = findLine(ls, lineIndex, expectedRaw);
    if (i < 0) return null;
    ls.splice(i, 1);
    return ls.join(nl);
  }

  // お金の行を足す：「お金」の見出しの下（なければノートの最後に作る）
  function moneyLine(v) {
    const em = { out: '💸', in: '💰', save: '🏦' }[v.kind] || '💸';
    return `- ${em} ${Math.round(v.amount).toLocaleString('ja-JP')} ${String(v.title || '').replace(/\s+/g, ' ').trim()}`.trimEnd();
  }
  function addMoney(text, v) {
    const line = moneyLine(v);
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const ls = text.split(/\r?\n/);
    const h = ls.findIndex(l => /^#{1,6}\s*(お金|家計|家計簿|money|finance)\s*$/i.test(l));
    if (h >= 0) {
      let end = ls.findIndex((l, i) => i > h && /^#{1,6}\s/.test(l));
      if (end < 0) end = ls.length;
      const blank = ls.findIndex((l, i) => i > h && i < end && /^\s*[-*+]\s*$/.test(l));
      if (blank >= 0) { ls[blank] = line; return ls.join(nl); }
      let last = h;
      for (let i = h + 1; i < end; i++) if (/^\s*[-*+]\s/.test(ls[i])) last = i;
      ls.splice(last + 1, 0, line);
      return ls.join(nl);
    }
    const body = text.replace(/\s*$/, '');
    return (body ? body + nl + nl : '') + `## お金${nl}${line}${nl}`;
  }

  return { parse, toggle, addTodo, addEvent, eventLine, updateEvent, rewriteEvent, removeLine, replaceLine, addMoney, moneyLine, clean };
})();
if (typeof module !== 'undefined') module.exports = MDParser;
