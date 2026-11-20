import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('orders-api'),
});

export interface Config {
  databaseUrl: string;
  port: number;
  corsAllowedOrigins: string[];
  otelExporterOtlpEndpoint: string | undefined;
  otelServiceName: string;
}

/** Parse and validate environment variables; throws on invalid config (fail fast). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    corsAllowedOrigins: e.CORS_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    otelExporterOtlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
    otelServiceName: e.OTEL_SERVICE_NAME,
  };
}
