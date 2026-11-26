/* ============================================================================
   LearnEra - Supabase configuration
   ----------------------------------------------------------------------------
   Paste the values from your own Supabase project:
     Supabase Dashboard -> Project Settings -> API
       * Project URL          -> SUPABASE_URL
       * Project API keys: anon / public -> SUPABASE_ANON_KEY

   IMPORTANT
   - Use ONLY the "anon public" key here. It is designed to be public and is
     protected by Row Level Security policies.
   - NEVER paste the "service_role" key into any file of this site. That key
     ignores every security rule and would give full database access to anyone.
   ========================================================================== */
window.LEARNERA_CONFIG = {
  SUPABASE_URL: "https://mwsgcxftmdgyqqpivrkp.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_h8s-YoYuVG_V0DWbJSEx9w_h56XS1Gj",

  // Storage buckets (created by supabase/schema.sql - change only if you renamed them)
  AVATAR_BUCKET: "avatars",
  CERTIFICATE_BUCKET: "certificates",
  COURSE_FILE_BUCKET: "course-files",
  SUBMISSION_BUCKET: "submissions"
};
