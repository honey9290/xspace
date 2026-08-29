# Xspace &amp; Co — Portal

Private internal portal for listings, clients, site visits and team management.
Plain HTML, CSS and JavaScript — no build step, no framework.

## Running locally

Serve the folder over HTTP (not `file://` — the app uses `localStorage` and the
Web Crypto API, both of which need a real origin):

```bash
python -m http.server 5173
# then open http://localhost:5173
```

## First run

The portal starts **completely empty** — no demo data, no built-in account.

1. Open the site. Because no accounts exist, you get a one-time **Set up your
   portal** form.
2. The account you create there becomes the **founder**: every module, every
   record, plus the Database console.
3. That form never appears again. `createFounder()` refuses once any account
   exists, so a second founder cannot be created through the UI.
4. Add everyone else from **Team**, setting their email and password.

> Whoever loads the deployed site first claims the founder account. Open your
> production URL yourself before sharing the link.

## Roles

| | Founder | Core | Agent | Creator | Studio |
|---|---|---|---|---|---|
| See all records | ✅ | — | — | — | — |
| See own records | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage team | ✅ | — | — | — | — |
| Database console | ✅ | — | — | — | — |
| Verify listings | ✅ | ✅ | — | — | — |

Founder is the only role with company-wide visibility. Everyone else is scoped
to rows they own, via `XPortal.scoped()`.

## Files

| File | Purpose |
|---|---|
| `portal-db.js` | The store, the seed, migrations, auth, and the role/permission table. Load first on every page. |
| `portal-nav.js` | Shared top bar, auth guard, role-filtered links. |
| `portal-image.js` | Browser-side photo compression (1600px WebP, ~85% smaller) before storage or upload. |
| `portal-config.js` | Supabase URL and anon key. Both are public by design; the `service_role` key must never go here. |
| `database.html` | Founder-only console over all 14 collections. |
| `supabase/schema.sql` | Postgres schema and Row Level Security policies. |
| `supabase/SETUP.md` | Step-by-step Supabase setup. |

## Deploying to Vercel

Import the repo at [vercel.com/new](https://vercel.com/new). Application Preset
**Other**; leave Build Command and Output Directory **empty** — it's static
files, there is nothing to build.

`vercel.json` sets security headers and disables caching for HTML and JS so a
deploy is visible immediately.

**`cleanUrls` is deliberately `false`.** With it on, Vercel redirects
`/dashboard.html` to `/dashboard`. Every internal link uses the `.html`
filename, and `portal-nav.js` decides which nav link to highlight by comparing
`location.pathname` against those filenames — so clean URLs would add a redirect
to every navigation and break the highlight.

Note also that `vercel.json` is validated against a strict schema that rejects
unknown properties. JSON has no comment syntax, and a `"//"` key **fails the
import**. Keep explanations here, not in that file.

## Current status

The data layer and login run entirely in the browser. `localStorage` is
per-device, so two people using the portal do not share data, and the
permission checks run on the user's own machine — they shape the UI but are
not security.

Passwords are hashed with PBKDF2-SHA256 (120,000 rounds, per-user salt) rather
than stored in the clear, which is better hygiene but does not change the above.

**Do not put real client records in until the Supabase backend is connected.**
See [`supabase/SETUP.md`](supabase/SETUP.md). Once it is, the permission rules
become Row Level Security policies that Postgres enforces, and `scoped()`
disappears from the client entirely — the database returns only permitted rows.
