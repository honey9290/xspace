/*
 * portal-nav.js — shared chrome for the Xspace portal sub-pages.
 *
 * The sub-pages were standalone with no way back to the dashboard and no login
 * guard. Including this file gives every one of them the same top bar.
 * Requires portal-db.js to be loaded first.
 *
 * Usage: <script src="portal-nav.js"></script> just before </body>.
 */
(function () {
  'use strict';

  if (typeof window.XPortal === 'undefined') {
    console.error('portal-nav.js: load portal-db.js before this file.');
    return;
  }

  if (!XPortal.isAuthed()) {
    window.location.replace('index.html');
    return;
  }

  function build() {
    if (document.getElementById('portalNavBar')) return;

    var me = XPortal.currentUser();

    var style = document.createElement('style');
    style.textContent = [
      '#portalNavBar{position:sticky;top:0;z-index:9999;display:flex;align-items:center;',
      'gap:10px;padding:10px 20px;background:#0b0b0b;border-bottom:1px solid rgba(255,255,255,0.10);',
      'font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto;font-size:13px;color:#fff;',
      'box-sizing:border-box;flex-wrap:wrap}',
      '#portalNavBar a.pn-back{display:inline-flex;align-items:center;gap:6px;color:#fff;text-decoration:none;',
      'padding:6px 12px;border:1px solid rgba(255,255,255,0.16);border-radius:999px;white-space:nowrap}',
      '#portalNavBar a.pn-back:hover{background:rgba(255,255,255,0.08)}',
      '#portalNavBar a.pn-link{color:#9aa0a6;text-decoration:none;padding:6px 8px;border-radius:6px;white-space:nowrap}',
      '#portalNavBar a.pn-link:hover{color:#fff;background:rgba(255,255,255,0.06)}',
      '#portalNavBar a.pn-link.pn-current{color:#10b981}',
      '#portalNavBar .pn-spacer{flex:1}',
      '#portalNavBar .pn-user{color:#9aa0a6;white-space:nowrap}',
      '#portalNavBar .pn-role{margin-left:8px;border:1px solid rgba(255,255,255,0.16);border-radius:999px;',
      'padding:2px 8px;font-size:11px;color:#9aa0a6}',
      '#portalNavBar .pn-role.pn-founder{color:#10b981;border-color:rgba(16,185,129,.45)}',
      '#portalNavBar button.pn-logout{background:transparent;border:0;color:#9aa0a6;font:inherit;cursor:pointer;padding:6px 4px}',
      '#portalNavBar button.pn-logout:hover{color:#fff;text-decoration:underline}',
      '@media (max-width:720px){#portalNavBar .pn-user{display:none}}'
    ].join('');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'portalNavBar';

    var back = document.createElement('a');
    back.className = 'pn-back';
    back.href = 'dashboard.html';
    back.textContent = '← Dashboard';
    bar.appendChild(back);

    // Cross-links, filtered by what this role is allowed to open.
    var here = (window.location.pathname.split('/').pop() || '').toLowerCase();
    [
      { module: 'listings', href: 'listings.html',   text: 'Listings' },
      { module: 'clients',  href: 'client.html',     text: 'Clients' },
      { module: 'visits',   href: 'sitevisits.html', text: 'Site Visits' },
      { module: 'team',     href: 'teams.html',      text: 'Team' },
      { module: 'database', href: 'database.html',   text: 'Database' }
    ].forEach(function (item) {
      if (!XPortal.hasModule(item.module)) return;
      var a = document.createElement('a');
      a.className = 'pn-link' + (here === item.href ? ' pn-current' : '');
      a.href = item.href;
      a.textContent = item.text;
      bar.appendChild(a);
    });

    var spacer = document.createElement('span');
    spacer.className = 'pn-spacer';
    bar.appendChild(spacer);

    var user = document.createElement('span');
    user.className = 'pn-user';
    user.textContent = me.name || 'You';
    var tag = document.createElement('span');
    tag.className = 'pn-role' + (XPortal.isFounder() ? ' pn-founder' : '');
    tag.textContent = XPortal.roleLabel();
    user.appendChild(tag);
    bar.appendChild(user);

    var logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'pn-logout';
    logout.textContent = 'Logout';
    logout.addEventListener('click', function () { XPortal.logout(); });
    bar.appendChild(logout);

    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
