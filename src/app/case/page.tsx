import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { cases } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { checkAndLog } from '@/lib/fga';
import { caseIdFor, ensureCitizenProvisioned } from '@/lib/provisioning';
import Link from 'next/link';

export default async function CasePage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-blue-600 underline">
          Log in to view your case
        </a>
      </main>
    );
  }

  const citizenUserId = session.user.sub;
  const { case: row } = await ensureCitizenProvisioned(citizenUserId);

  // The citizen's own view goes through the exact same wrapper as the
  // agent's — on the `owner` relation, which is always granted at
  // creation. This is deliberate, not decorative: it's what makes the
  // Access Log's "human viewed, allowed / agent requested, denied" pairing
  // meaningful rather than one side being real and the other cosmetic.
  await checkAndLog({
    citizenUserId,
    subject: `user:${citizenUserId}`,
    relation: 'owner',
    object: caseIdFor(row.id),
  });

  const fresh = await db.query.cases.findFirst({ where: eq(cases.id, row.id) });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Your case</h1>
      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="text-gray-500">Case ID</dt>
          <dd>{fresh?.id}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Status</dt>
          <dd>{fresh?.status}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Assessment date</dt>
          <dd>{fresh?.assessmentTime.toDateString()}</dd>
        </div>
      </dl>
      <div className="mt-6 flex gap-4 text-sm">
        <Link className="text-blue-600 underline" href="/chat">
          Talk to your assistant
        </Link>
        <Link className="text-blue-600 underline" href="/access-log">
          View access log
        </Link>
      </div>
    </main>
  );
}
