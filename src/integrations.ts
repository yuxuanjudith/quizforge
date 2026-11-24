/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * Every integration requires a signed-in caller. Set `anonymous: true` on a
 * 'developer' integration to let signed-out visitors call it too — the owner
 * then pays for anyone who can reach the app.
 *
 * Integrations not listed here default to 'developer' with sign-in required.
 *
 * IMPORTANT: any integration backed by per-user connected accounts (Google,
 * Composio) must be 'user' — the api-worker resolves the account from the
 * JWT subject. With 'developer' the app owner's JWT is forwarded, so every
 * signed-in user connects and acts on the app owner's account. Server code
 * that acts for a user in the background (e.g. a cron job) uses
 * `callComposio(env, ..., { asUser })` from 'deepspace/worker' instead.
 */

export const integrations: Record<
  string,
  {
    billing: 'developer' | 'user'
    anonymous?: boolean
    /**
     * QuizForge addition: refuse this integration on the browser-facing
     * /api/integrations proxy. Server actions still reach it through
     * `tools.integration`, so the owner only pays for calls our own code
     * makes, never for arbitrary prompts a signed-in user sends directly.
     */
    serverOnly?: boolean
  }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  // QuizForge: the app owner pays for model, search and speech calls, and
  // only server actions may make them (see `serverOnly`).
  anthropic: { billing: 'developer', serverOnly: true },
  exa: { billing: 'developer', serverOnly: true },
  elevenlabs: { billing: 'developer', serverOnly: true },
}
