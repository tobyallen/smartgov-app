SmartGov Citizen Portal — the workshop demo for apidays Australia 2026's session on securing AI agents and MCP tool calls with Auth0 and OpenFGA. A citizen signs up, talks to an AI assistant about their own tax record, and can grant (and revoke) the assistant delegated access via Auth0 FGA. See [the write-up](https://tobytes.com/articles/why-the-apidays-workshop-plan-restarted-from-scratch) for the reasoning behind the authorisation model.

## Stack

- Next.js (App Router) + TypeScript
- [Auth0](https://auth0.com/) for citizen login (`@auth0/nextjs-auth0`)
- [Auth0 FGA](https://auth0.com/fine-grained-authorization) for delegated authorisation — see `fga-model.fga`
- [Model Context Protocol](https://modelcontextprotocol.io/) server, exposed as a stateless Vercel Function (`src/app/api/mcp`)
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) routing to Amazon Bedrock's Nova Pro model for the chat assistant
- Postgres via [Neon](https://neon.tech/), [Drizzle ORM](https://orm.drizzle.team/)

## Deploying your own copy

Nothing in this repo is tied to a specific Auth0 tenant, FGA store, or database — every deployment creates its own. Rough order:

1. **Auth0 tenant** — create a free tenant if you don't have one.
   - Create a Regular Web App for the citizen portal. Note its client ID/secret and set `APP_BASE_URL` to wherever you're running it (e.g. `http://localhost:3000` locally, your Vercel URL in production), then add that as an Allowed Callback/Logout URL.
   - Register a Custom API (resource server) for `APP_API_AUDIENCE`.
   - Create a second, `resource_server`-type client for the OBO token exchange (`OBO_BACKEND_CLIENT_ID`/`SECRET`), with `token_exchange.allow_any_profile_of_type` enabled — this is deliberately not the same client as the citizen portal.
   - Create a `citizen` Role under User Management → Roles, and note its role ID.
   - Add the `auth0-actions/assign-citizen-role.js` script as a post-login Action, with an Action Secret named `CITIZEN_ROLE_ID` set to that role's ID (plus the usual `DOMAIN`/`CLIENT_ID`/`CLIENT_SECRET` secrets for a Management API client with `update:users` access).

2. **Auth0 FGA** — create a store at [dashboard.fga.dev](https://dashboard.fga.dev), write the model from `fga-model.fga`, and create an API client for it. Note the store ID, model ID, and client credentials.

3. **Database** — create a Neon Postgres project, use the pooled connection string, and run `npm run db:push` to apply the schema.

4. **Vercel AI Gateway** — get an API key from your Vercel account. No AWS credentials needed in this app; the Gateway calls Bedrock's Nova Pro model (`amazon/nova-pro`) using Vercel's own Bedrock access, not yours. To use a different model, change `AI_GATEWAY_MODEL` to any [model ID the Gateway supports](https://vercel.com/ai-gateway/models) — that's the only thing you need to change, in code or in your Vercel project's environment variables. All model selection is centralised in `src/lib/ai.ts`.

5. **Environment variables** — copy `ENV_TEMPLATE.md` into `.env.local` and fill in every value from steps 1-4. Nothing in this repo has default values for these; the app won't start without them.

6. **Run it**:
   ```bash
   npm install
   npm run dev
   ```
   Or deploy to Vercel and set the same variables in the project's Environment Variables settings.

## Repo layout

- `src/app/` — routes: citizen chat (`chat`), case view (`case`), delegation controls (`api/delegation`), the MCP server (`api/mcp`), and an access log (`access-log`)
- `fga-model.fga` — the Auth0 FGA authorisation model
- `auth0-actions/` — Auth0 Action source, deployed manually via the dashboard (not automated by this repo)
- `drizzle.config.ts`, `src/lib/db/` — database schema and migrations
