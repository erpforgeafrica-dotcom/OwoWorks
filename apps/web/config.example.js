/* OwoWorks live-backend config. NOT committed (see .gitignore).
   Copy this file to config.js and fill it in at deploy time. The publishable
   key is public by design - database grants and row-level security are the
   enforcement, and the only public write path is the submit_lead function.
   Without this file the form reports that it is not connected; it never
   pretends to have sent anything. */
window.OWOWORKS = {
  SUPABASE_URL: 'https://your-project-ref.supabase.co',
  SUPABASE_ANON_KEY: 'your-publishable-key'
};
