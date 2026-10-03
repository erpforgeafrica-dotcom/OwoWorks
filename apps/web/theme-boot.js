/* No-flash theme boot. Stored choice wins, then the OS preference, then dark.
   Guarded so a blocked localStorage never breaks the page. Mirrors app.js.
   Loaded synchronously in <head> before the stylesheet so the first paint is
   already themed. External (not inline) so the page can ship a strict CSP. */
(function () {
  var theme = 'dark';
  try {
    var stored = localStorage.getItem('owoworks-theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
  } catch (e) { /* storage unavailable - stay dark */ }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.getElementById('themeColor');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f7f2' : '#04120b');
})();
