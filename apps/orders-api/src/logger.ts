import { trace } from '@opentelemetry/api';
import pino, { type DestinationStream, type Logger } from 'pino';

export interface LoggerOptions {
  level?: string;
  /** Defaults to stdout; tests pass a capturing stream. */
  destination?: DestinationStream;
}

/**
 * Structured JSON logger (O3). Every line emitted inside an active span carries that span's
 * `trace_id` and `span_id`, so logs correlate with traces.
 */
export function createLogger({ level = 'info', destination }: LoggerOptions = {}): Logger {
  return pino(
    {
      level,
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      mixin() {
        const ctx = trace.getActiveSpan()?.spanContext();
        return ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {};
      },
    },
    destination ?? pino.destination(1),
  );
}
