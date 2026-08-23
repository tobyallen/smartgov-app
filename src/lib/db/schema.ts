import { pgTable, text, timestamp, uuid, jsonb, boolean } from 'drizzle-orm/pg-core';

// One case per citizen, provisioned on first login.
export const cases = pgTable('cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  citizenUserId: text('citizen_user_id').notNull().unique(), // Auth0 `sub`
  assessmentTime: timestamp('assessment_time').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// One agent identity per citizen — the FGA subject representing "the
// citizen's AI assistant", distinct from the citizen's own `user` identity.
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  citizenUserId: text('citizen_user_id').notNull().unique(),
  fgaAgentId: text('fga_agent_id').notNull().unique(), // e.g. "agent:<userId>-assistant"
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Every policy decision (FGA check, tuple write, RBAC gate, OBO exchange)
// lands here exactly once, via checkAndLog(). The chat trace cards and the
// Access Log page are two renderings of this same table — not two logging
// paths.
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  citizenUserId: text('citizen_user_id').notNull(),
  eventType: text('event_type').notNull(), // 'check' | 'tuple_write' | 'tuple_delete' | 'obo_exchange'
  subject: text('subject').notNull(), // 'user:...' or 'agent:...'
  relation: text('relation'), // 'owner' | 'agent_delegate' | null for obo_exchange
  object: text('object'), // 'case:...' | null
  context: jsonb('context'), // condition context used, e.g. { current_time }
  decision: boolean('decision'), // null for writes/exchanges that don't have an allow/deny
  detail: jsonb('detail'), // free-form: token claims summary, denial reason, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
