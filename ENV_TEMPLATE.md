# Environment variables

Copy this into `.env.local` (gitignored — never commit it) and fill in
every value from your own Auth0 tenant, Auth0 FGA store, and Firebase
project. Nothing here is shared across deployments; every value below
is specific to the tenant/store/project you create when you follow the
setup steps in the README.

```
# Auth0 — create a Regular Web App in your own tenant
AUTH0_DOMAIN=<your-tenant>.us.auth0.com
AUTH0_CLIENT_ID=<your Regular Web App client ID>
AUTH0_CLIENT_SECRET=<fetch via: auth0 apps show <client_id> -r>
AUTH0_SECRET=<generate via: openssl rand -hex 32>
APP_BASE_URL=http://localhost:3000

# Main app API (audience the citizen's own access token is issued for) —
# register this as a Custom API / resource server in your Auth0 tenant
APP_API_AUDIENCE=https://<your-domain>/api

# MCP servers' own API (audience for both /api/mcp and /api/admin-mcp) —
# register this as its own Custom API / resource server, distinct from
# APP_API_AUDIENCE. Any MCP client (this app's own browser, or a genuinely
# independent third-party client) authenticates against these routes with
# a Bearer access token issued for THIS audience, validated via JWKS in
# lib/mcpAuth.ts - not the browser session cookie. The persona role claim
# rides on this access token too (see assign-persona-role.js), which is
# how /api/admin-mcp's RBAC check works without a session.
#
# This value must match the registered API's identifier EXACTLY, byte for
# byte (no trailing slash difference, no path mismatch) - it's also the
# `audience` used in the OBO exchange from the chat backend to reach
# this API (lib/obo.ts's exchangeForMcp), and that exchange's client-grant
# (subject_type: "user", see the OBO section above) is scoped to this
# exact string too. A mismatch anywhere in that chain surfaces as
# "invalid_request: This client cannot exchange access tokens for this
# audience" - a genuinely confusing error, since it sounds like a missing
# grant even when the real problem is a value that doesn't match.
MCP_API_AUDIENCE=https://<your-domain>/api/mcp

# OBO — dedicated resource_server-type client that performs the chat
# backend -> MCP token exchange. NOT the same client as the citizen
# portal above — Auth0 requires the exchanging entity to be its own
# client with token_exchange.allow_any_profile_of_type enabled, AND its
# resource_server_identifier must equal the subject token's own `aud` —
# here, APP_API_AUDIENCE, since that's the token this hop exchanges.
OBO_BACKEND_CLIENT_ID=<your OBO backend client ID>
OBO_BACKEND_CLIENT_SECRET=<fetch via: auth0 apps show <client_id> -r>

# OBO — a SEPARATE dedicated client for the second hop, MCP tool handler
# -> case service (used only inside submit_appeal). Deliberately not the
# same client as OBO_BACKEND_CLIENT_ID above, even though both are OBO
# exchanges: this hop's subject token is the ALREADY-EXCHANGED
# MCP_API_AUDIENCE token, not the citizen's original login token, so its
# `aud` is different — and resource_server_identifier can't be edited
# after a client is created, so a client registered for APP_API_AUDIENCE
# can never also serve this hop. Confirmed live: reusing
# OBO_BACKEND_CLIENT_ID here fails with "This client cannot exchange
# access tokens for this audience" even though the client-grant and
# resource-server config are otherwise correct — see the "six checks
# later" blog post for the full mechanism.
OBO_CASE_SERVICE_CLIENT_ID=<your case-service OBO client ID, resource_server_identifier = MCP_API_AUDIENCE>
OBO_CASE_SERVICE_CLIENT_SECRET=<fetch via: auth0 apps show <client_id> -r>

# Downstream case-service API
CASE_SERVICE_AUDIENCE=https://<your-domain>/api/case-service
CASE_SERVICE_URL=http://localhost:3000/api/case-service

# Auth0 FGA (hosted) — create your own store and model (see
# fga-model.fga in this repo for the model to load). The token issuer is
# auth.fga.dev, not fga.us.auth0.com.
FGA_API_URL=https://api.us1.fga.dev
FGA_STORE_ID=<your FGA store ID>
FGA_MODEL_ID=<your FGA model ID, after writing fga-model.fga>
FGA_CLIENT_ID=<your FGA API client ID>
FGA_CLIENT_SECRET=<your FGA API client secret>
FGA_API_TOKEN_ISSUER=auth.fga.dev
FGA_API_AUDIENCE=https://api.us1.fga.dev/

# Firebase (Admin SDK, server-side only) — app state (cases, agent
# identities, the audit log). Not the source of truth for authorization;
# that's Auth0 FGA above. Create a project at console.firebase.google.com,
# enable Firestore, then Project Settings -> Service Accounts -> Generate
# new private key to get these three values from the downloaded JSON.
FIREBASE_PROJECT_ID=<your Firebase project ID>
FIREBASE_CLIENT_EMAIL=<the "client_email" field from the service account JSON>
FIREBASE_PRIVATE_KEY="<the "private_key" field from the service account JSON, including -----BEGIN/END----- lines>"

# Vercel AI Gateway
AI_GATEWAY_API_KEY=<your Vercel AI Gateway key>
AI_GATEWAY_MODEL=amazon/nova-pro

# Provisioning sync — checked by /api/provisioning/sync against the
# x-provisioning-secret header the auth0-actions/provision-citizen-record.js
# Action sends. Must match the PROVISIONING_SYNC_SECRET Action Secret
# exactly. Generate with: openssl rand -hex 32.
PROVISIONING_SYNC_SECRET=<generate via: openssl rand -hex 32>
```

## A note on secrets

Rotate any client secret that's ever been printed to a terminal, chat
transcript, or log file, even in a local dev tenant — treat "printed
somewhere" as "compromised" and rotate rather than reuse.
