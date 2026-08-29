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
  // Same records the dashboard used to seed inline, so existing demo sessions
  // keep the data they already have. dashboard.html's seedDemo() checks the
  // same flag and becomes a no-op once this has run.
  function seed(force) {
    if (!force && localStorage.getItem(SEED_FLAG) === '1') return;

    var HOUR = 3600 * 1000;
    var DAY = 24 * HOUR;
    var now = Date.now();

    write(K.users, [
      {id:'u1', name:'Tej (Founder)',   email:'tej@xspace.co',     role:'founder', phone:'9000000101', photo:'', presence:'online', active:true, details:'Full portal access'},
      {id:'u2', name:'Karthik (Core)',  email:'karthik@xspace.co', role:'core',    phone:'9000000102', photo:'', presence:'online', active:true, details:'Permission: Edit'},
      {id:'u3', name:'Sai (Agent)',     email:'sai@xspace.co',     role:'agent',   phone:'9000000103', photo:'', presence:'away',   active:true, details:'Areas: Tellapur, Nallagandla | Types: Flats'},
      {id:'u4', name:'Priya (Creator)', email:'priya@xspace.co',   role:'creator', phone:'9000000104', photo:'', presence:'online', active:true, details:'Platform: Instagram | Handle: @priya.realty'},
      {id:'u5', name:'Studio Team',     email:'studio@xspace.co',  role:'studio',  phone:'9000000105', photo:'', presence:'online', active:true, details:'Role: Camera / VR | Availability: Mon-Sat'}
    ]);

    write(K.projects, [
      {id:'p1', name:'MyHome Avatar', builder:'MyHome', rera:'P02200002975', status:'Under Construction', units:500},
      {id:'p2', name:'Vasavi Skyla', builder:'Vasavi', rera:'P022000XXXXX', status:'Ready', units:120}
    ]);

    write(K.listings, [
      {id:'l1', title:'2BHK Tellapur', projectId:'p1', area:'Tellapur', price:'1.15 Cr', unitType:'2BHK', status:'Available', verified:false, assignedAgent:'u3', submittedBy:'u3'},
      {id:'l2', title:'3BHK Nallagandla', projectId:'p2', area:'Nallagandla', price:'1.9 Cr', unitType:'3BHK', status:'Ready', verified:true, assignedAgent:'u3', submittedBy:'u2'},
      {id:'l3', title:'Standalone Apartment', projectId:'p1', area:'Miyapur', price:'68 L', unitType:'2BHK', status:'Available', verified:false, assignedAgent:'u4', submittedBy:'u4'}
    ]);

    write(K.leads, [
      {id:'c1', name:'Ramesh', phone:'9000000001', source:'Instagram', budget:'1.5 Cr', status:'Discovery',  temperature:'hot',  assignedAgent:'u3', createdAt: now - HOUR,     listingId:'l1'},
      {id:'c2', name:'Sita',   phone:'9000000002', source:'Referral',  budget:'2 Cr',   status:'Engaged',    temperature:'warm', assignedAgent:'u3', createdAt: now - DAY,      listingId:'l2'},
      {id:'c3', name:'Rahul',  phone:'9000000003', source:'Website',   budget:'1.1 Cr', status:'Site Visit', temperature:'cold', assignedAgent:'u3', createdAt: now - 2 * HOUR, listingId:'l1'},
      {id:'c4', name:'Anita',  phone:'9000000004', source:'Referral',  budget:'2.5 Cr', status:'Closed',     temperature:'hot',  assignedAgent:'u3', createdAt: now - 5 * DAY,  listingId:'l2'}
    ]);

    write(K.contributed, [
      {id:'lc1', agentId:'u3', name:'Network - Reddy', createdAt: now - 5 * DAY},
      {id:'lc2', agentId:'u3', name:'Friend - Mohan',  createdAt: now - 20 * DAY}
    ]);

    write(K.visits, [
      {id:'v1', agentId:'u3', listingId:'l1', clientId:'c1', mode:'On-site', status:'Completed',   scheduledAt: now - DAY,          endedAt: now - DAY + HOUR,      feedbackSubmittedAt: now - DAY + HOUR + 10 * 60 * 1000},
      {id:'v2', agentId:'u3', listingId:'l2', clientId:'c2', mode:'VR',      status:'Completed',   scheduledAt: now - 2 * DAY,      endedAt: now - 2 * DAY + HOUR,  feedbackSubmittedAt: now - 2 * DAY + HOUR + 45 * 60 * 1000},
      {id:'v3', agentId:'u3', listingId:'l1', clientId:'c3', mode:'On-site', status:'Scheduled',   scheduledAt: now + 6 * HOUR,     endedAt: null,                  feedbackSubmittedAt: null}
    ]);

    write(K.submissions, [
      {id:'ls1', agentId:'u3', listingId:'l3', title:'2BHK Gated Tellapur', createdAt: now - 6 * DAY,  firstPassApproved:true},
      {id:'ls2', agentId:'u3', listingId:'l4', title:'3BHK Newbuild',       createdAt: now - 10 * DAY, firstPassApproved:false}
    ]);

    write(K.activity, [
      {id:'a1', text:'Agent Sai added 2BHK Tellapur', time: now - HOUR},
      {id:'a2', text:'Core Karthik verified project MyHome Avatar', time: now - 2 * HOUR}
    ]);

    write(K.notifications, [
      {id:'n1', type:'approval', title:'Price change request — 3BHK Nallagandla', body:'Agent requested -5% price change', role:'founder', read:false, ts: now - 400000},
      {id:'n2', type:'lead', title:'New lead: Ramesh', body:'Source: Instagram — budget 1.5 Cr', role:'agent', read:false, ts: now - 350000}
    ]);

    write(K.tickets, [
      {id:'t1', title:'Price mismatch for 2BHK Tellapur', category:'listing', priority:'high',   raiser:'u3', status:'open', createdAt: now - 5 * HOUR},
      {id:'t2', title:'Need RERA docs for MyHome Avatar', category:'legal',   priority:'medium', raiser:'u2', status:'open', createdAt: now - DAY}
    ]);

    write(K.verifications, [
      {id:'ver1', listingId:'l1', projectId:'p1', type:'Listing', status:'pending',    assignedTo:null, createdAt: now - 6 * HOUR,  startedAt:null,               finishedAt:null,               notes:'Price check pending', escalated:false},
      {id:'ver2', listingId:'l2', projectId:'p2', type:'Project', status:'inprogress', assignedTo:'u2', createdAt: now - 12 * HOUR, startedAt: now - 11 * HOUR,   finishedAt:null,               notes:'Verifying RERA',      escalated:false},
      {id:'ver3', listingId:'l2', projectId:'p2', type:'Project', status:'verified',   assignedTo:'u2', createdAt: now - 48 * HOUR, startedAt: now - 47 * HOUR,   finishedAt: now - 46 * HOUR,   notes:'OK',                  escalated:false}
    ]);

    write(K.audit, [
      {id:'ad1', text:'Listing l2 marked verified by u2', ts: now - 6 * HOUR},
      {id:'ad2', text:'User u4 created content draft for p1', ts: now - 12 * HOUR}
    ]);

    write(K.commissions, [
      {agent:'Sai',     agentId:'u3', pending:'₹45,000', paid:'₹1,20,000'},
      {agent:'Karthik', agentId:'u2', pending:'₹10,000', paid:'₹55,000'}
    ]);

    write(K.studio, [
      {id:'s1', title:'Project p1 — Drone Shoot', status:'Pending'},
      {id:'s2', title:'Project p2 — Photography', status:'In Progress'},
      {id:'s3', title:'Edit: p1 Walkthrough', status:'Pending'}
    ]);

    localStorage.setItem(SEED_FLAG, '1');
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
