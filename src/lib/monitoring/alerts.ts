import { firestore } from '../firebase-admin';
import type { MonitoringAlertRecord, MonitoringSeverity } from './types';

const ALERTS_COLLECTION = 'monitoringAlerts';
const WINDOW_MS = 5 * 60 * 1000; // rolling 5-minute window, per the plan

const FAILED_LOGIN_THRESHOLD = 10; // per 5-minute window

type RuleResult = {
  ruleId: string;
  breaching: boolean;
  severity: MonitoringSeverity;
  title: string;
  detail: string;
  count: number;
};

/**
 * Auth/security-focused alert rules only (per the user's explicit
 * choice) - no general infra/APM signals. Each rule inspects the
 * current rolling window and reports whether it's currently breaching;
 * upsertAlert (below) is what actually creates/resolves the
 * monitoringAlerts doc, so a rule function never needs to know about
 * alert lifecycle, only "is this true right now."
 */
export async function evaluateAlertRules(now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  const [monitoringEvents, auditEvents] = await Promise.all([
    firestore()
      .collection('monitoringEvents')
      .where('createdAt', '>=', windowStart)
      .get(),
    firestore()
      .collection('auditEvents')
      .where('createdAt', '>=', windowStart)
      .get(),
  ]);

  const results: RuleResult[] = [
    failedLoginRule(monitoringEvents.docs.map((d) => d.data())),
    attackProtectionRule(monitoringEvents.docs.map((d) => d.data())),
    actionFailureRule(monitoringEvents.docs.map((d) => d.data())),
    oboFailureRule(auditEvents.docs.map((d) => d.data())),
    fgaDenialRule(auditEvents.docs.map((d) => d.data())),
  ];

  await Promise.all(results.map((r) => upsertAlert(r, windowStart, now)));
}

function failedLoginRule(events: Record<string, unknown>[]): RuleResult {
  const count = events.filter((e) => ['f', 'fu', 'fp'].includes(e.type as string)).length;
  return {
    ruleId: 'failed-login-rate',
    breaching: count >= FAILED_LOGIN_THRESHOLD,
    severity: 'warning',
    title: 'Elevated failed-login rate',
    detail: `${count} failed logins in the last 5 minutes (threshold: ${FAILED_LOGIN_THRESHOLD}).`,
    count,
  };
}

function attackProtectionRule(events: Record<string, unknown>[]): RuleResult {
  const matches = events.filter((e) => ['limit_wc', 'limit_mu', 'sepft'].includes(e.type as string));
  return {
    ruleId: 'attack-protection-block',
    breaching: matches.length > 0,
    severity: 'critical',
    title: 'Auth0 Attack Protection blocked traffic',
    detail:
      matches.length > 0
        ? `${matches.length} Attack Protection block(s) in the last 5 minutes — likely the conference-Wi-Fi shared-egress-IP risk (see build plan).`
        : 'No Attack Protection blocks in the last 5 minutes.',
    count: matches.length,
  };
}

function actionFailureRule(events: Record<string, unknown>[]): RuleResult {
  const matches = events.filter((e) => e.type === 'fce');
  return {
    ruleId: 'auth0-action-failure',
    breaching: matches.length > 0,
    severity: 'critical',
    title: 'Auth0 Action failed',
    detail:
      matches.length > 0
        ? `${matches.length} Action failure(s) in the last 5 minutes — check assign-persona-role.js/provision-citizen-record.js.`
        : 'No Action failures in the last 5 minutes.',
    count: matches.length,
  };
}

function oboFailureRule(auditEvents: Record<string, unknown>[]): RuleResult {
  const matches = auditEvents.filter(
    (e) => e.eventType === 'obo_exchange' && (e.detail as Record<string, unknown> | null)?.failed === true,
  );
  return {
    ruleId: 'obo-exchange-failure',
    breaching: matches.length > 0,
    severity: 'critical',
    title: 'OBO token exchange failing',
    detail:
      matches.length > 0
        ? `${matches.length} failed OBO exchange(s) in the last 5 minutes.`
        : 'No OBO exchange failures in the last 5 minutes.',
    count: matches.length,
  };
}

const FGA_DENIAL_THRESHOLD = 15; // per 5-minute window

function fgaDenialRule(auditEvents: Record<string, unknown>[]): RuleResult {
  // Excludes fail-closed infra errors (detail.infraError) - those are a
  // different signal (FGA/network health), not a security-relevant
  // denial spike. See fga.ts's checkAndLog for where that marker is set.
  const denials = auditEvents.filter(
    (e) =>
      e.eventType === 'check' &&
      e.decision === false &&
      (e.detail as Record<string, unknown> | null)?.infraError !== true,
  );
  return {
    ruleId: 'fga-denial-spike',
    breaching: denials.length >= FGA_DENIAL_THRESHOLD,
    severity: 'warning',
    title: 'Elevated FGA denial rate',
    detail: `${denials.length} FGA denials in the last 5 minutes (threshold: ${FGA_DENIAL_THRESHOLD}).`,
    count: denials.length,
  };
}

/**
 * One doc per ruleId while status is 'active', not one per poll — an
 * active alert's fields get updated in place until the rule stops
 * breaching, at which point it flips to 'resolved' rather than being
 * deleted (so the dashboard can show recently-resolved alerts too).
 */
async function upsertAlert(result: RuleResult, windowStart: Date, windowEnd: Date): Promise<void> {
  const ref = firestore().collection(ALERTS_COLLECTION).doc(result.ruleId);
  const existing = await ref.get();

  if (!result.breaching) {
    if (existing.exists && existing.data()?.status === 'active') {
      await ref.set({ status: 'resolved', updatedAt: windowEnd }, { merge: true });
    }
    return;
  }

  const record: Omit<MonitoringAlertRecord, 'createdAt'> & { createdAt?: Date } = {
    ruleId: result.ruleId,
    severity: result.severity,
    title: result.title,
    detail: result.detail,
    count: result.count,
    windowStart,
    windowEnd,
    status: 'active',
    updatedAt: windowEnd,
  };
  if (!existing.exists) {
    record.createdAt = windowEnd;
  }
  await ref.set(record, { merge: true });
}
