  // ---------- はじめ ----------
  (async () => {
    applyTheme();
    try { await DB.open(); } catch {}
    if (desk) {
      deskSt = await desk.status();
      desk.onChanged(() => { if (!editing) sync(true); else pendingReload = true; });
      desk.onStatus(st => { deskSt = st; if (tab === 'sync') render(); else updateBadge(); });
      desk.onToast(m => m && toast(m, 'warn'));
      document.documentElement.classList.add('desk');
    } else if (connected()) {
      const snap = await DB.get('snap:' + cfg.owner + '/' + cfg.repo + '@' + branch() + ':' + (cfg.prefix || ''));
      if (snap) S = snap;
    }
    recompute();
    ntSetup();
    render();
    sync(true);
    try { navigator.storage?.persist?.(); } catch {}
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      // 新しい版を公開したら：裏で取ってきて入れかわったときに1回だけ読み直す（書いている途中なら、次に開いたとき）
      const hadCtl = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadCtl || reloaded) return;
        const busy = editing || document.querySelector('#notesView .nt-editor:focus') || $('#sheet').open;
        if (busy) { toast('新しい版があります。アプリを開き直すと入れかわります'); return; }
        reloaded = true; location.reload();
      });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => {
        r.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
      }).catch(() => {});
    }
  })();
})();
