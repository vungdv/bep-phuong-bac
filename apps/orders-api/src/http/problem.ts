import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const TYPE_BASE = 'https://bepphuongbac.example/problems/';

/** RFC 7807 Problem Details with the `trace_id` extension member. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  trace_id?: string;
}

/** Supplies the active trace id for a request (T5 plugs OpenTelemetry in here). */
export type TraceIdProvider = (request: FastifyRequest) => string | undefined;

/** Default provider: no active trace. */
export const NO_TRACE: TraceIdProvider = () => undefined;

export function problem(
  slug: string,
  title: string,
  status: number,
  detail: string,
  traceId?: string,
): ProblemDetails {
  const body: ProblemDetails = { type: `${TYPE_BASE}${slug}`, title, status, detail };
  if (traceId) body.trace_id = traceId;
  return body;
}

export function sendProblem(
  reply: FastifyReply,
  body: ProblemDetails,
  headers: Record<string, string> = {},
): FastifyReply {
  return reply.status(body.status).headers(headers).type(PROBLEM_CONTENT_TYPE).send(body);
}

/** Network/timeout failures that mean the store is unavailable (B10 -> 503). */
function isStoreUnavailable(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE'].includes(code)) return true;
  if (code.startsWith('08') || code.startsWith('57P') || code === '57014') return true; // connection, shutdown, statement timeout
  const msg = typeof e?.message === 'string' ? e.message : '';
  return /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error/i.test(msg);
}

const CLIENT_TITLES: Record<number, [string, string]> = {
  400: ['bad-request', 'Bad request'],
  404: ['not-found', 'Not found'],
  405: ['method-not-allowed', 'Method not allowed'],
  415: ['unsupported-media-type', 'Unsupported media type'],
};

export function installProblemHandlers(app: FastifyInstance, traceId: TraceIdProvider = NO_TRACE): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 400 && status < 500) {
      const [slug, title] = CLIENT_TITLES[status] ?? ['client-error', 'Client error'];
      // Fastify's own 4xx messages are safe (no SQL/stack), e.g. malformed body.
      return sendProblem(reply, problem(slug, title, status, err.message, traceId(request)));
    }
    request.log.error({ err }, 'request failed');
    const body = isStoreUnavailable(err)
      ? problem('service-unavailable', 'Service unavailable', 503, 'The order store is temporarily unavailable.', traceId(request))
      : problem('internal-error', 'Internal server error', 500, 'An unexpected error occurred.', traceId(request));
    return sendProblem(reply, body);
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, problem('not-found', 'Not found', 404, 'The requested resource does not exist.', traceId(request))),
  );
}
