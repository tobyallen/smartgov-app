# Environment variables

Copy this into `.env.local` (gitignored — never commit it) and fill in
every value from your own Auth0 tenant, Auth0 FGA store, and Neon
database. Nothing here is shared across deployments; every value below
is specific to the tenant/store/database you create when you follow the
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

# OBO — dedicated resource_server-type client that performs the token
# exchange. NOT the same client as the citizen portal above — Auth0
# requires the exchanging entity to be its own client with
# token_exchange.allow_any_profile_of_type enabled.
OBO_BACKEND_CLIENT_ID=<your OBO backend client ID>
OBO_BACKEND_CLIENT_SECRET=<fetch via: auth0 apps show <client_id> -r>

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

# Database (Neon — use the POOLED connection string, not the direct one)
DATABASE_URL=

# Vercel AI Gateway
AI_GATEWAY_API_KEY=<your Vercel AI Gateway key>
AI_GATEWAY_MODEL=openai/gpt-5.4-fast
```

## A note on secrets

Rotate any client secret that's ever been printed to a terminal, chat
transcript, or log file, even in a local dev tenant — treat "printed
somewhere" as "compromised" and rotate rather than reuse.
