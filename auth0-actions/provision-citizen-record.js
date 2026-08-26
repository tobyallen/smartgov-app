/**
 * post-login Action: on a user's first-ever login, synchronously
 * provisions their case/agent Firestore records and FGA owner tuple by
 * calling this app's own /api/provisioning/sync route and awaiting the
 * response before returning - login genuinely blocks on this Action
 * finishing, so the citizen never lands on a "setting up your record"
 * spinner with no deterministic end.
 *
 * If the sync call fails, login still proceeds - a failed provisioning
 * attempt here is caught by the existing lazy ensureCitizenProvisioned()
 * call already made from /case and /chat, which is idempotent and safe
 * to call repeatedly. Never hard-fail a login over this.
 *
 * Requires Action Secrets: PROVISIONING_SYNC_URL (the deployed app's
 * https://<domain>/api/provisioning/sync), PROVISIONING_SYNC_SECRET
 * (must match the app's own PROVISIONING_SYNC_SECRET env var).
 */
exports.onExecutePostLogin = async (event) => {
  const isFirstLogin = event.stats.logins_count === 1;
  if (!isFirstLogin) return;

  try {
    await fetch(event.secrets.PROVISIONING_SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-provisioning-secret': event.secrets.PROVISIONING_SYNC_SECRET,
      },
      body: JSON.stringify({ userId: event.user.user_id }),
    });
  } catch {
    // Swallowed deliberately - see file header. The lazy provisioning
    // path on /case and /chat is the safety net.
  }
};
