// 画面の部品で共通に使うもの（ブックマーク・テンプレート・ダッシュボード）
(() => {
  const icon = n => window.svgIcon(n);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // ボタン：content はアイコン名 / 文字 / [アイコン名, 文字] のどれか
  function btn(cls, content, onClick, title) {
    const b = el('button', cls);
    b.type = 'button';
    for (const c of [].concat(content ?? [])) {
      if (window.ICONS[c]) b.insertAdjacentHTML('beforeend', icon(c)); else b.append(c);
    }
    if (title) b.title = title;
    if (onClick) b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
    return b;
  }
  const withIcon = (tag, cls, ic, text) => { const e = el(tag, cls); e.innerHTML = icon(ic); e.append(text); return e; };

  // 下に出る小さなお知らせ
  let toastTimer = null;
  function toast(msg, kind = '') {
    let t = document.getElementById('toast') || document.getElementById('uiToast');   // MDWS: アプリのお知らせ欄を使う
    if (!t) { t = el('div'); t.id = 'uiToast'; document.body.append(t); }
    t.className = kind;
    t.innerHTML = icon(kind === 'warn' ? 'triangle-alert' : 'circle-check');
    t.append(msg);
    t.hidden = false;
    t.style.animation = 'none'; void t.offsetHeight; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // 名前を入れてもらう小さなダイアログ（Electron では prompt() が使えないため）
  // opts.max：入れられる文字数、opts.optional：空でもOK（空にすると消す、など）
  function askText(title, value = '', placeholder = '', opts = {}) {
    return new Promise(resolve => {
      const d = el('dialog', 'askDlg');
      const f = el('form');
      f.method = 'dialog';
      const inp = el('input', 'inp');
      inp.value = value; inp.placeholder = placeholder; inp.required = !opts.optional; inp.maxLength = opts.max || 60;
      const row = el('div', 'dlgBtns');
      const cancel = el('button', 'btn', 'キャンセル'); cancel.type = 'button'; cancel.addEventListener('click', () => d.close('cancel'));
      const ok = el('button', 'btn primary', 'OK'); ok.value = 'ok';
      row.append(el('span', 'spacer'), cancel, ok);
      f.append(el('h2', '', title), inp, row);
      d.append(f);
      document.body.append(d);
      d.addEventListener('close', () => { resolve(d.returnValue === 'ok' ? inp.value.trim() : null); d.remove(); });
      d.showModal();
      inp.select();
    });
  }

  // 入力中（文字入力欄にいる）かどうか
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

  window.UI = { el, btn, withIcon, icon, toast, askText, typing };
})();
