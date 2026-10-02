/* OwoWorks live-backend config. NOT committed (see .gitignore).
   Copy this file to config.js and fill it in at deploy time. The anon key is
   public by design - RLS on the leads table enforces append-only. Without this
   file the page runs in demo mode and says so. */
window.OWOWORKS = {
  SUPABASE_URL: 'https://xyzcompany.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-key-here'
};
