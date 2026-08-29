# Connecting the portal to Supabase (free tier)

Everything below fits inside the free plan: 500 MB database, 1 GB file storage,
50,000 monthly active users, 2 active projects.

One free-tier quirk to know up front: **a free project pauses after 1 week with
no activity.** You unpause it from the dashboard in a click. A portal in daily
use never hits this; a project you leave alone between dev sessions will.

---

## 1. Create the project

1. Go to <https://supabase.com> → sign in with GitHub → **New project**.
2. Name it `xspace-portal`.
3. **Region: Mumbai (ap-south-1)** — closest to Hyderabad, so every query is
   ~30 ms instead of ~300 ms via the US.
4. Set a database password and save it in your password manager. You won't need
   it day to day, but it can't be recovered later.
5. Wait ~2 minutes for provisioning.

## 2. Create the schema

1. Left sidebar → **SQL Editor** → **New query**.
2. Paste the whole of [`schema.sql`](./schema.sql) and hit **Run**.

That creates the tables, the Row Level Security policies, and the
`listing-photos` storage bucket. The policies mirror `portal-db.js`: founder
sees and writes everything, everyone else is scoped to their own rows, and only
the founder manages team members — but enforced by Postgres, so it holds even
if a page forgets to check.

## 3. Create your login

1. **Authentication → Users → Add user**. Email `tej@xspace.co`, set a password,
   tick *Auto Confirm User*.
2. A trigger creates the matching profile as an **agent** — deliberately, so
   nobody can sign up as founder. Promote yourself in the SQL editor:

   ```sql
   update public.profiles
   set role = 'founder', name = 'Tej (Founder)'
   where email = 'tej@xspace.co';
   ```

3. Add the rest of the team the same way, then set each role
   (`core`, `agent`, `creator`, `studio`).

## 4. Get your API keys

**Project Settings → API**. You need two values:

| Value | Where it goes |
|---|---|
| Project URL (`https://xxxx.supabase.co`) | in the page — fine to expose |
| `anon` / publishable key | in the page — fine to expose |
| `service_role` key | **never** put this in the browser |

The anon key is *designed* to be public: it identifies your project, and RLS is
what actually restricts access. The `service_role` key bypasses RLS entirely —
it belongs only on a server, never in this repo or any page.

## 5. Lock the door before real data

Two settings that matter once real client records go in:

- **Authentication → Providers → Email**: turn **off** "Enable sign-ups".
  Otherwise anyone who finds the URL can create an account. You add staff
  manually, which is what you want for a private portal.
- **Authentication → URL Configuration**: set Site URL to your Vercel domain.

---

## 6. Wire it into the app

Add the client library to any page that needs data, before `portal-db.js`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="portal-config.js"></script>
<script src="portal-db.js"></script>
```

`portal-config.js` (already in the repo) holds the two public values.

Then `portal-db.js` becomes the only file that changes: its functions keep the
same names and are called from the same places, but read and write Supabase
instead of `localStorage`. They become async, so callers gain `await`:

```js
// before
var rows = XPortal.scoped('leads', ['assignedAgent']);

// after — the scoping is gone from the client entirely,
// because RLS already returned only the rows you may see
const { data: rows, error } = await supabase.from('leads').select('*');
```

That is the real payoff: `scoped()` disappears. The database decides.

**Photo uploads** are already built for this. `portal-image.js` compresses to
~85% smaller and hands back a blob; swap the localStorage thumbnail write in
`saveListing()` for:

```js
const { publicUrl } = await XImage.uploadToSupabase(supabase, 'listing-photos', result);
// then store publicUrl on the listing instead of a data URL
```

## 7. Verify the rules actually hold

Don't trust the UI for this — log in as an agent and check in the browser
console:

```js
const { data } = await supabase.from('leads').select('*');
console.log(data.length);   // must be only that agent's leads
```

If an agent sees every lead, RLS is not enabled on that table. Check with:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

Every row should read `true`.
