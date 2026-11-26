// MD Workstation 用：旧 Workstation（Mac 版）の src/renderer/live-editor.js をそのまま使っています（ノートを見たままで書く）。
// ノートの「見たまま」編集（Obsidian のライブプレビューと同じ考え方）
// ・ファイルの中身は Markdown のまま（Obsidian で開いても同じ）。画面の上だけ、記号をかくして見た目を整える
// ・カーソルのある行は、記号（# や ** など）をそのまま見せて、ふつうに直せる。ほかの行は見たままの形
// ・# を打つとその場で見出しの大きさに、- [ ] はチェックボックスに、[[リンク]] は押せるリンクになる
// 部品は CodeMirror 6（vendor/codemirror.js、window.CM）。scripts/build-editor.js で作る
window.LiveEditor = (() => {
  const CM = window.CM;
  if (!CM) return { create: () => null, ok: false };
  const { EditorState, EditorView, Decoration, ViewPlugin, WidgetType, StateField, RangeSetBuilder, keymap, EditorSelection } = CM;

  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

  // ---------- 小さな部品（記号のかわりに出すもの） ----------
  class Bullet extends WidgetType {
    toDOM() { const s = document.createElement('span'); s.className = 'cm-lp-bullet'; s.textContent = '•'; return s; }
    eq() { return true; }
  }
  class Check extends WidgetType {
    constructor(done, pos) { super(); this.done = done; this.pos = pos; }
    eq(o) { return o.done === this.done && o.pos === this.pos; }
    toDOM(view) {
      const c = document.createElement('input');
      c.type = 'checkbox'; c.className = 'cm-lp-check'; c.checked = this.done;
      c.addEventListener('mousedown', e => {
        e.preventDefault();
        // [ ] ⇔ [x] を書きかえる（pos は [ の位置）
        view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.done ? ' ' : 'x' } });
      });
      return c;
    }
    ignoreEvent() { return true; }
  }
  class Rule extends WidgetType {
    toDOM() { const s = document.createElement('span'); s.className = 'cm-lp-hr'; return s; }
    eq() { return true; }
  }
  class Img extends WidgetType {
    constructor(src, alt) { super(); this.src = src; this.alt = alt; }
    eq(o) { return o.src === this.src; }
    toDOM() {
      const s = document.createElement('span'); s.className = 'cm-lp-imgWrap';
      const i = document.createElement('img'); i.className = 'cm-lp-img'; i.src = this.src; i.alt = this.alt || ''; i.draggable = false;
      s.append(i);
      return s;
    }
  }
  class Icon extends WidgetType {
    constructor(html) { super(); this.html = html; }
    eq(o) { return o.html === this.html; }
    toDOM() { const s = document.createElement('span'); s.className = 'cm-lp-calloutIcon'; s.innerHTML = this.html; return s; }
  }
  // 表・コードブロック：読む画面と同じ HTML（同じ CSS）で出す。押すと、中にカーソルを入れて記号のまま書きかえられる
  class BlockW extends WidgetType {
    constructor(md, pos, kind, opts) { super(); this.md = md; this.pos = pos; this.kind = kind; this.opts = opts; }
    eq(o) { return o.md === this.md && o.pos === this.pos; }
    toDOM(view) {
      const d = document.createElement('div');
      d.className = 'cm-lp-block' + (this.kind === 'table' ? ' cm-lp-tableWrap' : ' cm-lp-codeWrap');
      d.innerHTML = this.opts.renderMd(this.md);
      d.title = this.kind === 'table' ? '押して表を書きかえる' : '押してコードを書きかえる';
      const pre = d.querySelector('pre');
      if (pre && this.opts.copy) {
        // 読む画面と同じ「コピー」のボタン（押してもカーソルは入らない）
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'nt-copy'; b.title = 'コピー'; b.innerHTML = this.opts.copyIcon || '';
        b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.opts.copy(pre.querySelector('code')?.innerText ?? pre.innerText); });
        pre.append(b);
      }
      d.addEventListener('mousedown', e => { e.preventDefault(); view.dispatch({ selection: { anchor: this.pos } }); view.focus(); });
      return d;
    }
    ignoreEvent() { return true; }
  }
  class FmChip extends WidgetType {
    constructor(n) { super(); this.n = n; }
    eq(o) { return o.n === this.n; }
    toDOM() { const s = document.createElement('div'); s.className = 'cm-lp-fmChip'; s.textContent = `プロパティ（${this.n}行）を書く`; return s; }
  }

  // ---------- 先頭のプロパティ（--- で囲んだところ） ----------
  // Markdown の読み方では「見出し」などと読みまちがえるので、ここで範囲を決めて、ほかの飾りの対象から外す
  function fmRange(doc) {
    if (doc.lines < 2 || doc.line(1).text !== '---') return null;
    for (let i = 2; i <= Math.min(doc.lines, 400); i++) if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) return { from: 0, to: doc.line(i).to, lines: i };
    return null;
  }
  // エディタに入力しているか（入力していないときは、どの行も見たままの形にする＝開いたときに記号が見えないように）
  const setFocus = CM.StateEffect.define();
  const focusField = StateField.define({
    create: () => false,
    update: (v, tr) => { for (const e of tr.effects) if (e.is(setFocus)) return e.value; return v; },
  });
  // カーソルがプロパティの中にないときは、まとめてたたむ（上のプロパティの欄で直せる。押すと中を書ける）
  const fmField = StateField.define({
    create: s => fmDeco(s),
    update: (d, tr) => (tr.docChanged || tr.selection || tr.effects.some(e => e.is(setFocus)) ? fmDeco(tr.state) : d),
    provide: f => EditorView.decorations.from(f),
  });
  function fmDeco(state) {
    const fm = fmRange(state.doc);
    if (!fm) return Decoration.none;
    if (state.field(focusField) && state.selection.ranges.some(r => r.from <= fm.to && r.to >= fm.from)) {
      const b = new RangeSetBuilder();
      for (let i = 1; i <= fm.lines; i++) b.add(state.doc.line(i).from, state.doc.line(i).from, Decoration.line({ class: 'cm-lp-fm' }));
      return b.finish();
    }
    return Decoration.set([Decoration.replace({ widget: new FmChip(fm.lines - 2), block: true }).range(fm.from, fm.to)]);
  }

  // ---------- 表・コードブロック（カーソルが中にないときは、読む画面と同じ形で出す。何行にもまたがるので、ここで作る） ----------
  const blockField = opts => StateField.define({
    create: s => blockDeco(s, opts),
    update: (d, tr) => (tr.docChanged || tr.selection || tr.effects.some(e => e.is(setFocus)) || CM.syntaxTree(tr.startState) !== CM.syntaxTree(tr.state) ? blockDeco(tr.state, opts) : d),
    provide: f => EditorView.decorations.from(f),
  });
  function blockDeco(state, opts) {
    const fm = fmRange(state.doc);
    const focused = state.field(focusField);
    const out = [];
    CM.syntaxTree(state).iterate({
      enter: n => {
        if (n.name === 'Blockquote' || n.name === 'CodeBlock') return false;
        const kind = n.name === 'Table' ? 'table' : n.name === 'FencedCode' ? 'code' : null;
        if (!kind) return undefined;
        const doc = state.doc;
        const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
        const from = first.from, to = last.to;
        if (fm && from <= fm.to) return false;
        // 閉じていないコードブロック（書いている途中）は、そのまま
        if (kind === 'code' && (last.number === first.number || !/^\s*(```|~~~)/.test(last.text))) return false;
        const inside = focused && state.selection.ranges.some(r => r.to >= from && r.from <= to);
        if (!inside) {
          const pos = kind === 'code' && last.number > first.number + 1 ? doc.line(first.number + 1).from : from;   // コードは中身の1行目へ
          out.push(Decoration.replace({ widget: new BlockW(doc.sliceString(from, to), pos, kind, opts), block: true }).range(from, to));
        }
        return false;
      },
    });
    return Decoration.set(out);
  }

  // ---------- 見たままの飾り ----------
  const HIDE = Decoration.replace({});
  const line = cls => Decoration.line({ class: cls });
  const mark = (cls, attrs) => Decoration.mark(attrs ? { class: cls, attributes: attrs } : { class: cls });

  function build(view, opts) {
    const { state } = view;
    const doc = state.doc;
    const fm = fmRange(doc);
    // カーソル（選んでいるところ）のある行：記号をそのまま見せる
    const active = new Set();
    if (state.field(focusField)) for (const r of state.selection.ranges) {
      const a = doc.lineAt(r.from).number, b = doc.lineAt(r.to).number;
      for (let i = a; i <= b; i++) active.add(i);
    }
    const isActive = pos => active.has(doc.lineAt(pos).number);
    const out = [];
    const add = (from, to, deco) => { if (from <= to && (!fm || from > fm.to)) out.push(deco.range(from, to)); };
    const lineDeco = (pos, cls, attrs) => { if (!fm || pos > fm.to) out.push((attrs ? Decoration.line({ class: cls, attributes: attrs }) : line(cls)).range(doc.lineAt(pos).from)); };
    const tree = CM.syntaxTree(state);
    const code = [];   // コードの範囲（この中は [[リンク]] や #タグ を探さない）
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from, to,
        enter: n => {
          const t = n.name;
          if (fm && n.from <= fm.to) return t === 'Document' ? undefined : false;
          let m;
          if ((m = /^ATXHeading(\d)$/.exec(t))) {
            lineDeco(n.from, `cm-lp-h cm-lp-h${m[1]} HyperMD-header HyperMD-header-${m[1]}`);
            if (!isActive(n.from)) {
              const hm = n.node.firstChild;
              if (hm && hm.name === 'HeaderMark') add(hm.from, Math.min(hm.to + 1, doc.lineAt(n.from).to), HIDE);
            }
            return;
          }
          if ((m = /^SetextHeading(\d)$/.exec(t))) { lineDeco(n.from, 'cm-lp-h cm-lp-h' + m[1]); return; }
          if (t === 'StrongEmphasis') add(n.from, n.to, mark('cm-lp-strong cm-strong'));
          else if (t === 'Emphasis') add(n.from, n.to, mark('cm-lp-em cm-em'));
          else if (t === 'Strikethrough') add(n.from, n.to, mark('cm-lp-strike cm-strikethrough'));
          else if (t === 'InlineCode') { add(n.from, n.to, mark('cm-lp-code cm-inline-code')); code.push([n.from, n.to]); }
          else if (t === 'EmphasisMark' || t === 'StrikethroughMark' || (t === 'CodeMark' && n.node.parent?.name === 'InlineCode')) {
            if (!isActive(n.from)) add(n.from, n.to, HIDE);
          } else if (t === 'FencedCode' || t === 'CodeBlock') {
            code.push([n.from, n.to]);
            const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
            for (let p = n.from; p <= n.to;) {
              const l = doc.lineAt(p);
              const fence = t === 'FencedCode' && (l.number === first.number || (l.number === last.number && last.number !== first.number));
              lineDeco(l.from, 'cm-lp-codeblock' + (l.number === first.number ? ' cm-lp-codeFirst' : '') + (l.number === last.number ? ' cm-lp-codeLast' : '') + (fence ? ' cm-lp-fence' : ''));
              p = l.to + 1;
            }
            return false;
          } else if (t === 'Blockquote') {
            // コールアウト（> [!種類] 題）：読む画面と同じ色の箱。ふつうの引用：左に線
            const fl = doc.lineAt(n.from), ll = doc.lineAt(n.to);
            const co = /^(\s*>\s*)\[!([^\]]+)\]([+-]?)\s*/.exec(fl.text);
            for (let p = n.from; p <= n.to;) {
              const l = doc.lineAt(p);
              if (co) lineDeco(l.from, 'cm-lp-callout' + (l.number === fl.number ? ' cm-lp-calloutTitle' : '') + (l.number === ll.number ? ' cm-lp-calloutLast' : ''), { 'data-callout': co[2].trim().toLowerCase() });
              else lineDeco(l.from, 'cm-lp-quote');
              p = l.to + 1;
            }
            if (co && !isActive(fl.from)) {
              // [!種類] のかわりに、読む画面と同じアイコンを出す
              const ic = opts.calloutIcon?.(co[2].trim().toLowerCase());
              add(fl.from + co[1].length, fl.from + co[0].length, ic ? Decoration.replace({ widget: new Icon(ic) }) : HIDE);
            }
          } else if (t === 'QuoteMark') {
            if (!isActive(n.from)) add(n.from, Math.min(n.to + (doc.sliceString(n.to, n.to + 1) === ' ' ? 1 : 0), doc.lineAt(n.from).to), HIDE);
          } else if (t === 'ListMark') {
            const s = doc.sliceString(n.from, n.to);
            const l = doc.lineAt(n.from);
            if (/^>/.test(l.text.trimStart())) return;   // 引用・コールアウトの中の一覧は、字下げをいじらない
            if (l.from + (l.text.length - l.text.trimStart().length) !== n.from) return;   // 行の頭の印だけ
            const act = isActive(n.from);
            // 字下げ：読む画面と同じく、印の分だけ右へ。折り返した行も、文字の頭にそろえる
            const ws = l.text.slice(0, n.from - l.from).replace(/\t/g, '  ').length;
            const lvl = Math.floor(ws / 2);
            const after = doc.sliceString(n.to, n.to + 5);
            const task = /^[-*+]$/.test(s) && /^ \[[ xX]\]( |$)/.test(after);
            if (!act) {
              if (n.from > l.from) add(l.from, n.from, HIDE);   // 行の頭の空白は、字下げで見せる
              const [pad, ind] = task ? [28, 24] : /^[-*+]$/.test(s) ? [24, 16] : [28, 22];
              lineDeco(l.from, 'cm-lp-li', { style: `padding-left: ${pad + lvl * 24}px; text-indent: -${ind}px` });
            }
            if (/^[-*+]$/.test(s) && !act) {
              // チェックリストの「- 」は、チェックボックスだけにする
              if (task) add(n.from, n.to + 1, HIDE);
              else add(n.from, n.to + (doc.sliceString(n.to, n.to + 1) === ' ' ? 1 : 0), Decoration.replace({ widget: new Bullet() }));   // 「- 」をまとめて点に（点の幅＝字下げの幅）
            } else add(n.from, n.to, mark('cm-lp-olMark'));
          } else if (t === 'TaskMarker') {
            const done = /x/i.test(doc.sliceString(n.from, n.to));
            if (done) lineDeco(n.from, 'cm-lp-done');
            if (!isActive(n.from)) add(n.from, n.to, Decoration.replace({ widget: new Check(done, n.from) }));
          } else if (t === 'HorizontalRule') {
            if (!isActive(n.from)) add(n.from, n.to, Decoration.replace({ widget: new Rule() }));
          } else if (t === 'Link') {
            const url = n.node.getChild('URL');
            const marks = n.node.getChildren('LinkMark');
            const href = url ? doc.sliceString(url.from, url.to) : '';
            // [[リンク]] は Markdown では「[ ] の中の [ ]」と読まれるので、ここでは飾らない（下の [[ ]] の飾りにまかせる）
            if (doc.sliceString(n.from - 1, n.from) === '[' || doc.sliceString(n.from, n.from + 2) === '[[' || !url) return false;
            if (marks.length >= 2) {
              const textFrom = marks[0].to, textTo = marks[1].from;
              add(textFrom, textTo, mark('cm-lp-link', { 'data-href': href }));
              if (!isActive(n.from)) { add(marks[0].from, marks[0].to, HIDE); add(marks[1].from, n.to, HIDE); }
            }
            return false;
          } else if (t === 'Image') {
            const url = n.node.getChild('URL');
            const href = url ? doc.sliceString(url.from, url.to) : '';
            const src = href && opts.imageUrl?.(href);
            if (src && !isActive(n.from)) add(n.from, n.to, Decoration.replace({ widget: new Img(src, href) }));
            else add(n.from, n.to, mark('cm-lp-raw'));
            return false;
          } else if (t === 'URL' && n.node.parent?.name !== 'Link' && n.node.parent?.name !== 'Image') {
            add(n.from, n.to, mark('cm-lp-link', { 'data-href': doc.sliceString(n.from, n.to) }));
          } else if (t === 'Table') {
            // 表は、カーソルが中にないときは表の形で出す（tableField）。中にいるときは、記号のまま
            code.push([n.from, n.to]);
            for (let p = n.from; p <= n.to;) { const l = doc.lineAt(p); lineDeco(l.from, 'cm-lp-table'); p = l.to + 1; }
            return false;
          }
          return undefined;
        },
      });
      // Markdown の読み方にない書き方（Obsidian）：[[リンク]]・![[画像]]・==ハイライト==・#タグ
      const inCode = p => code.some(([a, b]) => p >= a && p < b);
      // 空の行：読む画面と同じくらいの間に（カーソルがあるときは、ふつうの高さ）
      for (let p = from; p <= to;) {
        const l = doc.lineAt(p);
        if (!l.text.trim() && !active.has(l.number) && !inCode(l.from) && (!fm || l.from > fm.to)) lineDeco(l.from, 'cm-lp-blank');
        p = l.to + 1;
      }
      const text = doc.sliceString(from, to);
      const re = /(!?)\[\[([^\]\n]+)\]\]|==([^=\n]+)==|(?<=^|[\s(])#([^\s#.,!?;:()[\]{}"'`、。]+)|<u>([^\n]*?)<\/u>/gmu;
      let m;
      while ((m = re.exec(text))) {
        const a = from + m.index, b = a + m[0].length;
        if (inCode(a) || (fm && a <= fm.to)) continue;
        const act = isActive(a);
        if (m[2] !== undefined) {
          const [target, alias] = m[2].split('|');
          const embed = m[1] === '!';
          const src = embed && IMG_RE.test(target.split('#')[0].trim()) && opts.imageUrl?.(target.trim());
          if (src && !act) { add(a, b, Decoration.replace({ widget: new Img(src, target) })); continue; }
          if (act) { add(a, b, mark('cm-lp-wiki cm-lp-wikiRaw', { 'data-wiki': target.trim() })); continue; }
          // 表に出す文字：別名があれば別名、なければリンク先
          const shownFrom = alias !== undefined ? a + (embed ? 3 : 2) + target.length + 1 : a + (embed ? 3 : 2);
          const shownTo = b - 2;
          const known = opts.hasNote ? opts.hasNote(target.split('#')[0].trim()) : true;
          add(a, shownFrom, HIDE);
          add(shownFrom, shownTo, mark('cm-lp-wiki cm-hmd-internal-link' + (known ? '' : ' is-unresolved'), { 'data-wiki': target.trim() }));
          add(shownTo, b, HIDE);
        } else if (m[3] !== undefined) {
          add(a, b, mark('cm-lp-hl cm-highlight'));
          if (!act) { add(a, a + 2, HIDE); add(b - 2, b, HIDE); }
        } else if (m[4] !== undefined) {
          add(a, b, mark('cm-lp-tag cm-hashtag', { 'data-tag': m[4] }));
        } else if (m[5] !== undefined) {
          add(a, b, mark('cm-lp-u'));
          if (!act) { add(a, a + 3, HIDE); add(b - 4, b, HIDE); }
        }
      }
    }
    return Decoration.set(out, true);
  }

  const livePlugin = opts => ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = build(view, opts); }
    update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged || u.startState.field(focusField) !== u.state.field(focusField) || CM.syntaxTree(u.startState) !== CM.syntaxTree(u.state)) this.decorations = build(u.view, opts); }
  }, { decorations: v => v.decorations });

  // ---------- 文字の囲み（⌘B・⌘I など） ----------
  const wrapWith = (l, r = l) => view => {
    const tr = view.state.changeByRange(range => {
      const t = view.state.sliceDoc(range.from, range.to);
      if (t.startsWith(l) && t.endsWith(r) && t.length >= l.length + r.length) {
        return { changes: { from: range.from, to: range.to, insert: t.slice(l.length, t.length - r.length) }, range: EditorSelection.range(range.from, range.to - l.length - r.length) };
      }
      return { changes: [{ from: range.from, insert: l }, { from: range.to, insert: r }], range: EditorSelection.range(range.from + l.length, range.to + l.length) };
    });
    view.dispatch(tr);
    return true;
  };

  // ---------- [[ を打ったら、ノートの名前の候補を出す ----------
  const linkComplete = opts => ctx => {
    const m = ctx.matchBefore(/\[\[[^\]\n|#]*/);
    if (!m) return null;
    const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]';
    const names = opts.noteNames?.() || [];
    return {
      from: m.from + 2,
      options: names.map(n => ({ label: n, apply: closed ? n : n + ']]', type: 'text' })),
      validFor: /^[^\]\n|#]*$/,
    };
  };

  // parent：入れる場所、text：中身、onChange(text)：書きかえたとき、onBlur、openLink({ wiki | href, newTab })、
  // imageUrl(リンク先) → 画像の URL（なければ null）、noteNames() → ノートの名前の並び、pasteImages(files) → 入れる Markdown（Promise）
  function create(opts) {
    let quiet = false;   // 外から中身を入れたときは、書きかえたことにしない
    const exts = [
      CM.history(),
      CM.drawSelection(),
      CM.dropCursor(),
      EditorView.lineWrapping,
      CM.markdown({ base: CM.markdownLanguage, extensions: [CM.GFM] }),
      CM.autocompletion({ override: [linkComplete(opts)], icons: false }),
      CM.search({ top: true }),
      CM.highlightSelectionMatches(),
      focusField,
      fmField,
      ...(opts.renderMd ? [blockField(opts)] : []),
      livePlugin(opts),
      keymap.of([
        ...(opts.keys || []).map(k => ({ key: k.key, run: () => { k.run(); return true; }, preventDefault: true })),
        { key: 'Mod-b', run: wrapWith('**') },
        { key: 'Mod-i', run: wrapWith('*') },
        { key: 'Mod-Shift-x', run: wrapWith('~~') },
        { key: 'Mod-Shift-h', run: wrapWith('==') },
        ...CM.markdownKeymap,
        ...CM.completionKeymap,
        ...CM.searchKeymap,
        ...CM.historyKeymap,
        CM.indentWithTab,
        ...CM.defaultKeymap,
      ]),
      CM.placeholder(opts.placeholder || ''),
      // 検索の窓の言葉を日本語に
      EditorState.phrases.of({
        'Find': '探す', 'Replace': '置きかえる', 'next': '次', 'previous': '前', 'all': 'すべて',
        'match case': '大文字・小文字を区別', 'regexp': '正規表現', 'by word': '単語で', 'replace': '置きかえ', 'replace all': 'すべて置きかえ',
        'close': '閉じる', 'current match': 'いまの場所', 'on line': '行目', 'Go to line': '行へ移動', 'go': '移動',
      }),
      EditorView.updateListener.of(u => { if (u.docChanged && !quiet) opts.onChange?.(u.state.doc.toString()); }),
      EditorView.domEventHandlers({
        // リンク・タグを押したら開く（⌘/Ctrl を押しながらだと横の列で）。書きかえたいときは、キーボードでその行へ
        mousedown: (e, view) => {
          const a = e.target.closest?.('[data-wiki], [data-href], [data-tag]');
          if (!a || e.button !== 0 || e.shiftKey) return false;
          if (a.classList.contains('cm-lp-wikiRaw') && !(e.metaKey || e.ctrlKey)) return false;   // 書いている途中のリンクは、⌘ を押したときだけ開く
          e.preventDefault();
          opts.openLink?.({ wiki: a.dataset.wiki, href: a.dataset.href, tag: a.dataset.tag, newTab: e.metaKey || e.ctrlKey || e.altKey });
          return true;
        },
        focus: (e, view) => { setTimeout(() => view.dispatch({ effects: setFocus.of(true) })); return false; },
        blur: (e, view) => {
          // 探す窓・候補へ移ったときは、入力中のまま
          setTimeout(() => { if (!view.hasFocus) view.dispatch({ effects: setFocus.of(false) }); });
          opts.onBlur?.();
          return false;
        },
        paste: (e, view) => pasteFiles(e, view, e.clipboardData),
        drop: (e, view) => {
          const fs = [...(e.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type));
          if (!fs.length) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos != null) view.dispatch({ selection: { anchor: pos } });
          return pasteFiles(e, view, e.dataTransfer);
        },
      }),
    ];
    function pasteFiles(e, view, dt) {
      const fs = [...(dt?.files || [])].filter(f => /^image\//.test(f.type));
      if (!fs.length || !opts.pasteImages) return false;
      e.preventDefault();
      opts.pasteImages(fs).then(md => { if (md) view.dispatch(view.state.replaceSelection(md)); view.focus(); });
      return true;
    }
    // はじめのカーソルは本文の頭に（先頭のプロパティの中に置くと、プロパティがたたまれずに見えてしまうので）
    const doc0 = opts.text || '';
    const fm0 = fmRange(CM.EditorState.create({ doc: doc0 }).doc);
    const start = fm0 ? Math.min(doc0.length, fm0.to + 1) : 0;
    const view = new EditorView({ state: EditorState.create({ doc: doc0, extensions: exts, selection: { anchor: start } }), parent: opts.parent });
    return {
      view,
      getText: () => view.state.doc.toString(),
      // 外で書きかわったとき：カーソルの場所はなるべくそのまま
      setText(t) {
        const cur = view.state.doc.toString();
        if (t === cur) return;
        let a = 0;
        while (a < cur.length && a < t.length && cur[a] === t[a]) a++;
        let b = 0;
        while (b < cur.length - a && b < t.length - a && cur[cur.length - 1 - b] === t[t.length - 1 - b]) b++;
        quiet = true;
        try { view.dispatch({ changes: { from: a, to: cur.length - b, insert: t.slice(a, t.length - b) } }); } finally { quiet = false; }
      },
      focus(end) { view.focus(); if (end) view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true }); },
      // 見出しの行へ動かす
      gotoLine(n) {
        const l = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, n)));
        view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 40 }) });
        view.focus();
      },
      openSearch() { CM.openSearchPanel(view); },
      // 書く画面のツールバー（notes.js の editBar）を、そのまま使えるようにする：入力欄（textarea）と同じ形の窓口
      textareaLike() {
        const sel = () => view.state.selection.main;
        return {
          isLive: true,
          get value() { return view.state.doc.toString(); },
          get selectionStart() { return sel().from; },
          get selectionEnd() { return sel().to; },
          setSelectionRange(a, b = a) { const n = view.state.doc.length; view.dispatch({ selection: { anchor: Math.min(a, n), head: Math.min(b, n) }, scrollIntoView: true }); },
          focus() { view.focus(); },
          replace(from, to, text) { view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input' }); },
          setRangeText(text, from, to) { view.dispatch({ changes: { from, to, insert: text } }); },
          undo() { CM.undo(view); view.focus(); },
          redo() { CM.redo(view); view.focus(); },
          complete() { CM.startCompletion(view); },
          closest: () => null,
          addEventListener() {}, classList: { add() {}, remove() {}, contains: () => false },
        };
      },
      destroy() { view.destroy(); },
    };
  }
  return { create, ok: true };
})();
