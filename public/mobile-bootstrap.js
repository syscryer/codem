(function () {
  var isMobile = window.location.pathname === '/mobile' || window.location.pathname.indexOf('/mobile/') === 0;
  var mobileScope = new URL('/mobile/', window.location.origin).href;
  var isCodeMMobileWorker = function (registration) {
    var worker = registration.active || registration.waiting || registration.installing;
    return !!worker && new URL(worker.scriptURL).pathname === '/mobile-sw.js';
  };

  function removeLegacyRootWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.getRegistrations().then(function (registrations) {
      return Promise.all(registrations
        .filter(function (registration) { return isCodeMMobileWorker(registration) && registration.scope !== mobileScope; })
        .map(function (registration) { return registration.unregister(); }));
    }).catch(function () {});
  }

  if (!isMobile) {
    void removeLegacyRootWorker();
    return;
  }
  var refreshing = false;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    removeLegacyRootWorker().then(function () {
      return navigator.serviceWorker.getRegistration('/mobile/');
    }).then(function (registration) {
      if (!registration) return;
      registration.update().catch(function () {});
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }).catch(function () {});
  }

  function retryWithFreshShell() {
    var recovery = Promise.resolve();
    if ('serviceWorker' in navigator) {
      recovery = navigator.serviceWorker.getRegistrations().then(function (registrations) {
        return Promise.all(registrations
          .filter(isCodeMMobileWorker)
          .map(function (registration) { return registration.unregister(); }));
      });
    }
    recovery.then(function () {
      if (!('caches' in window)) return undefined;
      return caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (key) { return key.indexOf('codem-mobile-') === 0; }).map(function (key) { return caches.delete(key); }));
      });
    }).finally(function () {
      var url = new URL(window.location.href);
      url.searchParams.set('codem-recover', Date.now().toString());
      window.location.replace(url.toString());
    });
  }

  function showError(message) {
    var root = document.getElementById('root');
    if (!root || !root.querySelector('[data-codem-startup]')) return;
    root.innerHTML = '<main style="min-height:100dvh;display:grid;place-content:center;gap:12px;padding:24px;text-align:center;background:#f5f6f8;color:#242424;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><strong style="font-size:18px">移动伴侣启动失败</strong><span style="max-width:320px;color:#667085;font-size:14px;line-height:1.5">' + message + '</span><button id="codem-recover" style="min-height:44px;padding:0 18px;border:0;border-radius:14px;background:#247aff;color:white;font-weight:700">清理旧缓存并重试</button></main>';
    var recover = document.getElementById('codem-recover');
    if (recover) recover.addEventListener('click', retryWithFreshShell);
  }

  window.addEventListener('error', function (event) {
    showError('页面脚本加载失败，请确认手机和电脑已接入同一 tailnet 后重试。' + (event.message ? ' ' + event.message : ''));
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason && event.reason.message ? event.reason.message : '';
    showError('页面模块加载失败，请刷新后重试。' + (reason ? ' ' + reason : ''));
  });
  window.setTimeout(function () {
    showError('页面脚本没有完成加载（路径：' + window.location.pathname + '）。可能是旧版本缓存未清理。');
  }, 8000);
})();
