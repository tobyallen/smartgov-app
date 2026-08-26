/**
 * post-login Action: on a user's first-ever login, assigns a real Auth0
 * role based on the persona they chose on the landing page - `citizen`
 * or `caseworker` - and exposes that role to the app as an ID token
 * claim. This is the app's only RBAC mechanism: it decides which MCP
 * tools the /admin surface even shows, before FGA gets a chance to
 * evaluate anything.
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
  const isFirstLogin = event.stats.logins_count === 1;
  if (!isFirstLogin) return;

  const requestedPersona = event.request.query?.persona;
  const persona = requestedPersona === 'caseworker' ? 'caseworker' : 'citizen';
  const roleId = persona === 'caseworker' ? event.secrets.CASEWORKER_ROLE_ID : event.secrets.CITIZEN_ROLE_ID;

  const ManagementClient = require('auth0').ManagementClient;
  const management = new ManagementClient({
    domain: event.secrets.DOMAIN,
    clientId: event.secrets.CLIENT_ID,
    clientSecret: event.secrets.CLIENT_SECRET,
  });

  await management.users.assignRoles({ id: event.user.user_id }, { roles: [roleId] });

  api.idToken.setCustomClaim('https://smartgov.apidays/persona', persona);
};
