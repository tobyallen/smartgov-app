import { gateway } from '@ai-sdk/gateway';

// Single source of truth for which model every chat route uses. Switching
// models — Nova Pro to something else, or back — is just changing
// AI_GATEWAY_MODEL in the environment, no code change and no redeploy of
// logic. Keep this as the only place that reads the env var and picks the
// default, so /api/chat and /api/chat-admin can never drift out of sync by
// one of them getting edited and the other not.
const DEFAULT_MODEL = 'amazon/nova-pro';

export function chatModel() {
  return gateway(process.env.AI_GATEWAY_MODEL ?? DEFAULT_MODEL);
}
