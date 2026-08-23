/**
 * post-login Action: ensures every authenticated user carries the
 * `citizen` role (RBAC coarse-scope layer). Idempotent — checks before
 * assigning, safe to run on every login including throwaway-email
 * first-time signups.
 *
 * Requires an Action Secret named CITIZEN_ROLE_ID, set to the role ID
 * of a "citizen" role you've created in this tenant (Auth0 Dashboard →
 * User Management → Roles). Role IDs are tenant-specific — this is not
 * something you can copy from another deployment.
 */
exports.onExecutePostLogin = async (event, api) => {
  const alreadyHasRole = event.authorization?.roles?.includes('citizen');
  if (alreadyHasRole) return;

  const ManagementClient = require('auth0').ManagementClient;
  const management = new ManagementClient({
    domain: event.secrets.DOMAIN,
    clientId: event.secrets.CLIENT_ID,
    clientSecret: event.secrets.CLIENT_SECRET,
  });

  await management.users.assignRoles(
    { id: event.user.user_id },
    { roles: [event.secrets.CITIZEN_ROLE_ID] },
  );
};
