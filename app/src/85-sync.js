  // ================= 同期・設定 =================
  // Mac 版の「同期」：ノートのフォルダと git
  function renderDeskSync(main) {
    const ago = ms => { if (!ms) return 'まだ'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'さっき' : m < 60 ? `${m}分前` : new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
    const p = panel();
    p.append(panelHead('folder', 'ノートのフォルダ'));
    const st = el('div', 'syncState');
    if (deskSt?.folder) st.append(el('b', '', sourceName()), el('small', 'pathLine', deskSt.folder));
    else st.append(el('b', '', 'まだ選んでいません'), el('small', '', 'いまはお試しのノートを表示しています。ナレッジの Markdown が入ったフォルダを選んでください'));
    p.append(st);
    const fb = el('div', 'shBtns');
    fb.append(btn(deskSt?.folder ? 'btn' : 'btn primary', ['folder', deskSt?.folder ? 'フォルダを変える' : 'フォルダを選ぶ'], async () => {
      deskSt = await desk.chooseFolder(); note = null; editing = false; S = { files: {}, dailyJson: null }; await sync(true);
    }));
    if (deskSt?.folder) fb.append(btn('btn', ['folder', 'Finder で開く'], () => desk.openFolder()));
    p.append(fb);
    p.append(el('div', 'foot', `ノート ${Object.keys(S.files).length} 件 ・ やること ${items.filter(i => i.type === 'todo').length} 件 ・ 予定 ${items.filter(i => i.type === 'event').length} 件`));
    main.append(p);
    if (!deskSt?.folder) return;

    const g = deskSt.git || {};
    const pg = panel();
    pg.append(panelHead('git-branch', 'GitHub との同期（git）'));
    if (!g.repo) {
      pg.append(noData('このフォルダは git のリポジトリではありません。ノートはフォルダに保存されますが、GitHub には送りません。'));
      const ol = el('ol', 'steps');
      ol.innerHTML = '<li>ターミナルでフォルダに移動して <code>git init</code></li><li>GitHub に<b>非公開</b>のリポジトリを作り <code>git remote add origin …</code></li><li><code>git add -A && git commit -m first && git push -u origin main</code></li><li>このアプリで「今すぐ同期」</li>';
      pg.append(ol);
    } else {
      const rows = [
        ['ブランチ', g.branch || '—'],
        ['送り先', g.remote || 'なし（commit だけします）'],
        ['まだ送っていない', `${(deskSt.pending || 0) + (g.changed || 0)} 件の変更${g.ahead ? ` ・ ${g.ahead} 件の commit` : ''}`],
        ['最後に取り込んだ', ago(g.lastPull)],
        ['最後に送った', ago(g.lastPush)],
      ];
      rows.forEach(([k, v]) => { const r = el('div', 'setRow'); r.append(el('span', '', k), el('small', 'sub', v)); pg.append(r); });
      if (g.error) pg.append(el('div', 'syncErr', g.error));
      const tg = el('label', 'setRow');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!deskSt.autoGit; cb.className = 'swt';
      cb.addEventListener('change', async () => { deskSt = await desk.setAuto(cb.checked); render(); });
      tg.append(el('span', '', '自動で同期する'), cb);
      pg.append(tg);
      pg.append(el('p', 'hint sub', '保存すると少しあとで commit・push し、開いたときと5分ごとに取り込みます。ほかのエディタで書きかえた分もまとめて送ります。'));
      const sb = el('div', 'syncBtns');
      sb.append(btn('btn primary', ['refresh-cw', syncing ? '同期しています…' : '今すぐ同期'], () => sync()));
      pg.append(sb);
    }
    main.append(pg);

    const t = panel();
    t.append(panelHead('sun', '表示'));
    const seg = el('div', 'seg');
    [['auto', 'Macに合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].forEach(([k, l]) =>
      seg.append(btn((cfg.theme || 'auto') === k ? 'on' : '', l, () => { cfg.theme = k; saveCfg(); applyTheme(); render(); })));
    t.append(seg);
    main.append(t);
  }

  function renderSync(main) {
    if (desk) return renderDeskSync(main);
    const p = panel();
    p.append(panelHead('folder-git-2', 'つないでいるリポジトリ'));
    const st = el('div', 'syncState');
    if (connected()) {
      st.append(el('b', '', `${cfg.owner}/${cfg.repo}`), el('small', '', `ブランチ ${branch()}${cfg.prefix ? ` ・ フォルダ ${cfg.prefix}` : ''}`));
      st.append(el('small', S.error ? 'bad' : '', S.error || (S.syncedAt ? `${new Date(S.syncedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} に同期` : 'まだ同期していません')));
    } else st.append(el('b', '', 'まだつないでいません'), el('small', '', 'いまはお試しのノートを表示しています'));
    p.append(st);
    const sb = el('div', 'syncBtns');
    if (connected()) sb.append(btn('btn primary', ['refresh-cw', syncing ? '同期しています…' : '今すぐ同期'], () => sync()));
    p.append(sb);
    p.append(el('div', 'foot', `ノート ${Object.keys(S.files).length} 件 ・ やること ${items.filter(i => i.type === 'todo').length} 件 ・ 予定 ${items.filter(i => i.type === 'event').length} 件`));
    main.append(p);

    const f = panel();
    f.append(panelHead('key-round', 'GitHub の設定'));
    const fld = (label, name, ph, type = 'text') => {
      const l = el('label', 'fld');
      const i = el('input', 'inp'); i.name = name; i.type = type; i.placeholder = ph; i.value = cfg[name] || ''; i.autocapitalize = 'off'; i.autocomplete = 'off'; i.spellcheck = false;
      l.append(el('span', '', label), i);
      return l;
    };
    const form = el('form');
    form.append(fld('オーナー（ユーザー名）', 'owner', 'keigo29'), fld('リポジトリ', 'repo', 'notes'),
      el('div', 'two'), fld('アクセストークン', 'token', 'github_pat_…', 'password'));
    form.children[2].append(fld('ブランチ', 'branch', 'main'), fld('読むフォルダ（空なら全部）', 'prefix', '例：Notes'));
    form.append(el('p', 'hint sub', 'Fine-grained token で「このリポジトリだけ」「Contents：Read and write」にしてください。トークンはこの端末の中だけに保存し、GitHub 以外には送りません。'));
    const bs = el('div', 'shBtns');
    bs.append(btn('btn primary', ['save', '保存してつなぐ'], () => form.requestSubmit()));
    if (connected()) bs.append(btn('btn danger', ['log-out', '外す'], () => { if (!confirm('この端末からつなぐ設定を消しますか？（GitHub のノートは消えません）')) return; cfg = { theme: cfg.theme }; saveCfg(); S = { files: {}, dailyJson: null }; note = null; sync(true); }));
    form.append(bs);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form).entries());
      for (const k of ['owner', 'repo', 'branch', 'prefix', 'token']) cfg[k] = String(v[k] || '').trim();
      saveCfg();
      if (!connected()) { toast('オーナー・リポジトリ・トークンを入れてください', 'warn'); return; }
      S = (await DB.get('snap:' + cfg.owner + '/' + cfg.repo + '@' + branch() + ':' + (cfg.prefix || ''))) || { files: {}, dailyJson: null };
      note = null;
      sync();
    });
    f.append(form);
    main.append(f);

    const t = panel();
    t.append(panelHead('sun', '表示'));
    const seg = el('div', 'seg');
    [['auto', 'Macに合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].forEach(([k, l]) =>
      seg.append(btn((cfg.theme || 'auto') === k ? 'on' : '', l, () => { cfg.theme = k; saveCfg(); applyTheme(); render(); })));
    t.append(seg);
    main.append(t);

    const h = panel();
    h.append(panelHead('info', '書き方'));
    h.innerHTML += `<ul class="steps">
      <li><code>- [ ] やること</code>：やること。デイリーノートに書くとその日の分</li>
      <li><code>@due(2026-11-20)</code> か <code>📅 2026-11-20</code>：期限</li>
      <li><code>- 14:00 MTG</code> / <code>- 10:00-12:00 面談</code>：予定（日付のあるノートや <code>## 2026-11-20</code> の見出しの下）</li>
      <li><code>#タグ</code>：やることの絞り込みに使えます</li></ul>`;
    main.append(h);
  }

