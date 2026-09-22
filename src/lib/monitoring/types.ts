export type MonitoringSeverity = 'info' | 'warning' | 'critical';

// One doc per normalized log line. Doc ID is the source's own event ID
// (Auth0 log `_id`) rather than an auto-generated ID, so re-processing
// the same batch after a partial-failure retry overwrites instead of
// duplicating — see monitoringCheckpoints below for why that matters.
export type MonitoringEventRecord = {
  source: 'auth0';
  type: string; // Auth0 log `type` code (e.g. 'f', 'ss', 'limit_wc')
  severity: MonitoringSeverity;
  summary: string;
  raw: Record<string, unknown>;
  createdAt: Date;
};

export type AlertStatus = 'active' | 'resolved';

// One doc per ruleId while status is 'active' — upserted on the ruleId,
// not written fresh on every poll. See evaluateAlertRules in alerts.ts.
export type MonitoringAlertRecord = {
  ruleId: string;
  severity: MonitoringSeverity;
  title: string;
  detail: string;
  count: number;
  windowStart: Date;
  windowEnd: Date;
  status: AlertStatus;
  createdAt: Date;
  updatedAt: Date;
};

// checkpoint doc: monitoringCheckpoints/auth0 — { lastLogId: string | null, updatedAt: Date }
// lock doc: monitoringCheckpoints/lock — { lockedAt: Date }
export type MonitoringCheckpoint = {
  lastLogId: string | null;
  updatedAt: Date;
};
