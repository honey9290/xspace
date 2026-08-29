/*
 * portal-config.js — Supabase connection details.
 *
 * Both values below are PUBLIC by design: the anon key identifies the project,
 * and Row Level Security is what actually restricts access. See
 * supabase/schema.sql for the policies.
 *
 * NEVER put the service_role key here — it bypasses RLS completely and would
 * hand every record to anyone who views source.
 *
 * Fill these in from: Supabase Dashboard -> Project Settings -> API
 */
window.XSPACE_CONFIG = {
  SUPABASE_URL: '',      // e.g. https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: '', // the "anon" / publishable key

  PHOTO_BUCKET: 'listing-photos'
};

window.XSPACE_CONFIG.isConfigured = function () {
  return !!(window.XSPACE_CONFIG.SUPABASE_URL && window.XSPACE_CONFIG.SUPABASE_ANON_KEY);
};
