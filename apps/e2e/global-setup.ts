const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5080';

export default async function globalSetup(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/health/live`, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) return;
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `Backend not healthy at ${BACKEND_URL}/health/live (${String(e)}).\n` +
        'Start it first: make stack-up',
    );
  }
}
