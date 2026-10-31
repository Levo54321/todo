(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var BASE = 'https://holmlodge-shop.vercel.app/';
  var built = '';

  function key() { return (store.get('shopKey') || '').toLowerCase(); }
  function paint() {
    var pane = $('shoppingPane'); if (!pane) return;
    var k = key(), sig = k;
    if (built === sig && pane.innerHTML) return;
    built = sig;
    if (!k) {
      pane.innerHTML = '<div class="big" style="margin-top:14px">Shopping list</div>' +
        '<div class="rvsub">The shared family list. Enter your personal key once on this device.</div>' +
        '<form class="addform" id="shKeyForm" autocomplete="off"><input id="shKey" type="text" placeholder="xxxxx-xxxxx" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="20"><button type="submit">Open</button></form>';
      return;
    }
    pane.innerHTML = '<iframe id="shFrame" title="Shopping list" src="' + esc(BASE + '?embed=1#t=' + encodeURIComponent(k)) + '" style="width:100%;height:calc(100vh - 150px);min-height:420px;border:0;display:block;border-radius:12px"></iframe>' +
      '<div class="sethint" style="margin-top:8px"><a href="' + esc(BASE + '#t=' + encodeURIComponent(k)) + '" target="_blank">Open the list on its own</a> &middot; <a href="#" id="shChange">Change key</a></div>';
  }
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'shKeyForm') return;
    e.preventDefault();
    var v = ($('shKey').value || '').replace(/\s+/g, '').toLowerCase();
    if (!v) return;
    store.set('shopKey', v); built = ''; paint();
  }, false);
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'shChange') { e.preventDefault(); store.del ? store.del('shopKey') : store.set('shopKey', ''); built = ''; paint(); }
  }, false);

  App.register('shopping', { title: 'Shopping', render: paint, show: paint });
})();
