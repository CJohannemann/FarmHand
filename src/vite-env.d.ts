/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * Which site this build is for — 'dev' on dev.farmhandmanager.com,
   * unset on the live one. Set by deploy/deploy.sh out of deploy.env
   * rather than by hand in a .env, so the two checkouts cannot drift.
   */
  readonly VITE_SITE_ENV?: string
  /** The short commit the build came from, for the dev banner. */
  readonly VITE_BUILD_COMMIT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
