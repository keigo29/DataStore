  // ---------- Markdown → 画面（Mac の notes.js と同じ拡張） ----------
  const allPaths = () => Object.keys(S.files);
  function resolve(target, from = '') {
    const t = String(target || '').trim().replace(/\.md$/i, '').toLowerCase();
    if (!t) return null;
    const ps = allPaths();
    if (t.includes('/')) return ps.find(p => p.toLowerCase() === t + '.md') || ps.find(p => p.toLowerCase().endsWith('/' + t + '.md')) || null;
    const hits = ps.filter(p => nameOf(p).toLowerCase() === t);
    if (hits.length <= 1) return hits[0] || null;
    return hits.find(p => folderOf(p) === folderOf(from)) || hits.sort((a, b) => a.length - b.length)[0];
  }
  let markedReady = false;
  function setupMarked() {
    if (markedReady) return;
    markedReady = true;
    window.marked.use({
      gfm: true, breaks: true,
      extensions: [
        { name: 'wikilink', level: 'inline',
          start: src => { const i = src.indexOf('[['); return i < 0 ? undefined : (src[i - 1] === '!' ? i - 1 : i); },
          tokenizer(src) { const m = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src); if (!m) return; const [target, alias] = m[2].split('|'); return { type: 'wikilink', raw: m[0], embed: !!m[1], target: target.trim(), alias: (alias || '').trim() }; },
          renderer(t) {
            const n = resolve(t.target.split('#')[0], note);
            if (t.embed && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(t.target)) return `<span class="nt-imgph">${icon('image')}${esc(t.target)}</span>`;
            const label = t.alias || t.target.replace(/#/, ' › ');
            return `<a class="internal-link${t.embed ? ' nt-embed' : ''}${n ? '' : ' is-unresolved'}" data-href="${esc(t.target)}" href="#">${esc(label)}</a>`;
          } },
        { name: 'cmtBlock', level: 'block',
          start: src => { const m = /(^|\n)%%/.exec(src); return m ? m.index + m[1].length : undefined; },
          tokenizer(src) { const m = /^%%[\s\S]*?%%[^\n]*(?:\n|$)/.exec(src); if (m && /^%%[\s\S]*?%%\s*(?:\n|$)/.test(m[0])) return { type: 'cmtBlock', raw: m[0] }; },
          renderer: () => '' },
        { name: 'cmt', level: 'inline',
          start: src => { const i = src.indexOf('%%'); return i < 0 ? undefined : i; },
          tokenizer(src) { const m = /^%%[\s\S]*?%%/.exec(src); if (m) return { type: 'cmt', raw: m[0] }; },
          renderer: () => '' },
        { name: 'mark', level: 'inline',
          start: src => { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
          tokenizer(src) { const m = /^==(?=\S)([^\n]*?\S)==/.exec(src); if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) }; },
          renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; } },
        { name: 'tag', level: 'inline',
          start: src => { const m = /(^|[\s(（「、。])#[^\s#]/.exec(src); return m ? m.index + m[1].length : undefined; },
          tokenizer(src) { const m = /^#([^\s#.,;:!?()[\]{}"'`、。「」（）<>]+)/.exec(src); if (m && !/^\d+$/.test(m[1])) return { type: 'tag', raw: m[0], tag: m[1] }; },
          renderer(t) { return `<a class="tag" data-tag="${esc(t.tag)}" href="#">#${esc(t.tag)}</a>`; } },
      ],
    });
  }
  function splitFrontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
    if (!m) return { props: null, body: text };
    const props = [];
    let last = null;
    for (const line of m[1].split(/\r?\n/)) {
      const it = /^\s*-\s+(.*)$/.exec(line);
      if (it && last) { last.v.push(it[1].replace(/^["']|["']$/g, '')); continue; }
      const kv = /^([^:#\s][^:]*):\s*(.*)$/.exec(line);
      if (!kv) continue;
      const v = kv[2].trim();
      last = { k: kv[1].trim(), v: !v ? [] : /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [v.replace(/^["']|["']$/g, '')] };
      props.push(last);
    }
    return { props, body: text.slice(m[0].length) };
  }
  function propsEl(props) {
    const t = el('div', 'metadata-container');
    for (const p of props) {
      const r = el('div', 'metadata-property');
      r.append(el('span', 'k', p.k));
      const v = el('span', 'v');
      for (const x of p.v) {
        if (/^tags?$/i.test(p.k)) { const a = el('a', 'tag', '#' + x.replace(/^#/, '')); a.href = '#'; a.dataset.tag = x.replace(/^#/, ''); v.append(a); }
        else { const m = /^\[\[(.+?)(\|.*)?\]\]$/.exec(x); if (m) { const a = el('a', 'internal-link', m[1]); a.href = '#'; a.dataset.href = m[1]; v.append(a); } else v.append(el('span', 'pv', x)); }
      }
      r.append(v);
      t.append(r);
    }
    return t;
  }
  const CALLOUT_ICON = {
    note: 'pencil', info: 'info', tip: 'flame', hint: 'flame', important: 'flame', success: 'check', check: 'check', done: 'check',
    question: 'circle-help', help: 'circle-help', faq: 'circle-help', warning: 'triangle-alert', caution: 'triangle-alert', attention: 'triangle-alert',
    danger: 'zap', error: 'zap', failure: 'x', fail: 'x', missing: 'x', bug: 'bug', example: 'list', quote: 'quote', cite: 'quote',
    abstract: 'clipboard-list', summary: 'clipboard-list', tldr: 'clipboard-list', todo: 'circle-check',
  };
  function taskLines(text) {
    const out = [];
    let fence = false;
    text.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
      if (!fence && /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.test(l)) out.push(i);
    });
    return out;
  }
  function decorate(root, path, text) {
    for (const bq of [...root.querySelectorAll('blockquote')]) {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') continue;
      const m = /^\s*\[!([\w-]+)\]([+-]?)/.exec(p.textContent);
      if (!m) continue;
      const parts = p.innerHTML.split(/<br\s*\/?>\n?/i);
      const titleHtml = parts.shift().replace(/^\s*\[![\w-]+\][+-]?\s*/, '').trim();
      const type = m[1].toLowerCase();
      const c = el('div', 'callout' + (m[2] ? ' is-collapsible' : '') + (m[2] === '-' ? ' is-collapsed' : ''));
      c.dataset.callout = type;
      const head = el('div', 'callout-title');
      const ic = el('div', 'callout-icon');
      ic.innerHTML = icon(CALLOUT_ICON[type] || 'pencil');
      const inner = el('div', 'callout-title-inner');
      if (titleHtml) inner.innerHTML = titleHtml; else inner.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      head.append(ic, inner);
      if (m[2]) { const f = el('div', 'callout-fold'); f.innerHTML = icon('chevron-down'); head.append(f); head.addEventListener('click', () => c.classList.toggle('is-collapsed')); }
      const body = el('div', 'callout-content');
      const rest = parts.join('<br>').replace(/^\s*\n/, '');
      if (rest.trim()) { const np = el('p'); np.innerHTML = rest; body.append(np); }
      [...bq.children].slice(1).forEach(x => body.append(x));
      c.append(head);
      if (body.childNodes.length) c.append(body);
      bq.replaceWith(c);
    }
    // チェックリスト：押すとファイルにも反映（Mac と同じ）
    const lines = taskLines(text);
    [...root.querySelectorAll('input[type="checkbox"]')].forEach((cb, i) => {
      cb.disabled = false;
      cb.classList.add('task-list-item-checkbox');
      cb.closest('li')?.classList.add('task-list-item');
      if (cb.checked) cb.closest('li')?.classList.add('is-checked');
      cb.addEventListener('change', () => {
        const ln = lines[i];
        if (ln == null) return;
        const raw = text.split('\n')[ln];
        edit(path, t => MDParser.toggle(t, ln, raw, cb.checked), `${cb.checked ? '完了' : '未完了'}: ${MDParser.clean(raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s*/, ''))}`);
      });
    });
    root.querySelectorAll('pre').forEach(pre => {
      pre.append(btn('nt-copy', 'copy', async () => { try { await navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText); toast('コピーしました'); } catch {} }, 'コピー'));
    });
    root.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }
  function noteDoc(path, text) {
    setupMarked();
    const doc = el('div', 'nt-doc');
    const { props, body } = splitFrontmatter(text);
    const firstH1 = /^#\s+(.+?)\s*$/.exec(body.trimStart().split('\n')[0]);
    if (!(firstH1 && firstH1[1].trim() === nameOf(path))) doc.append(el('div', 'inline-title', nameOf(path)));
    if (props && props.length) doc.append(propsEl(props));
    let html = '';
    try { html = window.marked.parse(body); } catch (e) { html = `<pre>${esc(e.message)}</pre>`; }
    const content = el('div', 'nt-content');
    content.innerHTML = window.DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i, ADD_ATTR: ['target'] });
    doc.append(content);
    decorate(content, path, text);
    doc.addEventListener('click', e => {
      const a = e.target.closest('a.internal-link, a.tag');
      if (!a) return;
      e.preventDefault();
      if (a.classList.contains('tag')) { note = null; noteQuery = '#' + a.dataset.tag; render(); return; }
      const target = a.dataset.href.split('#')[0];
      const hit = resolve(target, path);
      if (hit) openNote(hit);
      else if (confirm(`「${target}」はまだありません。作りますか？`)) {
        const rel = (target.includes('/') ? target : (folderOf(path) ? folderOf(path) + '/' : '') + target).replace(/\.md$/i, '') + '.md';
        edit(rel, () => '', `ノートを作成: ${rel}`).then(ok => { if (ok) { openNote(rel); startEdit(); } });
      }
    });
    return doc;
  }
  function openNote(p) {
    if (isWide() && window.NotesApp) { note = null; editing = false; if (tab !== 'notes') { tab = 'notes'; render(); } NotesApp.open(p); return; }
    if (editing && note && draft !== (S.files[note]?.text ?? '') && !confirm('保存していない変更があります。破棄しますか？')) return;
    note = p; editing = false;
    if (tab !== 'notes') tab = 'notes';
    render(); window.scrollTo(0, 0); $('#view').scrollTop = 0;
  }
  function startEdit() { editing = true; draft = S.files[note]?.text ?? ''; render(); }
  // ---------- スマホ：ノートを書くときの Markdown のボタン（画面の上に固定） ----------
  // 押しても入力欄から外れない（キーボードが閉じない）。行の頭につけるもの（見出し・チェックなど）は、もう一度押すと外れる
  // 書きかえは execCommand('insertText') で行う（「元に戻す」が効くように）
  const MDK_ICONS = {
    indent: '<path d="M3 5h18"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="m3 9 4 3-4 3"/>',
    outdent: '<path d="M3 5h18"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="m7 9-4 3 4 3"/>',
    'keyboard-off': '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  };
  Object.entries(MDK_ICONS).forEach(([k, v]) => { window.ICONS[k] ||= v; });
  let mdTa = null;
  function mdKeys(ta) {
    mdTa = ta;
    let bar = $('#mdBar');
    if (!bar) {
      bar = el('div', 'mdBar'); bar.id = 'mdBar'; bar.hidden = true;
      const row = el('div', 'mdRow');
      const B = (ic, label, fn, txt) => {
        const b = el('button', 'mdK' + (txt ? ' txt' : '')); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
        if (txt) b.textContent = txt; else b.innerHTML = icon(ic);
        let p0 = null;
        // 押した瞬間に入力欄から外れないように。横にスクロールしたときは押したことにしない
        b.addEventListener('pointerdown', e => { e.preventDefault(); p0 = [e.clientX, e.clientY]; });
        b.addEventListener('pointerup', e => { if (p0 && Math.hypot(e.clientX - p0[0], e.clientY - p0[1]) < 10 && mdTa) { fn(mdTa); navigator.vibrate?.(5); } p0 = null; });
        b.addEventListener('pointercancel', () => { p0 = null; });
        b.addEventListener('click', e => e.preventDefault());
        return b;
      };
      const today = () => todayKey();
      const nextHour = () => { const h = Math.min(new Date().getHours() + 1, 23); return `${String(h).padStart(2, '0')}:00`; };
      row.append(
        B('square-check', 'チェック（やること）', t => mdLine(t, 'check')),
        B('list', '箇条書き', t => mdLine(t, 'bullet')),
        B('heading-1', '見出し（押すたびに # → ## → ### → なし）', t => mdLine(t, 'heading')),
        B('bold', '太字', t => mdWrap(t, '**', '**')),
        B('highlighter', 'マーカー（==  ==）', t => mdWrap(t, '==', '==')),
        B('link', 'ノートへのリンク [[ ]]', t => mdWrap(t, '[[', ']]')),
        B('hash', 'タグ', t => mdInsert(t, '#', true)),
        B('clock', '予定の時刻（- 10:00 ）', t => mdLine(t, 'time', nextHour())),
        B('calendar', '期限 📅 今日', t => mdInsert(t, ` 📅 ${today()}`, false, true)),
        B('quote', '引用', t => mdLine(t, 'quote')),
        B('code', 'コード', t => mdWrap(t, '`', '`')),
        B('outdent', '字下げを戻す', t => mdIndent(t, -1)),
        B('indent', '字下げ', t => mdIndent(t, 1)),
        B('undo-2', '元に戻す', t => document.execCommand('undo')),
        B('redo-2', 'やり直す', t => document.execCommand('redo')),
      );
      const close = B('keyboard-off', 'キーボードを閉じる', t => t.blur());
      close.classList.add('close');
      bar.append(row, close);
      document.body.append(bar);
      // キーボードの上に付いてくる
      const vv = window.visualViewport;
      // 見えている画面のいちばん上に付ける（キーボードが出て画面がずれても）
      const place = () => {
        if (bar.hidden) return;
        bar.style.transform = `translateY(${Math.round(vv ? vv.offsetTop : 0)}px)`;
      };
      if (vv) { vv.addEventListener('resize', place); vv.addEventListener('scroll', place); }
      window.addEventListener('resize', place);
      bar._place = place;
    }
    const show = () => { if (isWide()) return; bar.hidden = false; document.body.classList.add('typing'); bar._place(); setTimeout(bar._place, 300); };
    const hide = () => { setTimeout(() => { if (document.activeElement === mdTa && mdTa?.isConnected) return; bar.hidden = true; document.body.classList.remove('typing'); }, 80); };
    ta.addEventListener('focus', show);
    ta.addEventListener('blur', hide);
    // 入力欄が画面から消えたら（保存・やめる）帯も消す
    requestAnimationFrame(() => { if (document.activeElement === ta) show(); });
    new MutationObserver((_, ob) => { if (!ta.isConnected) { ob.disconnect(); if (mdTa === ta) { bar.hidden = true; document.body.classList.remove('typing'); } } }).observe(document.body, { childList: true, subtree: true });
  }
  // 範囲を置きかえる（「元に戻す」が効くように）
  function mdReplace(ta, a, b, text, selA, selB) {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(a, b);
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) { ta.setRangeText(text, a, b, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (selA != null) ta.setSelectionRange(selA, selB ?? selA);
  }
  function mdLineRange(ta) {
    const v = ta.value, s1 = ta.selectionStart, s2 = ta.selectionEnd;
    const a = v.lastIndexOf('\n', s1 - 1) + 1;
    let b = v.indexOf('\n', s2 > s1 && v[s2 - 1] === '\n' ? s2 - 1 : s2); if (b < 0) b = v.length;
    return [a, b];
  }
  // 行の頭につけるもの（つけ外し）
  function mdLine(ta, kind, arg) {
    const [a, b] = mdLineRange(ta);
    const s1 = ta.selectionStart, s2 = ta.selectionEnd;
    const lines = ta.value.slice(a, b).split('\n');
    const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
    let delta0 = 0;
    const out = lines.map((l, i) => {
      const ind = l.match(/^\s*/)[0];
      let body = l.slice(ind.length), nx;
      if (kind === 'check') nx = /^[-*+]\s+\[[ xX]\]\s?/.test(body) ? body.replace(/^[-*+]\s+\[[ xX]\]\s?/, '') : '- [ ] ' + body.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
      else if (kind === 'bullet') nx = /^[-*+]\s+(?!\[)/.test(body) ? body.replace(/^[-*+]\s+/, '') : '- ' + body.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
      else if (kind === 'quote') nx = /^>\s?/.test(body) ? body.replace(/^>\s?/, '') : '> ' + body;
      else if (kind === 'heading') { const m = body.match(/^(#{1,6})\s+/); const lv = m ? m[1].length : 0; body = body.replace(/^#{1,6}\s+/, ''); nx = lv >= 3 ? body : '#'.repeat(lv + 1) + ' ' + body; }
      else if (kind === 'time') {
        const rest = body.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
        nx = /^\d{1,2}:\d{2}(?:\s*[-~〜–]\s*\d{1,2}:\d{2})?\s/.test(rest) ? '- ' + rest.replace(/^\d{1,2}:\d{2}(?:\s*[-~〜–]\s*\d{1,2}:\d{2})?\s+/, '') : `- ${arg} ` + rest;
      }
      const r = ind + nx;
      if (i === 0) delta0 = r.length - l.length;
      return r;
    });
    const text = out.join('\n');
    const one = lines.length === 1;
    // 1行のときは、カーソルを行の中の同じ文字の位置に（行の頭より前には戻さない）
    const ns1 = a + Math.max(0, s1 - a + delta0);
    mdReplace(ta, a, b, text, one ? Math.min(ns1, a + text.length) : a, one ? Math.min(Math.max(s2 - a + delta0, 0) + a, a + text.length) : a + text.length);
  }
  // 選んだ文字を囲む（選んでいなければ、間にカーソル）
  function mdWrap(ta, l, r) {
    const a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
    if (sel && sel.startsWith(l) && sel.endsWith(r) && sel.length >= l.length + r.length) return mdReplace(ta, a, b, sel.slice(l.length, sel.length - r.length), a, b - l.length - r.length);
    mdReplace(ta, a, b, l + sel + r, a + l.length, a + l.length + sel.length);
  }
  // 文字を入れる。space：前が空白でなければ空白を足す。atEnd：行の終わりに入れる
  function mdInsert(ta, text, space, atEnd) {
    let a = ta.selectionStart, b = ta.selectionEnd;
    if (atEnd) { const [, e] = mdLineRange(ta); a = b = e; }
    const prev = ta.value[a - 1];
    const t = space && prev && !/\s/.test(prev) ? ' ' + text : text;
    mdReplace(ta, a, b, t, a + t.length);
  }
  function mdIndent(ta, dir) {
    const [a, b] = mdLineRange(ta);
    const s1 = ta.selectionStart;
    const lines = ta.value.slice(a, b).split('\n');
    let d0 = 0;
    const out = lines.map((l, i) => { const r = dir > 0 ? '  ' + l : l.replace(/^( {1,2}|\t)/, ''); if (i === 0) d0 = r.length - l.length; return r; });
    const text = out.join('\n');
    if (text === lines.join('\n')) return;
    mdReplace(ta, a, b, text, lines.length === 1 ? Math.max(a, s1 + d0) : a, lines.length === 1 ? Math.max(a, s1 + d0) : a + text.length);
  }

  function renderNote(main) {
    const f = S.files[note];
    if (!f) { note = null; return renderNotes(main); }
    const bar = el('div', 'noteBar');
    bar.append(btn('btn white small', ['chevron-left', 'ノート'], () => { if (editing && draft !== f.text && !confirm('保存していない変更があります。破棄しますか？')) return; note = null; editing = false; render(); }));
    bar.append(el('span', 'notePath', folderOf(note)));
    if (editing) {
      bar.append(btn('btn small', 'やめる', () => { if (draft !== f.text && !confirm('変更を破棄しますか？')) return; editing = false; render(); }),
        btn('btn primary small', ['check', '保存'], async e => {
          e.currentTarget.disabled = true;
          const v = draft;
          const ok = v === f.text ? true : await edit(note, () => v, `更新: ${note}`);
          if (ok) { editing = false; render(); if (v !== f.text) toast('保存しました'); if (pendingReload) { pendingReload = false; sync(true); } }
          else e.currentTarget.disabled = false;
        }));
      main.append(bar);
      const ta = el('textarea', 'nt-editor');
      ta.value = draft;
      ta.spellcheck = false;
      ta.addEventListener('input', () => { draft = ta.value; });
      if (isWide()) {
        // Mac の「ノートを並べて書く」と同じ：左に書く画面、右に見た目（書くたびに更新）
        const sp = el('div', 'ntSplit');
        const pv = panel('notePanel');
        const draw = () => { pv.innerHTML = ''; pv.append(noteDoc(note, draft)); pv.querySelectorAll('input[type="checkbox"]').forEach(c => { c.disabled = true; }); };
        let raf = 0;
        ta.addEventListener('input', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); });
        draw();
        sp.append(ta, pv);
        main.append(sp);
        requestAnimationFrame(() => ta.focus());
        return;
      }
      main.append(ta);
      mdKeys(ta);
      main.append(el('div', 'sub edHint', !connected() ? 'デモ表示中：保存はこの画面の中だけです' : desk ? (deskSt?.git?.repo && deskSt.autoGit ? '保存すると、少しあとで自動で commit・push します' : '保存すると、フォルダのファイルに書きます') : '保存すると、このノートを GitHub に commit します'));
      requestAnimationFrame(() => { ta.style.height = Math.max(window.innerHeight * 0.6, ta.scrollHeight) + 'px'; });
      return;
    }
    bar.append(btn('btn white small', ['pencil', '編集'], startEdit));
    main.append(bar);
    const p = panel('notePanel');
    p.append(noteDoc(note, f.text));
    main.append(p);
    // バックリンク（このノートへの [[リンク]]）
    const me = nameOf(note).toLowerCase();
    const back = allPaths().filter(x => x !== note && new RegExp(`\\[\\[(${me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, 'i').test(S.files[x].text));
    if (back.length) {
      const pb = panel();
      pb.append(panelHead('link', 'このノートへのリンク', el('span', '', `${back.length}件`)));
      back.forEach(x => { const r = btn('prow', [], () => openNote(x)); r.insertAdjacentHTML('beforeend', icon('file-text')); r.append(el('b', '', nameOf(x))); r.insertAdjacentHTML('beforeend', icon('chevron-right')); pb.append(r); });
      main.append(pb);
    }
  }
  function newNote(opt = {}) {
    if (isWide() && window.NotesApp) { if (tab !== 'notes') { tab = 'notes'; render(); } return NotesApp.newNote(opt.day ? dayFolder(opt.day) : undefined); }
    const inn = $('#sheetIn');
    const day = opt.day || null;
    sheetHead(inn, day ? `${relDay(day)}のノート` : '新しいノート');
    const inp = el('input', 'inp');
    inp.placeholder = '例：MTG メモ、Spring Boot の調べもの';
    // 場所：その日のフォルダ（2026/11/10）を先に。日付フォルダはその日の分だけ出す
    const t = todayKey();
    const dayOpts = [...new Set([day, t].filter(Boolean))].map(k => [dayFolder(k), `${relDay(k)}（${dayFolder(k) || 'いちばん上'}）`]);
    const folders = [...new Set(allPaths().filter(p => !dayOf.has(p)).map(folderOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    const sel = el('select', 'inp');
    dayOpts.forEach(([v, l]) => sel.append(new Option(l, v)));
    sel.append(new Option('いちばん上', ''));
    folders.filter(f => !dayOpts.some(([v]) => v === f)).forEach(f => sel.append(new Option(f, f)));
    if (!day && opt.folder != null) sel.value = opt.folder;
    const tags = el('input', 'inp');
    tags.placeholder = '例：仕事 java（スペースで区切る）';
    const known = [...new Set([...noteTags.values()].flat())].sort((a, b) => a.localeCompare(b, 'ja'));
    const fld = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };
    inn.append(fld('名前', inp), fld('場所', sel), fld('タグ（カテゴリ）', tags));
    if (known.length) {
      const kc = el('div', 'tagPick');
      known.slice(0, 20).forEach(k => kc.append(btn('chip', '#' + k, () => { const cur = tags.value.split(/[\s,、]+/).filter(Boolean); if (!cur.includes(k)) tags.value = [...cur, k].join(' '); })));
      inn.append(kc);
    }
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['file-plus', '作る'], async () => {
      const name = inp.value.trim().replace(/\.md$/i, '').replace(/[\\:*?"<>|#^[\]]/g, ' ').trim();
      if (!name) { inp.focus(); return; }
      const rel = (name.includes('/') ? name : (sel.value ? sel.value + '/' : '') + name) + '.md';
      const tg = [...new Set(tags.value.split(/[\s,、]+/).map(x => x.replace(/^#/, '').trim()).filter(Boolean))];
      sheet.close();
      if (S.files[rel]) { openNote(rel); return; }
      const body = tg.length ? `---\ntags: [${tg.join(', ')}]\n---\n\n` : '';
      if (await edit(rel, () => body, `ノートを作成: ${rel}`)) { openNote(rel); startEdit(); }
    }));
    inn.append(bs);
    sheet.showModal();
    setTimeout(() => inp.focus(), 50);
  }

