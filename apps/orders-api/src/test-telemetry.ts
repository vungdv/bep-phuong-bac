import { AggregationTemporality, InMemoryMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { Writable } from 'node:stream';
import { createLogger } from './logger.js';
import { createTelemetry } from './telemetry.js';

/** Test helper: telemetry wired to in-memory span and metric exporters, plus a capturing JSON logger. */
export function createTestTelemetry() {
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });
  const telemetry = createTelemetry({ serviceName: 'orders-api-test', spanExporter, metricReader });

  const lines: string[] = [];
  const logger = createLogger({
    destination: new Writable({
      write(chunk, _enc, cb) {
        lines.push(...String(chunk).split('\n').filter(Boolean));
        cb();
      },
    }),
  });

  return {
    telemetry,
    logger,
    spans: () => spanExporter.getFinishedSpans(),
    logs: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    /** Flushes the reader and returns all metric data collected so far, flattened. */
    async metrics() {
      await metricReader.forceFlush();
      // Cumulative exports repeat; the last collection holds the totals.
      const last = metricExporter.getMetrics().at(-1);
      return last ? last.scopeMetrics.flatMap((sm) => sm.metrics) : [];
    },
  };
}
