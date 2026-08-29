/*
 * portal-db.js — the single data + permission layer for the Xspace portal.
 *
 * Before this file existed, every page carried its own hardcoded array and its
 * own hardcoded role constant, so nothing persisted and permissions were
 * decorative. Everything now reads and writes one localStorage-backed store and
 * asks one permission table who is allowed to do what.
 *
 * Load this FIRST on every page, before any page script:
 *   <script src="portal-db.js"></script>
 *
 * NOTE: this is a front-end demo store. Anyone can edit localStorage in
 * devtools, so these checks shape the UI — they are not real security. Real
 * enforcement has to live on a server.
 */
(function (global) {
  'use strict';

  var SEED_FLAG = 'xspace_demo_seed';

  // ---------------------------------------------------------------- storage --
  var K = {
    users:        'xspace_users',
    projects:     'xspace_projects',
    listings:     'xspace_listings',
    leads:        'xspace_leads',
    contributed:  'xspace_leads_contributed',
    visits:       'xspace_visits',
    submissions:  'xspace_listing_submissions',
    activity:     'xspace_activity',
    notifications:'xspace_notifications',
    tickets:      'xspace_tickets',
    verifications:'xspace_verifications',
    audit:        'xspace_audit',
    commissions:  'xspace_commissions',
    studio:       'xspace_studio'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback === undefined ? [] : fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('portal-db: could not parse ' + key, e);
      return fallback === undefined ? [] : fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // localStorage is ~5 MB. Image thumbnails can reach it, and a failed
      // setItem otherwise throws mid-save and leaves the UI thinking it saved.
      var quota = e && (e.name === 'QuotaExceededError' ||
                        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                        e.code === 22 || e.code === 1014);
      if (quota) {
        var msg = 'Local storage is full. Older photos need removing before ' +
                  'saving more — this limit disappears once photos are stored ' +
                  'in Supabase rather than the browser.';
        console.error('portal-db: quota exceeded writing ' + key, e);
        if (typeof alert === 'function') alert(msg);
        throw new Error(msg);
      }
      throw e;
    }
    return value;
  }

  // Rough size of everything we've stored, for the storage meter in the UI.
  function usage() {
    var bytes = 0;
    Object.keys(K).forEach(function (name) {
      var raw = localStorage.getItem(K[name]);
      if (raw) bytes += raw.length;
    });
    return bytes;  // ~1 byte per char for the JSON we store
  }

  function uid(prefix) {
    return (prefix || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }

  // ------------------------------------------------------------------- seed --
  // The portal starts EMPTY. There is no demo data and no built-in account:
  // the first person to open the site creates the founder account, and every
  // other member is added by that founder from the Team page.
  //
  // This mirrors the Supabase setup exactly (see supabase/SETUP.md), where the
  // first user is promoted to founder and sign-ups are then closed.
  function seed(force) {
    if (!force && localStorage.getItem(SEED_FLAG) === '1') return;

    Object.keys(K).forEach(function (name) {
      write(K[name], []);
    });

    localStorage.setItem(SEED_FLAG, '1');
  }

  // Wipes every collection and signs out. Used by the founder's "Erase all
  // data" control in the Database console.
  function eraseAll() {
    seed(true);
    ['xspace_auth', 'xspace_role', 'xspace_user_id', 'xspace_user_name',
     'xspace_user_email', 'xspace_remember_email'].forEach(function (k) {
      localStorage.removeItem(k);
    });
  }

  // ------------------------------------------------------------------- auth --
  // DEMO AUTHENTICATION ONLY.
  //
  // Passwords are hashed with PBKDF2 rather than stored in the clear, which is
  // better than nothing, but the hash still sits in the visitor's own browser
  // and every check runs on their machine. This is NOT security — it stops a
  // casual look, not a determined one. Supabase Auth replaces all of it.
  var PBKDF2_ROUNDS = 120000;

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
      return ('00' + b.toString(16)).slice(-2);
    }).join('');
  }

  function randomSalt() {
    var a = new Uint8Array(16);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return toHex(a);
  }

  function hashPassword(password, salt) {
    var subtle = global.crypto && global.crypto.subtle;
    if (!subtle) {
      return Promise.reject(new Error(
        'This browser cannot hash passwords securely. Open the site over ' +
        'https:// or http://localhost.'
      ));
    }
    var enc = new TextEncoder();
    return subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return subtle.deriveBits({
          name: 'PBKDF2',
          salt: enc.encode(salt),
          iterations: PBKDF2_ROUNDS,
          hash: 'SHA-256'
        }, key, 256);
      })
      .then(toHex);
  }

  function hasAnyUser() {
    return read(K.users).length > 0;
  }

  function findByEmail(email) {
    var target = String(email || '').trim().toLowerCase();
    var users = read(K.users);
    for (var i = 0; i < users.length; i++) {
      if ((users[i].email || '').toLowerCase() === target) return users[i];
    }
    return null;
  }

  // First-run only. Refuses to run once any account exists, so this cannot be
  // used later to mint a second founder.
  function createFounder(details) {
    if (hasAnyUser()) {
      return Promise.reject(new Error('This portal is already set up. Ask the founder to add your account.'));
    }
    var salt = randomSalt();
    return hashPassword(details.password, salt).then(function (hash) {
      var user = {
        id: uid('u'),
        name: details.name,
        email: String(details.email).trim().toLowerCase(),
        phone: details.phone || '',
        role: 'founder',
        details: 'Portal owner — full access',
        photo: '',
        presence: 'online',
        active: true,
        salt: salt,
        passwordHash: hash,
        createdAt: Date.now()
      };
      insert('users', user);
      startSession(user);
      audit('Founder account created for ' + user.email);
      activity(user.name + ' set up the portal');
      return user;
    });
  }

  // Sets or resets a member's password. Founder-only at the call sites.
  function setPassword(userId, password) {
    var salt = randomSalt();
    return hashPassword(password, salt).then(function (hash) {
      return update('users', userId, { salt: salt, passwordHash: hash });
    });
  }

  function signIn(email, password) {
    var user = findByEmail(email);
    if (!user || !user.passwordHash) {
      // Same message either way — don't reveal which emails exist.
      return Promise.reject(new Error('Incorrect email or password.'));
    }
    if (user.active === false) {
      return Promise.reject(new Error('This account has been deactivated. Contact the founder.'));
    }
    return hashPassword(password, user.salt).then(function (hash) {
      if (hash !== user.passwordHash) throw new Error('Incorrect email or password.');
      startSession(user);
      return user;
    });
  }

  function startSession(user) {
    localStorage.setItem('xspace_auth', '1');
    localStorage.setItem('xspace_role', user.role);
    localStorage.setItem('xspace_user_id', user.id);
    localStorage.setItem('xspace_user_name', user.name);
    localStorage.setItem('xspace_user_email', user.email);
  }

  // -------------------------------------------------------------- migration --
  // A session seeded by an earlier build has records missing the fields the
  // newer pages read. Backfill them in place rather than wiping the store, so
  // anything the user already entered survives.
  function migrate() {
    var users = read(K.users);
    if (users.length) {
      var touched = false;
      users.forEach(function (u) {
        if (u.active === undefined)  { u.active = true; touched = true; }
        if (u.phone === undefined)   { u.phone = '';    touched = true; }
        if (u.details === undefined) { u.details = '';  touched = true; }
      });
      if (touched) write(K.users, users);
    }

    var listings = read(K.listings);
    if (listings.length) {
      var t2 = false;
      listings.forEach(function (l) {
        // Older rows only recorded assignedAgent; treat that as the submitter.
        if (l.submittedBy === undefined) { l.submittedBy = l.assignedAgent || null; t2 = true; }
      });
      if (t2) write(K.listings, listings);
    }

    var leads = read(K.leads);
    if (leads.length) {
      var t3 = false;
      leads.forEach(function (c) {
        if (c.temperature === undefined) { c.temperature = 'warm'; t3 = true; }
      });
      if (t3) write(K.leads, leads);
    }

    var visits = read(K.visits);
    if (visits.length) {
      var t4 = false;
      visits.forEach(function (v) {
        if (v.status === undefined) { v.status = v.endedAt ? 'Completed' : 'Scheduled'; t4 = true; }
        if (v.mode === undefined)   { v.mode = 'On-site'; t4 = true; }
      });
      if (t4) write(K.visits, visits);
    }
  }

  // ------------------------------------------------------------- permissions --
  // Founder is the superuser: every module, every record, full CRUD.
  // Everyone else is scoped to the records they own.
  var ROLES = {
    founder: {
      label: 'Founder',
      modules: ['dashboard','listings','clients','visits','creator','projects','legal','team','settings','analytics','database'],
      can: {
        'data.viewAll':   true,  // sees every record in every module
        'data.export':    true,
        'db.access':      true,  // the raw Database console
        'team.view':      true,
        'team.add':       true,
        'team.edit':      true,
        'team.delete':    true,
        'listings.create':true,
        'listings.edit':  true,
        'listings.verify':true,
        'listings.delete':true,
        'clients.create': true,
        'clients.edit':   true,
        'clients.delete': true,
        'visits.create':  true,
        'visits.manage':  true,
        'approve':        true,
        'impersonate':    true
      }
    },
    core: {
      label: 'Core Team',
      modules: ['dashboard','listings','clients','visits','creator','projects','legal','settings'],
      can: {
        'data.export':    true,
        'listings.create':true,
        'listings.edit':  true,
        'listings.verify':true,
        'clients.create': true,
        'clients.edit':   true,
        'visits.create':  true,
        'visits.manage':  true
      }
    },
    agent: {
      label: 'Agent',
      modules: ['dashboard','listings','clients','visits','settings'],
      can: {
        'data.export':    true,
        'listings.create':true,
        'clients.create': true,
        'visits.create':  true
      }
    },
    creator: {
      label: 'Creator',
      modules: ['dashboard','creator','clients','media','settings'],
      can: {
        'data.export':    true,
        'clients.create': true
      }
    },
    studio: {
      label: 'Studio',
      modules: ['dashboard','media','shoots','settings'],
      can: {
        'data.export': true
      }
    }
  };

  // ----------------------------------------------------------------- session --
  function role() {
    return (localStorage.getItem('xspace_role') || 'agent').toLowerCase();
  }

  function config() {
    return ROLES[role()] || ROLES.agent;
  }

  function isFounder() {
    return role() === 'founder';
  }

  function can(action) {
    return config().can[action] === true;
  }

  function hasModule(mod) {
    return config().modules.indexOf(mod) !== -1;
  }

  function currentUser() {
    var id = localStorage.getItem('xspace_user_id');
    var users = read(K.users);
    var found = null;
    if (id) {
      for (var i = 0; i < users.length; i++) {
        if (users[i].id === id) { found = users[i]; break; }
      }
    }
    if (!found) {
      // Fall back to the first user matching the session role.
      for (var j = 0; j < users.length; j++) {
        if ((users[j].role || '').toLowerCase() === role()) { found = users[j]; break; }
      }
      if (found) localStorage.setItem('xspace_user_id', found.id);
    }
    return found || {
      id: localStorage.getItem('xspace_user_id') || 'unknown',
      name: localStorage.getItem('xspace_user_name') || 'You',
      email: localStorage.getItem('xspace_user_email') || '',
      role: role()
    };
  }

  function isAuthed() {
    return localStorage.getItem('xspace_auth') === '1';
  }

  // Redirects to the login page when there is no session. Returns false so a
  // caller can bail out: `if (!XPortal.requireAuth()) return;`
  function requireAuth() {
    if (!isAuthed()) {
      window.location.replace('index.html');
      return false;
    }
    return true;
  }

  // Redirects to the dashboard when the role may not open this module.
  function requireModule(mod) {
    if (!requireAuth()) return false;
    if (!hasModule(mod)) {
      alert('Access denied. Your role (' + config().label + ') cannot open this module.');
      window.location.replace('dashboard.html');
      return false;
    }
    return true;
  }

  function logout() {
    ['xspace_auth','xspace_role','xspace_user_id','xspace_user_name','xspace_user_email']
      .forEach(function (k) { localStorage.removeItem(k); });
    window.location.href = 'index.html';
  }

  // ------------------------------------------------------------------ scoping --
  // Founder sees the whole table. Every other role sees only its own rows.
  function scoped(name, ownerFields) {
    // Accepts a collection name ('leads') or a raw storage key ('xspace_leads').
    var rows = read(K[name] || name);
    if (can('data.viewAll')) return rows;

    var me = currentUser().id;
    return rows.filter(function (row) {
      for (var i = 0; i < ownerFields.length; i++) {
        if (row[ownerFields[i]] === me) return true;
      }
      return false;
    });
  }

  // ------------------------------------------------------------------- audit --
  function audit(text) {
    var log = read(K.audit);
    log.unshift({ id: uid('ad'), text: text, ts: Date.now(), by: currentUser().id });
    write(K.audit, log.slice(0, 200));
  }

  function activity(text) {
    var feed = read(K.activity);
    feed.unshift({ id: uid('a'), text: text, time: Date.now() });
    write(K.activity, feed.slice(0, 100));
  }

  // -------------------------------------------------------------------- CRUD --
  function list(name) { return read(K[name]); }
  function save(name, rows) { return write(K[name], rows); }

  function insert(name, row) {
    var rows = read(K[name]);
    if (!row.id) row.id = uid(name.charAt(0));
    rows.push(row);
    write(K[name], rows);
    return row;
  }

  function update(name, id, patch) {
    var rows = read(K[name]);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        rows[i] = Object.assign({}, rows[i], patch);
        write(K[name], rows);
        return rows[i];
      }
    }
    return null;
  }

  function remove(name, id) {
    var rows = read(K[name]).filter(function (r) { return r.id !== id; });
    write(K[name], rows);
    return rows;
  }

  function find(name, id) {
    var rows = read(K[name]);
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }

  function userName(id) {
    var u = find('users', id);
    return u ? u.name : (id || '—');
  }

  // Whole-store helpers, used by the founder-only Database console.
  function exportAll() {
    var out = {};
    Object.keys(K).forEach(function (name) { out[name] = read(K[name]); });
    return out;
  }

  function importAll(obj) {
    Object.keys(K).forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(obj, name)) write(K[name], obj[name]);
    });
  }

  function resetAll() {
    seed(true);
  }

  // ------------------------------------------------------------------ export --
  global.XPortal = {
    KEYS: K,
    ROLES: ROLES,
    COLLECTIONS: Object.keys(K),

    seed: seed,
    eraseAll: eraseAll,
    hasAnyUser: hasAnyUser,
    findByEmail: findByEmail,
    createFounder: createFounder,
    setPassword: setPassword,
    signIn: signIn,
    resetAll: resetAll,
    exportAll: exportAll,
    importAll: importAll,

    usage: usage,
    list: list,
    save: save,
    insert: insert,
    update: update,
    remove: remove,
    find: find,
    scoped: scoped,
    userName: userName,
    uid: uid,

    role: role,
    roleLabel: function () { return config().label; },
    config: config,
    can: can,
    hasModule: hasModule,
    isFounder: isFounder,
    currentUser: currentUser,
    isAuthed: isAuthed,
    requireAuth: requireAuth,
    requireModule: requireModule,
    logout: logout,

    audit: audit,
    activity: activity
  };

  // Make sure a store exists as soon as this file loads, so any page can be
  // opened directly without going through the dashboard first, then bring any
  // older session's records up to the current shape.
  seed(false);
  migrate();
})(window);
