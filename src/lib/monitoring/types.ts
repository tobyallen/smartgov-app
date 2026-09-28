export type MonitoringSeverity = 'info' | 'warning' | 'critical';

// One event per normalized Auth0 log line, fetched fresh on every
// manual-refresh click (see snapshot/route.ts) - no longer persisted
// to Firestore. Doc-ID/checkpoint concerns from the earlier
// cron-and-Firestore design no longer apply.
export type MonitoringEventRecord = {
  source: 'auth0';
  type: string; // Auth0 log `type` code (e.g. 'f', 'ss', 'limit_wc')
  severity: MonitoringSeverity;
  summary: string;
  raw: Record<string, unknown>;
  createdAt: Date;
};
