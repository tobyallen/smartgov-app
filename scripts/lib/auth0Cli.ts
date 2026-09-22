import { execFileSync } from 'node:child_process';

/**
 * Thin wrapper around the `auth0` CLI (already the pattern this project
 * uses for every real tenant change per the build history — never raw
 * Management API fetches from a script). Shelling out rather than using
 * the Management API SDK directly keeps auth/token handling identical
 * to whatever `auth0 login` session is already active, and keeps
 * setup.ts/teardown.ts consistent with how every other tenant change in
 * this project has been made.
 */
export function auth0Json<T = unknown>(args: string[]): T {
  const out = execFileSync('auth0', [...args, '--json'], { encoding: 'utf8' });
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new Error(`\`auth0 ${args.join(' ')}\` did not return valid JSON. Raw output:\n${out}`);
  }
}

export function auth0(args: string[]): void {
  execFileSync('auth0', args, { stdio: 'inherit' });
}

export function requireAuth0Cli(): void {
  try {
    execFileSync('auth0', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'The `auth0` CLI is required (https://github.com/auth0/auth0-cli). Install it, run `auth0 login`, then re-run this script.',
    );
  }
}
