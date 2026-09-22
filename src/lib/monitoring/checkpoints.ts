import { firestore } from '../firebase-admin';

const CHECKPOINTS_COLLECTION = 'monitoringCheckpoints';
const LOCK_DOC_ID = 'lock';
const AUTH0_CHECKPOINT_DOC_ID = 'auth0';

// Vercel Cron does not guarantee no-overlap between scheduled
// invocations (a slow poll could still be running when the next one
// fires) - this is a short-lived single-flight lock, not a general
// distributed-lock primitive. 55s, just under the 60s poll interval, so
// a genuinely crashed/hung prior run's lock is treated as stale by the
// time the NEXT invocation arrives, rather than wedging the collector
// permanently.
const LOCK_TTL_MS = 55_000;

/**
 * Acquires the single-flight lock via a Firestore transaction (so two
 * concurrent invocations can't both see "no lock" and both proceed).
 * Returns false without throwing if another invocation currently holds
 * a non-stale lock - callers should treat that as "skip this run", not
 * an error.
 */
export async function acquireCollectorLock(): Promise<boolean> {
  const ref = firestore().collection(CHECKPOINTS_COLLECTION).doc(LOCK_DOC_ID);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lockedAt = snap.exists ? (snap.data()!.lockedAt as { toDate(): Date }).toDate() : null;
    if (lockedAt && Date.now() - lockedAt.getTime() < LOCK_TTL_MS) {
      return false;
    }
    tx.set(ref, { lockedAt: new Date() });
    return true;
  });
}

export async function releaseCollectorLock(): Promise<void> {
  await firestore().collection(CHECKPOINTS_COLLECTION).doc(LOCK_DOC_ID).delete();
}

export async function getAuth0Checkpoint(): Promise<string | null> {
  const doc = await firestore().collection(CHECKPOINTS_COLLECTION).doc(AUTH0_CHECKPOINT_DOC_ID).get();
  return (doc.data()?.lastLogId as string | undefined) ?? null;
}

/**
 * Only ever called AFTER a batch's events have been successfully written
 * to monitoringEvents (see route.ts) - if that write fails partway, this
 * is never reached, so the checkpoint stays put and the next poll
 * re-fetches from the same cursor. Combined with monitoringEvents using
 * the source log id as its own doc ID, re-processing overwrites rather
 * than duplicates, so this is safe to call again with the same value.
 */
export async function advanceAuth0Checkpoint(lastLogId: string): Promise<void> {
  await firestore()
    .collection(CHECKPOINTS_COLLECTION)
    .doc(AUTH0_CHECKPOINT_DOC_ID)
    .set({ lastLogId, updatedAt: new Date() });
}
