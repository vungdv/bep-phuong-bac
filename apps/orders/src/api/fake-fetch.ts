export interface Call {
  url: string;
  init: RequestInit;
  body: unknown;
}

type Responder = (call: Call) => Response | Promise<Response>;

/** Test helper: records calls and answers with the scripted responders (last one repeats). */
export function fakeFetch(...responders: Responder[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = { url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = responders[Math.min(calls.length - 1, responders.length - 1)]!;
    return r(call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const empty = (status: number): Response => new Response(null, { status });
