  // ================= ノートの画面（旧 Workstation の notes.js）とのつなぎ =================
  // 旧 Workstation の Mac 版 src/main/notes.js と同じ答えを、ここのデータ（GitHub／手元のフォルダ／お試し）で返す
  // ・スマホ版（GitHub）：書くたびに commit しないように、書くのが止まって少しあと（4秒）にまとめて送る
  // ・Mac 版：すぐフォルダに書く（commit・push は Mac 版の自動同期がまとめて行う）
  const Bridge = (() => {
    const WAIT = 4000;
    const timers = new Map();      // rel → 送るのを待っているタイマー（スマホ版）
    const vdirs = new Set();       // まだノートのないフォルダ（GitHub は空のフォルダを持てないので、この端末の中だけ）
    const listeners = [];
    const urls = new Map();        // 画像 rel → object URL
    const loading = new Set();
    const cleanName = x => String(x || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const baseName = rel => rel.split('/').pop().replace(/\.md$/i, '');
    const dirOf = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const unq = x => String(x).replace(/^["']|["']$/g, '').trim();
    const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); return { error: e.message || String(e) }; } };
    const err = m => { throw new Error(m); };

    // ---- Markdown から情報を取り出す（旧 Workstation と同じ） ----
    function parseFrontmatter(text) {
      const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
      if (!m) return { data: {}, body: text, quoted: [] };
      const data = {}, quoted = [];
      let key = null;
      for (const line of m[1].split(/\r?\n/)) {
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (item && key) { (Array.isArray(data[key]) ? data[key] : (data[key] = [])).push(unq(item[1])); continue; }
        const kv = /^([A-Za-z0-9_\-぀-ヿ一-鿿]+)\s*:\s*(.*)$/.exec(line);
        if (!kv) continue;
        key = kv[1];
        const v = kv[2].trim();
        if (!v) data[key] = [];
        else if (/^\[.*\]$/.test(v)) data[key] = v.slice(1, -1).split(',').map(x => unq(x.trim())).filter(Boolean);
        else { data[key] = unq(v); if (/^["'].*["']$/.test(v)) quoted.push(key); }
      }
      return { data, body: text.slice(m[0].length), quoted };
    }
    const stripCode = t => t.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ').replace(/`[^`\n]*`/g, ' ');
    function normUrl(u) { try { const x = new URL(String(u).trim()); if (!/^https?:$/.test(x.protocol)) return ''; return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); } catch { return ''; } }
    function parseNote(text) {
      const fm = parseFrontmatter(text);
      const body = stripCode(fm.body);
      const tags = new Set();
      for (const t of [].concat(fm.data.tags ?? fm.data.tag ?? [])) String(t).split(/[\s,]+/).filter(Boolean).forEach(x => tags.add(x.replace(/^#/, '')));
      for (const m of body.matchAll(/(^|[\s(（「、。,])#([^\s#.,;:!?()[\]{}"'`、。「」（）]+)/g)) if (!/^\d+$/.test(m[2])) tags.add(m[2]);
      const links = [], seenLink = new Set();
      for (const m of body.matchAll(/(!?)\[\[([^\]|#^\n]*)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) {
        const target = m[2].trim(), k = (m[1] ? '!' : '') + target;
        if (target && !seenLink.has(k)) { seenLink.add(k); links.push({ target, embed: !!m[1] }); }
      }
      const urls = [], seenUrl = new Set();
      const addUrl = (url, title = '') => { url = url.replace(/[.,;:!?]+$/, ''); const k = normUrl(url); if (!k || seenUrl.has(k) || urls.length >= 30) return; seenUrl.add(k); urls.push({ url, title: title.trim().slice(0, 80) }); };
      for (const m of body.matchAll(/(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g)) addUrl(m[2], m[1]);
      for (const m of body.matchAll(/https?:\/\/[^\s<>"'`)\]（）「」『』、。]+/g)) addUrl(m[0]);
      const h1 = /^#\s+(.+)$/m.exec(body);
      const excerpt = body.replace(/^#\s+.*$/m, '').replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, alias) => alias || t)
        .replace(/^>\s*\[![\w-]+\][+-]?/gm, '').replace(/^#{1,6}\s+/gm, '').replace(/<[^>]+>/g, ' ').replace(/[*_>`=~\[\]!|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      return { frontmatter: fm.data, fmQuoted: fm.quoted, tags: [...tags], links, urls, h1: h1 ? h1[1].trim() : '', excerpt };
    }
    function editListValues(text, key, fn) {
      const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
      const lines = m ? m[1].split(/\r?\n/) : [];
      const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`);
      let at = lines.findIndex(l => keyRe.test(l)), values = [], span = 0;
      if (at >= 0) {
        const v = keyRe.exec(lines[at])[1].trim(); span = 1;
        if (/^\[.*\]$/.test(v)) values = v.slice(1, -1).split(',').map(x => unq(x.trim())).filter(Boolean);
        else if (v) values = [unq(v)];
        else while (at + span < lines.length && /^\s*-\s+/.test(lines[at + span])) { values.push(unq(lines[at + span].replace(/^\s*-\s+/, ''))); span++; }
      }
      const nx = fn(values);
      if (!nx) return text;
      const q = v => (/[:#[\]{},]|^\s|\s$/.test(v) ? JSON.stringify(v) : v);
      const block = !nx.length ? [] : nx.length === 1 ? [`${key}: ${q(nx[0])}`] : [`${key}:`, ...nx.map(v => `  - ${q(v)}`)];
      if (at >= 0) lines.splice(at, span, ...block); else lines.push(...block);
      const body = m ? text.slice(m[0].length) : text;
      if (!lines.some(l => l.trim())) return body;
      return `---\n${lines.join('\n')}\n---\n` + body;
    }

    // ---- 一覧 ----
    const cache = new Map();   // rel → { text, info }
    function infoOf(rel) {
      const f = S.files[rel];
      let c = cache.get(rel);
      if (!c || c.text !== f.text) { c = { text: f.text, info: parseNote(f.text) }; cache.set(rel, c); }
      return c.info;
    }
    const mtimeOf = rel => { const f = S.files[rel]; if (f?.mtime) return f.mtime; const d = dayOf.get(rel); return d ? parseKey(d).getTime() + 12 * 3600e3 : 1; };
    function entry(rel) {
      if (!S.files[rel]) return null;
      const f = S.files[rel];
      return { path: rel, name: baseName(rel), folder: dirOf(rel), mtime: mtimeOf(rel), ctime: mtimeOf(rel), size: f.text.length, day: dayOf.get(rel) && isMainDaily(rel) ? dayOf.get(rel) : null, ...infoOf(rel) };
    }
    function folders() {
      const set = new Set([...(S.dirs || []), ...vdirs]);
      for (const p of [...Object.keys(S.files), ...Object.keys(S.bins || {})]) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/')); }
      return [...set].filter(d => d && !d.split('/').some(x => x.startsWith('.'))).sort();
    }
    const notesList = () => Object.keys(S.files);
    function resolve(target, from = '') {
      const t = String(target || '').trim().replace(/\.md$/i, '');
      if (!t) return null;
      const ns = notesList();
      if (t.includes('/')) { const w = (t + '.md').toLowerCase(); return ns.find(n => n.toLowerCase() === w) || ns.find(n => n.toLowerCase().endsWith('/' + w)) || null; }
      const hits = ns.filter(n => baseName(n).toLowerCase() === t.toLowerCase());
      if (hits.length <= 1) return hits[0] || null;
      return hits.find(n => dirOf(n) === dirOf(from)) || hits.sort((a, b) => a.length - b.length)[0];
    }
    function checkRel(rel, md = true) {
      const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!r || r.split('/').some(x => x === '..' || x === '' || x.startsWith('.'))) err('この場所は使えません');
      if (md && !/\.md$/i.test(r)) err('ノートは .md ファイルだけです');
      return r;
    }
    function uniquePath(folder, name) {
      const base = cleanName(name) || '無題のノート';
      for (let i = 0; i < 1000; i++) { const rel = (folder ? folder + '/' : '') + base + (i ? ' ' + i : '') + '.md'; if (!S.files[rel]) return rel; }
      err('ファイル名を決められませんでした');
    }

    // ---- 書く・消す・移す（ここで GitHub／フォルダに反映する） ----
    async function flush(rel) {
      const t = timers.get(rel);
      if (!t) return;
      clearTimeout(t); timers.delete(rel);
      await pushNow(rel);
    }
    async function flushAll() { await Promise.all([...timers.keys()].map(flush)); }
    // 送るのは1つのノートにつき1つずつ（重なると、古い版の印で送ってしまい「ほかで書きかえられた」になる）
    const queue = new Map(), busy = new Map(), lastSent = new Map();
    function enqueue(rel, fn) {
      busy.set(rel, (busy.get(rel) || 0) + 1);
      const run = (queue.get(rel) || Promise.resolve()).then(fn);
      const done = run.catch(() => {}).then(() => { const n = (busy.get(rel) || 1) - 1; if (n) busy.set(rel, n); else { busy.delete(rel); queue.delete(rel); } });
      queue.set(rel, done);
      return run;
    }
    // 送る：送っているあいだに書き足されていても、返ってきた最新の印（sha）を、いまのノートにつける
    async function sendNow(rel) {
      const f = S.files[rel];
      if (!f || !connected()) return;
      const text = f.text;
      if (lastSent.get(rel) === text + '\u0000' + f.sha) return;   // 同じ中身はもう一度送らない
      const sha = await putFile(rel, text, f.sha && f.sha !== 'demo' ? f.sha : null, `ノート: ${baseName(rel)}`);
      if (S.files[rel]) { S.files[rel].sha = sha; if (desk && S.files[rel].text === text) S.files[rel].mtime = parseInt(sha, 10) || S.files[rel].mtime; }
      lastSent.set(rel, text + '\u0000' + sha);
    }
    async function pushNow(rel) {
      try {
        await enqueue(rel, () => sendNow(rel));
        await persist();
      } catch (e) {
        console.error(e);
        toast(e.status === 409 || e.status === 422 ? `「${baseName(rel)}」はほかで書きかえられていました。同期してから書き直してください` : `「${baseName(rel)}」を送れませんでした`, 'warn');
      }
    }
    // 送り終わるまで待つ（待っているタイマーもすぐ送る）
    async function settle(rel) { await flush(rel); try { await queue.get(rel); } catch {} }
    // 書く（新しく作るときも）。now = すぐ送る
    async function putText(rel, text, now) {
      const old = S.files[rel];
      S.files[rel] = { sha: old ? old.sha : null, text, mtime: Date.now() };
      recompute();
      if (!connected()) { S.files[rel].sha = S.files[rel].sha || 'demo'; return; }
      if (desk) { await enqueue(rel, () => sendNow(rel)); return; }
      clearTimeout(timers.get(rel));
      if (now || !old) { timers.delete(rel); await pushNow(rel); }
      else timers.set(rel, setTimeout(() => { timers.delete(rel); pushNow(rel); }, WAIT));
      persist();
    }
    async function delFile(rel, msg) {
      await flush(rel);
      const f = S.files[rel] || S.bins?.[rel];
      if (!f) return;
      if (connected()) {
        if (desk) { const r = await desk.remove(rel, msg); if (r.error) err(r.error); }
        else await gh(`${repoBase()}/contents/${encPath(fullPath(rel))}`, { method: 'DELETE', body: JSON.stringify({ message: msg || `削除: ${rel}`, sha: f.sha, branch: branch() }) });
      }
      delete S.files[rel]; if (S.bins) delete S.bins[rel];
      cache.delete(rel);
      recompute(); persist();
    }
    async function moveFile(from, to, msg) {
      if (from === to) return;
      await flush(from);
      const isMd = /\.md$/i.test(from);
      if ((isMd ? S.files[to] : S.bins?.[to]) && from.toLowerCase() !== to.toLowerCase()) err(`「${to.split('/').pop()}」はもうあります`);
      if (connected() && desk) {
        const r = await desk.move(from, to, msg); if (r.error) err(r.error);
        if (isMd) { S.files[to] = S.files[from]; delete S.files[from]; } else { S.bins[to] = S.bins[from]; delete S.bins[from]; }
      } else if (isMd) {
        const f = S.files[from];
        S.files[to] = { sha: null, text: f.text, mtime: Date.now() };
        if (connected()) { S.files[to].sha = await putFile(to, f.text, null, msg || `移動: ${from} → ${to}`); }
        else S.files[to].sha = 'demo';
        delete S.files[from];
        if (connected()) await gh(`${repoBase()}/contents/${encPath(fullPath(from))}`, { method: 'DELETE', body: JSON.stringify({ message: msg || `移動: ${from} → ${to}`, sha: f.sha, branch: branch() }) });
      } else {
        // 画像（GitHub）：中身を読んで、新しい場所に書いてから消す
        const b = S.bins[from];
        if (connected()) {
          const blob = await gh(`${repoBase()}/git/blobs/${b.sha}`);
          const res = await gh(`${repoBase()}/contents/${encPath(fullPath(to))}`, { method: 'PUT', body: JSON.stringify({ message: msg || `移動: ${from} → ${to}`, content: blob.content.replace(/\s/g, ''), branch: branch() }) });
          await gh(`${repoBase()}/contents/${encPath(fullPath(from))}`, { method: 'DELETE', body: JSON.stringify({ message: msg || `移動: ${from} → ${to}`, sha: b.sha, branch: branch() }) });
          S.bins[to] = { sha: res.content.sha };
        } else S.bins[to] = b;
        delete S.bins[from];
        if (urls.has(from)) { urls.set(to, urls.get(from)); urls.delete(from); }
      }
      cache.delete(from);
      recompute(); persist();
    }
    async function mkdirReal(rel) {
      if (connected() && desk) { const r = await desk.mkdir(rel); if (r.error) err(r.error); S.dirs = [...new Set([...(S.dirs || []), rel])]; }
      else vdirs.add(rel);
    }
    // 中のノート・画像をまとめて移す（フォルダの名前を変える・移す）
    async function moveTree(from, to, msg) {
      const all = [...Object.keys(S.files), ...Object.keys(S.bins || {})].filter(p => p.startsWith(from + '/'));
      if (connected() && desk) {
        const r = await desk.move(from, to, msg); if (r.error) err(r.error);
        for (const p of all) { const q = to + p.slice(from.length); if (S.files[p]) { S.files[q] = S.files[p]; delete S.files[p]; } else { S.bins[q] = S.bins[p]; delete S.bins[p]; } }
        S.dirs = (S.dirs || []).map(d => (d === from || d.startsWith(from + '/') ? to + d.slice(from.length) : d));
      } else {
        for (const p of all) await moveFile(p, to + p.slice(from.length), msg);
        for (const d of [...vdirs]) if (d === from || d.startsWith(from + '/')) { vdirs.delete(d); vdirs.add(to + d.slice(from.length)); }
        S.dirs = (S.dirs || []).filter(d => !(d === from || d.startsWith(from + '/')));
        vdirs.add(to);
      }
      recompute(); persist();
    }
    // 名前を変える：ほかのノートの [[古い名前]] も書きかえる（旧 Workstation と同じ）
    async function rename(rel, newName, newFolder) {
      rel = checkRel(rel);
      if (!S.files[rel]) err('ノートが見つかりません');
      const folder = newFolder ?? dirOf(rel);
      const name = cleanName(newName);
      if (!name) err('名前を入れてください');
      const to = (folder ? folder + '/' : '') + name + '.md';
      if (to === rel) return { path: rel, updated: 0 };
      const before = notesList();
      const edits = [];
      for (const n of before) {
        if (n === rel) continue;
        let changed = false;
        const nx = S.files[n].text.replace(/(!?\[\[)([^\]|#^\n]+)((?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\])/g, (all, open, target, rest) => {
          if (resolve(target, n) !== rel) return all;
          changed = true;
          return open + (target.includes('/') ? to.replace(/\.md$/i, '') : name) + rest;
        });
        if (changed) edits.push([n, nx]);
      }
      await moveFile(rel, to, `名前を変更: ${rel} → ${to}`);
      for (const [n, nx] of edits) await putText(n, nx, true);
      return { path: to, updated: edits.length };
    }

    // ---- 画像 ----
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', pdf: 'application/pdf' };
    const b64ToBlob = (b64, rel) => new Blob([Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0))], { type: MIME[rel.split('.').pop().toLowerCase()] || 'application/octet-stream' });
    const bufToB64 = buf => { const b = new Uint8Array(buf); let s2 = ''; for (let i = 0; i < b.length; i += 0x8000) s2 += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s2); };
    function fileUrl(rel) {
      if (urls.has(rel)) return urls.get(rel);
      if (!loading.has(rel) && connected() && S.bins?.[rel]) {
        loading.add(rel);
        (async () => {
          try {
            const b64 = desk ? (await desk.readBin(rel)).value : (await gh(`${repoBase()}/git/blobs/${S.bins[rel].sha}`)).content;
            const u = URL.createObjectURL(b64ToBlob(b64, rel));
            urls.set(rel, u);
            document.querySelectorAll('img[data-vault]').forEach(im => { if (im.dataset.vault === rel) im.src = u; });
          } catch (e) { console.error(e); } finally { loading.delete(rel); }
        })();
      }
      return 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    }
    function attachmentFolder(noteRel = '') {
      let c = {}; try { c = JSON.parse(S.cfg?.['app.json'] || '{}') || {}; } catch {}
      const p = String(c.attachmentFolderPath ?? '/').trim(), nd = dirOf(noteRel || 'x');
      let f;
      if (!p || p === '/') f = ''; else if (p === '.' || p === './') f = nd; else if (p.startsWith('./')) f = [nd, p.slice(2)].filter(Boolean).join('/'); else f = p;
      return f.replace(/^\/+|\/+$/g, '').replace(/^\.$/, '');
    }
    async function saveImage(noteRel, name, bytes) {
      const ext = (String(name || '').split('.').pop() || 'png').toLowerCase();
      if (!/^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(ext)) err('画像（png・jpg・gif・webp・svg など）だけ入れられます');
      if (bytes.byteLength > 20 * 1024 * 1024) err('画像が大きすぎます（20MB まで）');
      const base = cleanName(String(name || '').replace(/\.[^.]+$/, '')) || 'Pasted image';
      const folder = attachmentFolder(noteRel);
      let rel = (folder ? folder + '/' : '') + base + '.' + ext;
      for (let i = 1; S.bins?.[rel]; i++) rel = (folder ? folder + '/' : '') + `${base} ${i}.${ext}`;
      const b64 = bufToB64(bytes);
      S.bins = S.bins || {};
      if (connected()) {
        if (desk) { const r = await desk.writeBin(rel, b64, `画像: ${rel}`); if (r.error) err(r.error); S.bins[rel] = { sha: r.value }; }
        else { const res = await gh(`${repoBase()}/contents/${encPath(fullPath(rel))}`, { method: 'PUT', body: JSON.stringify({ message: `画像: ${rel}`, content: b64, branch: branch() }) }); S.bins[rel] = { sha: res.content.sha }; }
      } else S.bins[rel] = { sha: 'demo' };
      urls.set(rel, URL.createObjectURL(b64ToBlob(b64, rel)));
      persist();
      const fname = rel.split('/').pop();
      const same = Object.keys(S.bins).filter(f => f.split('/').pop().toLowerCase() === fname.toLowerCase()).length;
      return { path: rel, link: same > 1 ? rel : fname };
    }
    const pickFiles = () => new Promise(res => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.addEventListener('change', () => res([...inp.files]));
      inp.click();
    });

    // ---- 本文の検索 ----
    function search(query, { matchCase = false, maxFiles = 200, perFile = 50 } = {}) {
      const q = String(query || '');
      if (!q.trim()) return { files: [], total: 0, more: false };
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
      const files = [];
      let total = 0;
      for (const rel of notesList()) {
        const text = S.files[rel].text || '';
        const hits = [];
        let count = 0, lineNo = 0, lineStart = 0, m;
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
          if (!m[0]) { re.lastIndex++; continue; }
          count++;
          if (hits.length >= perFile) continue;
          for (let i = text.indexOf('\n', lineStart); i !== -1 && i < m.index; i = text.indexOf('\n', lineStart)) { lineNo++; lineStart = i + 1; }
          const end = text.indexOf('\n', m.index);
          const line = text.slice(lineStart, end === -1 ? text.length : end);
          const col = m.index - lineStart, from = Math.max(0, col - 24);
          hits.push({ offset: m.index, line: lineNo, col, len: m[0].length, before: (from > 0 ? '…' : '') + line.slice(from, col).trimStart(), match: m[0], after: line.slice(col + m[0].length, col + m[0].length + 80) });
        }
        if (!count) continue;
        total += count;
        files.push({ path: rel, name: baseName(rel), folder: dirOf(rel), mtime: mtimeOf(rel), count, hits });
      }
      files.sort((a, b) => b.mtime - a.mtime);
      return { files: files.slice(0, maxFiles), total, more: files.length > maxFiles };
    }

    // ---- Obsidian の設定 ----
    function obsidianConfig() {
      const read = f => { try { return JSON.parse(S.cfg?.[f] || 'null'); } catch { return null; } };
      const tpl = read('templates.json') || {};
      let tf = String(tpl.folder || '').replace(/^\/+|\/+$/g, '');
      if (!tf && folders().includes('Templates')) tf = 'Templates';
      return { isVault: !!S.isVault || !!S.dailyJson, daily: { folder: dailyCfg.folder, format: dailyCfg.format, template: dailyCfg.template }, templatesFolder: tf, snippets: [] };
    }

    // ---- 旧 Workstation と同じ形の窓口（ctx.api.notes） ----
    const notes = {
      info: async () => ({ ready: true, root: connected() ? (desk ? deskSt?.folder || '' : `${cfg.owner}/${cfg.repo}`) : 'お試し', ...obsidianConfig() }),
      list: async () => ({ root: '', notes: notesList().map(entry).filter(Boolean), files: Object.keys(S.bins || {}), folders: folders() }),
      entries: async rels => [].concat(rels || []).map(r => ({ path: r, entry: entry(r) })),
      read: safe(async rel => { rel = checkRel(rel); const f = S.files[rel]; if (!f) err('ノートが見つかりません'); return { path: rel, text: f.text, mtime: mtimeOf(rel) }; }),
      search: safe(async (q, opt) => search(q, opt)),
      write: safe(async (rel, text, opt = {}) => {
        rel = checkRel(rel);
        if (opt.expectMtime != null && S.files[rel] && Math.abs(mtimeOf(rel) - opt.expectMtime) > 1) return { conflict: true, mtime: mtimeOf(rel) };
        await putText(rel, String(text));
        return { mtime: mtimeOf(rel), entry: entry(rel) };
      }),
      create: safe(async (folder = '', name = '', text = '') => { const rel = uniquePath(folder, name); await putText(rel, text, true); return { path: rel }; }),
      mkdir: safe(async rel => { rel = checkRel(rel, false); await mkdirReal(rel); return { path: rel }; }),
      rename: safe(rename),
      remove: safe(async rel => { await delFile(checkRel(rel), `削除: ${rel}`); return true; }),
      setProject: safe(async (rel, name, add) => {
        const t = S.files[rel]?.text ?? err('ノートが見つかりません');
        const nx = editListValues(t, 'project', vals => (vals.includes(String(name)) === !!add ? null : add ? [...vals, String(name)] : vals.filter(v => v !== String(name))));
        if (nx !== t) await putText(rel, nx, true);
        return { changed: nx !== t };
      }),
      move: safe(async (rel, folder) => rename(rel, baseName(rel), folder || '')),
      moveFolder: safe(async (rel, parent) => {
        parent = parent || '';
        if (parent === rel || parent.startsWith(rel + '/')) err('フォルダを自分の中には移動できません');
        const to = (parent ? parent + '/' : '') + rel.split('/').pop();
        if (to === rel) return { path: rel };
        if (folders().includes(to)) err(`「${parent || 'いちばん上'}」にはもう「${rel.split('/').pop()}」があります`);
        await moveTree(rel, to, `フォルダを移動: ${rel} → ${to}`);
        return { path: to };
      }),
      renameFolder: safe(async (rel, newName) => {
        const name = cleanName(newName); if (!name) err('名前を入れてください');
        const to = (dirOf(rel) ? dirOf(rel) + '/' : '') + name;
        if (to === rel) return { path: rel };
        if (folders().includes(to)) err(`「${name}」はもうあります`);
        await moveTree(rel, to, `フォルダの名前を変更: ${rel} → ${to}`);
        return { path: to };
      }),
      removeFolder: safe(async rel => {
        const all = [...Object.keys(S.files), ...Object.keys(S.bins || {})].filter(p => p.startsWith(rel + '/'));
        if (connected() && desk) { const r = await desk.rmdir(rel, `フォルダを削除: ${rel}`); if (r.error) err(r.error); for (const p of all) { delete S.files[p]; delete S.bins[p]; } }
        else for (const p of all) await delFile(p, `フォルダを削除: ${rel}`);
        for (const d of [...vdirs]) if (d === rel || d.startsWith(rel + '/')) vdirs.delete(d);
        S.dirs = (S.dirs || []).filter(d => !(d === rel || d.startsWith(rel + '/')));
        recompute(); persist();
        return true;
      }),
      daily: safe(async () => {
        const k = todayKey(), rel = dailyPathOf(k);
        if (S.files[rel]) return { path: rel, created: false };
        await putText(rel, newDailyText(k), true);
        return { path: rel, created: true };
      }),
      resolve: async (t, from) => resolve(t, from),
      saveImage: safe(saveImage),
      pickImage: safe(async noteRel => { const fs2 = await pickFiles(); const items = []; for (const f of fs2.slice(0, 20)) items.push(await saveImage(noteRel, f.name, await f.arrayBuffer())); return { items }; }),
      choose: async () => { if (desk) { deskSt = await desk.chooseFolder(); await sync(true); return notes.info(); } switchTab('sync'); return null; },
      useDefault: async () => ({ error: '「同期」から GitHub につなぐか、Mac 版でフォルダを選んでください' }),
    };
    if (desk) { notes.reveal = rel => desk.reveal(rel); notes.openInObsidian = rel => desk.openInObsidian(rel); }

    const SET_KEY = 'ws-notes.ntSettings';
    let onSet = () => {};
    let settings = (() => { try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch { return {}; } })();
    const api = {
      notes,
      // 変えたら描き直す（書く⇔読む・右のパネルなど、設定を変えるだけのボタンが効くように）
      settings: { set: async o => { settings = { ...settings, ...o }; try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch {} onSet(); return settings; } },
      app: {
        openUrl: u => { try { const x = new URL(String(u)); if (!/^https?:$/.test(x.protocol)) return; if (desk) desk.openExternal(x.href); else window.open(x.href, '_blank', 'noopener'); } catch {} },
        copy: t => navigator.clipboard?.writeText(String(t)),
      },
      on: { notes: cb => listeners.push(cb) },
    };
    return {
      api, fileUrl, flushAll, settle,
      get settings() { return settings; },
      set onSettings(fn) { onSet = fn; },
      // 送るのを待っている・送っている最中のノートは、同期で上書きしない
      pending: rel => timers.has(rel) || busy.has(rel),
      virtualDir: d => vdirs.has(d),
      notify: files => { for (const cb of listeners) { try { cb({ files }); } catch (e) { console.error(e); } } },
    };
  })();
  // 閉じる・ほかのアプリに切りかえるときは、待っている分をすぐ送る
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Promise.resolve(window.NotesApp?.flush?.()).catch(() => {}).then(() => Bridge.flushAll()); });
  window.addEventListener('pagehide', () => { Promise.resolve(window.NotesApp?.flush?.()).catch(() => {}).then(() => Bridge.flushAll()); });

  function setDone(it, done) {
    edit(it.path, t => (t == null ? null : MDParser.toggle(t, it.line, it.raw, done)), `${done ? '完了' : '未完了'}: ${it.title}`)
      .then(ok => { if (ok && done && navigator.vibrate) navigator.vibrate(12); });
  }
  // 今日のノートを作る（デイリーノートの設定・テンプレートを使う）
  function newDailyText(k) {
    const rel = dailyPathOf(k);
    const tp = Daily.findTemplate(dailyCfg, Object.keys(S.files));
    return tp ? Daily.fill(S.files[tp].text, parseKey(k), rel, dailyCfg) : '';
  }
  async function addTodoTo(k, v) {
    const rel = dailyPathOf(k);
    const ok = await edit(rel, t => MDParser.addTodo(t == null ? newDailyText(k) : t, v), `やること: ${v}`);
    if (ok) toast(`${relDay(k)}のノートに足しました`);
  }
  async function createDaily(k) {
    const rel = dailyPathOf(k);
    if (!S.files[rel]) await edit(rel, () => newDailyText(k) || `# ${nameOf(rel)}\n`, `ノートを作成: ${rel}`);
    openNote(rel);
  }

