import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('applies defaults', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x' });
    expect(c.port).toBe(8080);
    expect(c.corsAllowedOrigins).toEqual([]);
    expect(c.otelExporterOtlpEndpoint).toBeUndefined();
    expect(c.otelServiceName).toBe('orders-api');
  });

  it('parses port, origins and otel vars', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgres://x',
      PORT: '9000',
      CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test ,',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318',
      OTEL_SERVICE_NAME: 'svc',
    });
    expect(c.port).toBe(9000);
    expect(c.corsAllowedOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(c.otelExporterOtlpEndpoint).toBe('http://otel:4318');
    expect(c.otelServiceName).toBe('svc');
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' })).toThrow(/PORT/);
  });
});
