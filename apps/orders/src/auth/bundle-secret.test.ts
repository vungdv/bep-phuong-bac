import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// B11: the orders app is a public client; the built bundle must hold no client secret.
// Skipped unless the bundle was built (`pnpm --filter @bpb/orders build`).
const bundlePath = resolve(process.cwd(), 'dist/orders-app.js') // vitest runs in apps/orders;
const backendDir = resolve(process.cwd(), '../../backend') + '/';

/** Secret values to look for: the process env, backend/.env (gitignored copy) and the dev default in .env.example. */
function scriptSecrets(): string[] {
  const values = new Set<string>();
  if (process.env.SCRIPT_CLIENT_SECRET) values.add(process.env.SCRIPT_CLIENT_SECRET);
  for (const f of ['.env', '.env.example']) {
    const p = backendDir + f;
    if (!existsSync(p)) continue;
    const m = /^SCRIPT_CLIENT_SECRET=(.+)$/m.exec(readFileSync(p, 'utf8'));
    if (m?.[1]) values.add(m[1].trim());
  }
  return [...values];
}

describe.skipIf(!existsSync(bundlePath))('built bundle holds no client secret (B11)', () => {
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : '';

  it('does not contain the script client secret value', () => {
    const secrets = scriptSecrets();
    expect(secrets.length).toBeGreaterThan(0);
    for (const s of secrets) expect(bundle.includes(s), `bundle contains the secret value from ${s.length} chars`).toBe(false);
  });

  it('does not contain the secret variable names or the script client', () => {
    for (const name of ['ORCHARD_CLIENT_SECRET', 'SCRIPT_CLIENT_SECRET', 'ScriptClientSecret', 'bpb-orders-script']) {
      expect(bundle.includes(name), name).toBe(false);
    }
  });

  it('never assigns a literal value to client_secret', () => {
    // oidc-client-ts mentions `client_secret` as a property name (it also supports confidential clients),
    // so the bare word is expected. A literal value assigned to it would be a configured secret.
    expect(/client_secret["']?\s*[:=]\s*["'`][^"'`]/.test(bundle)).toBe(false);
  });
});
