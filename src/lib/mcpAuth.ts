import { NextRequest } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';

/**
 * Standard resource-server auth for the MCP servers - NOT the OBO/RFC 8693
 * token exchange used elsewhere in this app (see lib/obo.ts). OBO exchanges
 * a token to change its audience/act claim for one specific downstream hop
 * (submit_appeal -> case-service). This is different: the citizen or
 * caseworker calls the MCP server directly, presenting an access token
 * already issued for MCP_API_AUDIENCE - no exchange involved, no
 * intermediary being delegated through. It's the same JWT/JWKS validation
 * pattern already used in api/case-service/submit-appeal/route.ts, just
 * applied to an ordinary access token instead of an exchanged one.
 */
const JWKS = createRemoteJWKSet(new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`));

const PERSONA_CLAIM = 'https://smartgov.apidays/persona';

export type VerifiedMcpCaller = {
  userId: string;
  persona: 'citizen' | 'caseworker';
};

export async function verifyMcpAccessToken(request: NextRequest): Promise<VerifiedMcpCaller | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice('Bearer '.length);
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      audience: process.env.MCP_API_AUDIENCE,
    });
    const userId = payload.sub;
    if (!userId) return null;
    const persona = payload[PERSONA_CLAIM] === 'caseworker' ? 'caseworker' : 'citizen';
    return { userId, persona };
  } catch (err) {
    // Deliberately logged, not silently swallowed - a bare catch{} here
    // turned every possible validation failure (wrong audience, expired
    // token, signature mismatch, wrong issuer) into an indistinguishable
    // 401, which the calling chat route then reported to the model as a
    // generic "tool call failed," which the model in turn - per its own
    // system prompt, written before this failure mode existed - narrated
    // as an FGA/delegation denial. None of that was the real error.
    console.error('verifyMcpAccessToken failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
