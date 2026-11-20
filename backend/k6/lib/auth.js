import http from 'k6/http';
import { BASE_URL, required } from './config.js';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Client-credentials access token of the confidential script client (role Administrator). */
export function scriptToken() {
  const res = http.post(`${BASE_URL}/connect/token`, {
    grant_type: 'client_credentials',
    client_id: 'bpb-orders-script',
    client_secret: required('SCRIPT_CLIENT_SECRET'),
  });
  const token = res.status === 200 ? res.json('access_token') : '';
  if (!token) throw new Error(`client-credentials token failed (HTTP ${res.status})`);
  return token;
}

export function bearer(token, extra = {}) {
  return { headers: { Authorization: `Bearer ${token}`, ...extra } };
}

export function graphql(token, query) {
  return http.post(`${BASE_URL}/api/graphql`, JSON.stringify({ query }), bearer(token, JSON_HEADERS));
}
