import { gateway } from '@ai-sdk/gateway';
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai';

// Single source of truth for which model every chat route uses. Switching
// models — Nova Pro to something else, or back — is just changing
// AI_GATEWAY_MODEL in the environment, no code change and no redeploy of
// logic. Keep this as the only place that reads the env var and picks the
// default, so /api/chat and /api/chat-admin can never drift out of sync by
// one of them getting edited and the other not.
const DEFAULT_MODEL = 'amazon/nova-pro';

// Nova Pro has no distinct reasoning channel — it emits literal
// <thinking>...</thinking> text through the same channel as its actual
// answer. A system-prompt instruction not to do this reduced how often it
// happens but didn't eliminate it (confirmed via real testing: it recurred
// on a live "disable all contractors" prompt). extractReasoningMiddleware
// strips the tagged section out of the text stream unconditionally, at the
// model layer, so the chat UI never sees it regardless of whether the
// model obeys the instruction — a safety net, not a replacement for asking
// nicely.
export function chatModel() {
  return wrapLanguageModel({
    model: gateway(process.env.AI_GATEWAY_MODEL ?? DEFAULT_MODEL),
    middleware: extractReasoningMiddleware({ tagName: 'thinking' }),
  });
}
