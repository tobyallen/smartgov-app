import type { MonitoringEventRecord, MonitoringSeverity } from './types';

export type EvaluatedAlert = {
  ruleId: string;
  severity: MonitoringSeverity;
  title: string;
  detail: string;
  breaching: boolean;
  count: number;
};

const FAILED_LOGIN_THRESHOLD = 10; // per fetch, unchanged from prior versions

/**
 * Auth0-log-sourced rules only. The two auditEvents-sourced rules from
 * prior plans (fgaDenialRule, oboFailureRule) are deliberately dropped -
 * every correctness finding across five review rounds traced back to
 * them (a capped-query-vs-threshold mismatch, a null-vs-missing-field
 * filter semantics bug in a proposed count() fix, an undeclared
 * composite index). These three rules have never had a correctness
 * finding in any review. Stateless: takes the events from one fetch,
 * returns evaluated results - no Firestore read or write of its own,
 * no persisted alert lifecycle between calls (see monitoring-redesign-v6.md
 * for the accepted tradeoff this gives up).
 */
export function evaluateAuth0Alerts(events: MonitoringEventRecord[]): EvaluatedAlert[] {
  return [failedLoginRule(events), attackProtectionRule(events), actionFailureRule(events)];
}

function failedLoginRule(events: MonitoringEventRecord[]): EvaluatedAlert {
  const count = events.filter((e) => ['f', 'fu', 'fp'].includes(e.type)).length;
  return {
    ruleId: 'failed-login-rate',
    severity: 'warning',
    title: 'Elevated failed-login rate',
    detail: `${count} failed logins in this fetch (threshold: ${FAILED_LOGIN_THRESHOLD}).`,
    breaching: count >= FAILED_LOGIN_THRESHOLD,
    count,
  };
}

function attackProtectionRule(events: MonitoringEventRecord[]): EvaluatedAlert {
  const matches = events.filter((e) => ['limit_wc', 'limit_mu', 'sepft'].includes(e.type));
  return {
    ruleId: 'attack-protection-block',
    severity: 'critical',
    title: 'Auth0 Attack Protection blocked traffic',
    detail:
      matches.length > 0
        ? `${matches.length} Attack Protection block(s) — likely the conference-Wi-Fi shared-egress-IP risk (see build plan).`
        : 'No Attack Protection blocks.',
    breaching: matches.length > 0,
    count: matches.length,
  };
}

function actionFailureRule(events: MonitoringEventRecord[]): EvaluatedAlert {
  const matches = events.filter((e) => e.type === 'fce');
  return {
    ruleId: 'auth0-action-failure',
    severity: 'critical',
    title: 'Auth0 Action failed',
    detail:
      matches.length > 0
        ? `${matches.length} Action failure(s) — check assign-persona-role.js/provision-citizen-record.js.`
        : 'No Action failures.',
    breaching: matches.length > 0,
    count: matches.length,
  };
}
