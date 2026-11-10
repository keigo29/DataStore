// デイリーノートの決まり（Mac の Workstation の src/main/notes.js と同じ計算）
// Obsidian の .obsidian/daily-notes.json（フォルダ・日付の書式・テンプレート）に合わせる
const Daily = (() => {
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const DATE_TOKENS = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DD|Do|D|dddd|ddd|dd|d|HH|mm|ss/g;
  const cleanName = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

  function formatDate(d, fmt = 'YYYY-MM-DD') {
    const p = n => String(n).padStart(2, '0');
    return fmt.replace(DATE_TOKENS, t => (t[0] === '[' ? t.slice(1, -1) : {
      YYYY: d.getFullYear(), YY: p(d.getFullYear() % 100), MMMM: `${d.getMonth() + 1}月`, MMM: `${d.getMonth() + 1}月`, MM: p(d.getMonth() + 1), M: d.getMonth() + 1,
      DD: p(d.getDate()), Do: `${d.getDate()}日`, D: d.getDate(), dddd: WD[d.getDay()] + '曜日', ddd: WD[d.getDay()], dd: WD[d.getDay()], d: d.getDay(),
      HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()),
    }[t]));
  }
  // 書式から、日付を読み取るための正規表現を作る
  function dateRegex(fmt) {
    const order = [];
    let re = '', last = 0;
    const lit = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of fmt.matchAll(DATE_TOKENS)) {
      re += lit(fmt.slice(last, m.index));
      last = m.index + m[0].length;
      const t = m[0];
      if (t[0] === '[') { re += lit(t.slice(1, -1)); continue; }
      const g = { YYYY: ['y', '(\\d{4})'], YY: ['y2', '(\\d{2})'], MMMM: ['m', '(\\d{1,2})月'], MMM: ['m', '(\\d{1,2})月'], MM: ['m', '(\\d{2})'], M: ['m', '(\\d{1,2})'],
        DD: ['d', '(\\d{2})'], Do: ['d', '(\\d{1,2})日'], D: ['d', '(\\d{1,2})'] }[t];
      if (g) { order.push(g[0]); re += g[1]; continue; }
      re += { dddd: '[日月火水木金土]曜日', ddd: '[日月火水木金土]', dd: '[日月火水木金土]', d: '[0-6]' }[t] || '\\d{2}';
    }
    re += lit(fmt.slice(last));
    return { re: new RegExp(`^${re}$`), order };
  }

  // daily-notes.json の中身（なければ Obsidian の初期値）
  function config(json) {
    let d = {};
    try { d = (typeof json === 'string' ? JSON.parse(json) : json) || {}; } catch {}
    return { folder: String(d.folder || '').replace(/^\/+|\/+$/g, ''), format: d.format || 'YYYY-MM-DD', template: d.template || '' };
  }
  // その日のノートの場所。書式の / はフォルダの区切り
  function pathOf(date, cfg) {
    const parts = formatDate(date, cfg.format).split('/').map(cleanName).filter(Boolean);
    return [cfg.folder, ...parts].filter(Boolean).join('/') + '.md';
  }
  // デイリーノートなら、その日（'YYYY-MM-DD'）。違えば null
  function dateOf(rel, cfg) {
    const pre = cfg.folder ? cfg.folder + '/' : '';
    if (!rel.startsWith(pre) || !/\.md$/i.test(rel)) return null;
    const { re, order } = dateRegex(cfg.format);
    if (!order.includes('m') || !order.includes('d')) return null;
    const m = re.exec(rel.slice(pre.length).replace(/\.md$/i, ''));
    if (!m) return null;
    const v = {};
    order.forEach((k, i) => { if (!(k in v)) v[k] = Number(m[i + 1]); });
    const now = new Date();
    let y = v.y ?? (v.y2 != null ? 2000 + v.y2 : now.getFullYear());
    if (v.y == null && v.y2 == null && new Date(y, v.m - 1, v.d) > now) y--;
    const date = new Date(y, v.m - 1, v.d);
    if (date.getMonth() !== v.m - 1 || pathOf(date, cfg) !== rel) return null;
    return formatDate(date, 'YYYY-MM-DD');
  }
  // テンプレートを埋める（{{date}} {{date:書式}} {{title}} {{time}}）
  function fill(tpl, date, rel, cfg) {
    const p = n => String(n).padStart(2, '0');
    return tpl
      .replace(/\{\{date(?::([^}]+))?\}\}/g, (_, f) => formatDate(date, f || cfg.format))
      .replace(/\{\{title\}\}/g, rel.split('/').pop().replace(/\.md$/i, ''))
      .replace(/\{\{time\}\}/g, `${p(date.getHours())}:${p(date.getMinutes())}`);
  }
  // テンプレートのファイルを探す（Obsidian と同じく、名前だけでも見つける）
  function findTemplate(cfg, paths) {
    if (!cfg.template) return null;
    const want = cfg.template.replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase();
    return paths.find(p => p.replace(/\.md$/i, '').toLowerCase() === want)
      || paths.find(p => p.split('/').pop().replace(/\.md$/i, '').toLowerCase() === want.split('/').pop()) || null;
  }

  return { formatDate, config, pathOf, dateOf, fill, findTemplate };
})();
if (typeof module !== 'undefined') module.exports = Daily;
