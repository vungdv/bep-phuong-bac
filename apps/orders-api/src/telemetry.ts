import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader, type IMetricReader } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TraceIdProvider } from './http/problem.js';

export interface TelemetryOptions {
  serviceName: string;
  /** OTLP/HTTP base URL. Export is enabled only when set (or when a test injects an exporter/reader). */
  otlpEndpoint?: string | undefined;
  /** Test seam: replaces the OTLP span exporter. */
  spanExporter?: SpanExporter;
  /** Test seam: replaces the OTLP metric reader. */
  metricReader?: IMetricReader;
}

export interface Telemetry {
  tracer: Tracer;
  /** Active trace id of a request, for Problem Details `trace_id` (B11). */
  traceId: TraceIdProvider;
  /** Installs the request span, `traceparent` echo, access log and metrics hooks on the app. */
  register(app: FastifyInstance): void;
  shutdown(): Promise<void>;
}

const propagator = new W3CTraceContextPropagator();
// Async context propagation is process-global in OpenTelemetry; setting it twice is a harmless no-op.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

const otlpUrl = (base: string, signal: 'traces' | 'metrics') => `${base.replace(/\/+$/, '')}/v1/${signal}`;

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

interface RequestState {
  span: Span;
  ctx: Context;
  start: bigint;
  route: string;
}

/**
 * OpenTelemetry setup (O1-O5). Providers are local, not global, so each instance (and each test)
 * is isolated. Without an OTLP endpoint nothing is exported, but spans still carry real trace
 * and span ids, so logs and Problem Details stay correlated.
 */
export function createTelemetry(opts: TelemetryOptions): Telemetry {
  const resource = resourceFromAttributes({ 'service.name': opts.serviceName });

  const processors: SpanProcessor[] = [];
  if (opts.spanExporter) processors.push(new SimpleSpanProcessor(opts.spanExporter));
  else if (opts.otlpEndpoint) {
    processors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpUrl(opts.otlpEndpoint, 'traces') })));
  }
  const tracerProvider = new BasicTracerProvider({ resource, spanProcessors: processors });

  const readers: IMetricReader[] = [];
  if (opts.metricReader) readers.push(opts.metricReader);
  else if (opts.otlpEndpoint) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otlpUrl(opts.otlpEndpoint, 'metrics') }),
        exportIntervalMillis: 15_000,
      }),
    );
  }
  const meterProvider = new MeterProvider({ resource, readers });
  const meter = meterProvider.getMeter('orders-api');
  const requests = meter.createCounter('http.server.request.count', {
    description: 'Completed HTTP requests',
    unit: '{request}',
  });
  const duration = meter.createHistogram('http.server.request.duration', {
    description: 'HTTP request latency',
    unit: 's',
  });
  const errors = meter.createCounter('http.server.error.count', {
    description: 'HTTP requests that ended with a 5xx status',
    unit: '{request}',
  });

  const tracer = tracerProvider.getTracer('orders-api');
  const states = new WeakMap<FastifyRequest, RequestState>();

  const traceId: TraceIdProvider = (request) =>
    states.get(request)?.span.spanContext().traceId ?? trace.getActiveSpan()?.spanContext().traceId;

  function register(app: FastifyInstance): void {
    // O1/O2/O5: continue or start a trace, open the server span, echo `traceparent`.
    app.addHook('onRequest', (request, reply, done) => {
      // Route template (never the raw path) keeps span names and metric labels low-cardinality.
      const route = request.routeOptions.url ?? 'unmatched';
      const parent = propagator.extract(ROOT_CONTEXT, request.headers, {
        get: (carrier, key) => {
          const v = carrier[key];
          return Array.isArray(v) ? v[0] : v;
        },
        keys: (carrier) => Object.keys(carrier),
      });
      const span = tracer.startSpan(
        `${request.method} ${route}`,
        { kind: SpanKind.SERVER, attributes: { 'http.request.method': request.method, 'http.route': route } },
        parent,
      );
      const ctx = trace.setSpan(parent, span);
      states.set(request, { span, ctx, start: process.hrtime.bigint(), route });
      const carrier: Record<string, string> = {};
      propagator.inject(ctx, carrier, { set: (c, k, v) => void (c[k] = v) });
      if (carrier.traceparent) reply.header('traceparent', carrier.traceparent);
      context.with(ctx, done);
    });

    // O2: exceptions recorded on the server span (client 4xx errors are not exceptions of ours).
    app.addHook('onError', async (request, _reply, error) => {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === undefined || status >= 500) states.get(request)?.span.recordException(error);
    });

    // O2/O3/O4: finish the span, record metrics, emit the single access-log line.
    app.addHook('onResponse', async (request, reply) => {
      const state = states.get(request);
      if (!state) return;
      const status = reply.statusCode;
      const seconds = Number(process.hrtime.bigint() - state.start) / 1e9;
      const attrs = {
        'http.request.method': request.method,
        'http.route': state.route,
        'http.response.status_class': statusClass(status),
      };
      requests.add(1, attrs);
      duration.record(seconds, attrs);
      if (status >= 500) errors.add(1, attrs);

      state.span.setAttribute('http.response.status_code', status);
      state.span.setStatus({ code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      // Path without the query string: query values and bodies are never logged (O3).
      const path = request.url.split('?')[0];
      context.with(state.ctx, () => {
        request.log.info(
          { method: request.method, path, route: state.route, status, duration_ms: Math.round(seconds * 1e5) / 100 },
          'request completed',
        );
      });
      state.span.end();
      states.delete(request);
    });
  }

  return {
    tracer,
    traceId,
    register,
    async shutdown() {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
    },
  };
}
