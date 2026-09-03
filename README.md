SmartGov Citizen Portal — the workshop demo for apidays Australia 2026's session on securing AI agents and MCP tool calls with Auth0 and OpenFGA. A citizen signs up, talks to an AI assistant about their own tax record, and can grant (and revoke) the assistant delegated access via Auth0 FGA. See [the write-up](https://tobytes.com/articles/why-the-apidays-workshop-plan-restarted-from-scratch) for the reasoning behind the authorisation model.

## Stack

- Next.js (App Router) + TypeScript
- [Auth0](https://auth0.com/) for citizen login (`@auth0/nextjs-auth0`)
- [Auth0 FGA](https://auth0.com/fine-grained-authorization) for delegated authorisation — see `fga-model.fga`
- [Model Context Protocol](https://modelcontextprotocol.io/) server, exposed as a stateless Vercel Function (`src/app/api/mcp`)
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) routing to Amazon Bedrock's Nova Pro model for the chat assistant
- [Firestore](https://firebase.google.com/docs/firestore) (Firebase Admin SDK) for app state — cases, agent identities, the audit log. Never the source of truth for authorization; that's Auth0 FGA above.

## Deploying your own copy

Nothing in this repo is tied to a specific Auth0 tenant, FGA store, or Firebase project — every deployment creates its own. Rough order:

1. **Auth0 tenant** — create a free tenant if you don't have one.
   - Create a Regular Web App for the citizen portal. Note its client ID/secret and set `APP_BASE_URL` to wherever you're running it (e.g. `http://localhost:3000` locally, your Vercel URL in production), then add that as an Allowed Callback/Logout URL.
   - Register a Custom API (resource server) for `APP_API_AUDIENCE`.
   - Create a second, `resource_server`-type client for the OBO token exchange (`OBO_BACKEND_CLIENT_ID`/`SECRET`), with `token_exchange.allow_any_profile_of_type` enabled — this is deliberately not the same client as the citizen portal.
   - Create `citizen` and `caseworker` Roles under User Management → Roles, and note both role IDs.
   - Add `auth0-actions/assign-persona-role.js` and `auth0-actions/provision-citizen-record.js` as post-login Actions, both gated to run once on first login only. `assign-persona-role.js` needs Action Secrets `DOMAIN`/`CLIENT_ID`/`CLIENT_SECRET` (a Management API client with `update:users` access) plus `CITIZEN_ROLE_ID`/`CASEWORKER_ROLE_ID`. `provision-citizen-record.js` needs `PROVISIONING_SYNC_URL` (your deployed app's `/api/provisioning/sync` URL) and `PROVISIONING_SYNC_SECRET` (matching the app's own env var of the same name). Both Actions read the persona the visitor chose on the landing page (`?persona=citizen`/`?persona=caseworker` on `/auth/login`, forwarded to `/authorize` and read from `event.request.query.persona`) — deliberately on `post-login`, not `post-user-registration`, since only `post-login` is synchronous/blocking with a full `api` object; `post-user-registration` is documented as asynchronous and can't reliably finish before the signup redirect completes.
   - Via the [Auth0 CLI](https://github.com/auth0/auth0-cli): `auth0 roles create --name citizen`, `auth0 roles create --name caseworker`, then `auth0 actions create --name "Assign Persona Role" --trigger post-login --code "$(cat auth0-actions/assign-persona-role.js)" --dependency "auth0=4.37.1" --secret "CITIZEN_ROLE_ID=<id>" --secret "CASEWORKER_ROLE_ID=<id>" --secret "DOMAIN=<your-domain>" --secret "CLIENT_ID=<mgmt-client-id>" --secret "CLIENT_SECRET=<mgmt-client-secret>"` (repeat similarly for `provision-citizen-record.js`), then deploy and bind each via `auth0 actions deploy <id>` and attaching them to the Login flow.

2. **Auth0 FGA** — create a store at [dashboard.fga.dev](https://dashboard.fga.dev), write the model from `fga-model.fga`, and create an API client for it. Note the store ID, model ID, and client credentials.

3. **Firebase** — create a project at [console.firebase.google.com](https://console.firebase.google.com), enable Firestore, and deploy `firestore.rules` (`firebase deploy --only firestore:rules`, once you've run `firebase init` and linked the project). Generate a service account key (Project Settings → Service Accounts → Generate new private key) for the `FIREBASE_*` env vars — this is the Admin SDK, server-side only; the app has no client-side Firebase Auth/Firestore code yet, so there's no separate client-side Firebase config to set up.

4. **Vercel AI Gateway** — get an API key from your Vercel account. No AWS credentials needed in this app; the Gateway calls Bedrock's Nova Pro model (`amazon/nova-pro`) using Vercel's own Bedrock access, not yours. To use a different model, change `AI_GATEWAY_MODEL` to any [model ID the Gateway supports](https://vercel.com/ai-gateway/models) — that's the only thing you need to change, in code or in your Vercel project's environment variables. All model selection is centralised in `src/lib/ai.ts`.

5. **Environment variables** — copy `ENV_TEMPLATE.md` into `.env.local` and fill in every value from steps 1-4. Nothing in this repo has default values for these; the app won't start without them.

6. **Run it**:
   ```bash
   npm install
   npm run dev
   ```
   Or deploy to Vercel and set the same variables in the project's Environment Variables settings.

## Repo layout

- `src/app/` — routes: citizen chat (`chat`), case view (`case`), delegation controls (`api/delegation`), the MCP server (`api/mcp`), the synchronous first-login provisioning endpoint (`api/provisioning/sync`), and an access log (`access-log`)
- `fga-model.fga` — the Auth0 FGA authorisation model
- `auth0-actions/` — Auth0 Action source (deployable via the `auth0` CLI — see setup step 1 — or pasted into the dashboard)
- `firestore.rules` — Firestore security rules for `cases`, `agents`, `auditEvents`
- `src/lib/provisioning.ts`, `src/lib/firebase-admin.ts` — Firestore data access
- `src/lib/roles.ts` — reads the `citizen`/`caseworker` persona claim the Actions set on the ID token; this is the app's only RBAC mechanism
