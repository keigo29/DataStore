// Mac と Windows の違いをまとめる
// ・キーの表記：画面・ツールチップ・ガイドの「⌘K」「⇧⌥↑」などを、Windows では「Ctrl+K」「Shift+Alt+↑」に書きかえる
//   （書いてある文字はそのまま Mac の表記にしておき、Windows のときだけ画面に出る文字を置きかえる）
// ・キーの判定：Mac は ⌘、Windows は Ctrl
(() => {
  // Windows で別のキーになるもの（VS Code の Windows と同じ）。長いものから先に置きかえる
  const SPECIAL = [
    ['⌥⌘F', 'Ctrl+H'],          // 置換
    ['⇧⌘G', 'Shift+F3'],        // 前の一致
    ['⌘G', 'F3'],               // 次の一致
    ['⌘⌫', 'Delete'],           // 削除
  ];
  const WORDS = [
    ['Finder', 'エクスプローラー'],
    ['Macに合わせる', 'Windowsに合わせる'],
    ['Macの設定に合わせる', 'Windowsの設定に合わせる'],
    ['Macの通知センターに表示', 'Windowsの通知に表示'],
    ['メニューバー', 'タスクトレイ'],
  ];
  const MODS = /[⌃⌥⇧⌘]+/g;
  // 「⇧⌘F」→「Ctrl+Shift+F」（Windows の並び：Ctrl → Shift → Alt）
  function forWindows(s) {
    let t = String(s);
    if (!/[⌃⌥⇧⌘]|Finder|Mac|メニューバー/.test(t)) return t;
    for (const [a, b] of SPECIAL) t = t.split(a).join(b);
    t = t.replace(MODS, m => (/[⌃⌘]/.test(m) ? 'Ctrl+' : '') + (m.includes('⇧') ? 'Shift+' : '') + (m.includes('⌥') ? 'Alt+' : ''));
    for (const [a, b] of WORDS) t = t.split(a).join(b);
    return t;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { forWindows }; return; }

  const platform = window.api?.platform || (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? 'darwin' : 'win32');   // MDWS: ブラウザでも判定
  const isMac = platform === 'darwin';
  document.documentElement.classList.add(isMac ? 'mac' : 'win');
  // ⌘ のキー（Mac は ⌘、Windows は Ctrl）
  const mod = e => (isMac ? e.metaKey : e.ctrlKey);
  const label = s => (isMac ? String(s) : forWindows(s));

  // Windows のとき：画面に出た文字・ツールチップ・入力欄の案内を書きかえる。
  // エディタの後ろの装飾（.nt-hl）は入力欄の文字と1文字ずつそろっている必要があるので触らない
  if (!isMac) {
    const SKIP = '.nt-hl, textarea, [contenteditable="true"]';
    const ATTRS = ['title', 'placeholder', 'aria-label'];
    const fixText = n => { if (/[⌃⌥⇧⌘]|Finder|Mac|メニューバー/.test(n.data) && !n.parentElement?.closest(SKIP)) { const v = forWindows(n.data); if (v !== n.data) n.data = v; } };
    const fixAttrs = e => { for (const a of ATTRS) { const v = e.getAttribute?.(a); if (v && /[⌃⌥⇧⌘]|Finder|Mac|メニューバー/.test(v)) { const w = forWindows(v); if (w !== v) e.setAttribute(a, w); } } };
    const fixTree = root => {
      if (root.nodeType === 3) return fixText(root);
      if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
      fixAttrs(root);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: n => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      for (let n; (n = w.nextNode());) { if (n.nodeType === 3) fixText(n); else fixAttrs(n); }
    };
    const start = () => {
      fixTree(document.body);
      new MutationObserver(list => {
        for (const m of list) {
          if (m.type === 'childList') m.addedNodes.forEach(fixTree);
          else if (m.type === 'characterData') fixText(m.target);
          else if (m.type === 'attributes') fixAttrs(m.target);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      // タイトル（document.title）も
      document.title = forWindows(document.title);
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  window.Keys = { isMac, mod, label, forWindows };
})();
