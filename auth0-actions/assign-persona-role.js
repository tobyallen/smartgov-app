/**
 * post-login Action: assigns a real Auth0 role based on the persona the
 * user chose on the landing page - `citizen` or `caseworker` - and
 * exposes that role to the app as an ID token claim on every login. This
 * is the app's only RBAC mechanism: it decides which MCP tools the
 * /admin surface even shows, before FGA gets a chance to evaluate
 * anything.
 *
 * The role assignment (a Management API write) only needs to happen once
 * - gated on first-ever login via event.stats.logins_count === 1 - but
 * setCustomClaim does NOT persist across logins: it only affects the ID
 * token minted during the login flow it runs in. An earlier version of
 * this Action gated the *entire* handler (role assignment AND the claim)
 * on isFirstLogin, so every login after the first got an ID token with
 * no persona claim at all - personaFor() in src/lib/roles.ts then quietly
 * defaulted to 'citizen', and a real caseworker's second-ever login
 * landed them back on a citizen session with no error, just a wrong
 * role. Confirmed via this app's own /admin refusal page plus the debug
 * token viewer showing the claim missing entirely, then cross-checked
 * against auth0 api get users/.../roles showing the `caseworker` role
 * WAS correctly assigned - proving the role write worked and only the
 * claim was being skipped on repeat logins.
 *
 * Fix: the persona is only ever DECIDED from the query param on first
 * login (when it's meaningful - it's literally which button the visitor
 * clicked on the landing page). It's then stored in app_metadata and read
 * back from there on every subsequent login, never re-derived from the
 * query string again - a returning caseworker clicking a bare "log in"
 * link (no ?persona= param at all) must stay a caseworker, not silently
 * fall back to citizen because the param was absent this time.
 * setCustomClaim runs every login, sourced from app_metadata.persona.
 *
 * Self-healing backfill for accounts created under the old buggy
 * version (app_metadata.persona was never written, so it's missing even
 * though the role itself was correctly assigned on their real first
 * login): if app_metadata.persona is absent, prefer the user's EXISTING
 * assigned role (event.authorization.roles, reflecting Auth0's own
 * record of what they already have) over re-deriving from the query
 * param - only fall back to the query param/default if there's no
 * existing role either, i.e. this really is a first-ever login.
 *
 * Runs on post-login (not post-user-registration) deliberately -
 * post-login is synchronous/blocking and has the full api object;
 * post-user-registration is documented as asynchronous and can't
 * reliably set token claims before the signup redirect completes.
 *
 * Requires Action Secrets: DOMAIN, CLIENT_ID, CLIENT_SECRET (a
 * Management API client with update:users access - the existing
 * "SmartGov Action - Management API" client in this tenant), plus
 * CITIZEN_ROLE_ID and CASEWORKER_ROLE_ID (role IDs are tenant-specific).
 */
exports.onExecutePostLogin = async (event, api) => {
  let persona = event.user.app_metadata?.persona;

  if (!persona) {
    const ManagementClient = require('auth0').ManagementClient;
    const management = new ManagementClient({
      domain: event.secrets.DOMAIN,
      clientId: event.secrets.CLIENT_ID,
      clientSecret: event.secrets.CLIENT_SECRET,
    });

    const existingRoles = event.authorization?.roles ?? [];
    if (existingRoles.includes('caseworker')) {
      persona = 'caseworker';
    } else if (existingRoles.includes('citizen')) {
      persona = 'citizen';
    } else {
      const requestedPersona = event.request.query?.persona;
      persona = requestedPersona === 'caseworker' ? 'caseworker' : 'citizen';
      const roleId = persona === 'caseworker' ? event.secrets.CASEWORKER_ROLE_ID : event.secrets.CITIZEN_ROLE_ID;
      await management.users.assignRoles({ id: event.user.user_id }, { roles: [roleId] });
    }

    await management.users.update({ id: event.user.user_id }, { app_metadata: { persona } });
  }

  api.idToken.setCustomClaim('https://smartgov.apidays/persona', persona);
};
