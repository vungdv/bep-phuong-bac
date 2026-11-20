import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { BASE_URL } from './config.js';

export const CLIENT_ID = 'bpb-orders-ui';
export const REDIRECT_URI = 'http://localhost:5174/';
export const SCOPE = 'openid offline_access';

export function pkce() {
  const verifier = encoding.b64encode(crypto.randomBytes(48), 'rawurl');
  const challenge = encoding.b64encode(crypto.sha256(verifier, 'binary'), 'rawurl');
  return { verifier, challenge };
}

export function authorizeUrl({ redirectUri = REDIRECT_URI, challenge } = {}) {
  const q = {
    client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirectUri, scope: SCOPE, state: 's1',
  };
  if (challenge) Object.assign(q, { code_challenge: challenge, code_challenge_method: 'S256' });
  const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${BASE_URL}/connect/authorize?${qs}`;
}

const absolute = (loc) => (loc.startsWith('/') ? `${BASE_URL}${loc}` : loc);
const unescapeHtml = (s) => s.replace(/&amp;/g, '&');

export function requestVerificationToken(html) {
  const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]*)"/);
  return m ? m[1] : '';
}

/** Posts the Orchard Core login form on the given jar; returns the response (302 = signed in). */
export function submitLogin(jar, action, pageHtml, username, password) {
  return http.post(`${BASE_URL}${action}`, {
    __RequestVerificationToken: requestVerificationToken(pageHtml),
    'LoginForm.UserName': username,
    'LoginForm.Password': password,
  }, { jar, redirects: 0 });
}

/**
 * Authorization Code + PKCE round trip as the public client, signing in through the Orchard login form (no
 * browser). Returns the token endpoint's JSON response; throws on any failure.
 */
export function codeFlowTokens(username, password) {
  const jar = new http.CookieJar();
  const { verifier, challenge } = pkce();
  let url = authorizeUrl({ challenge });
  let loc = '';
  for (let hop = 0; hop < 8; hop++) {
    const res = http.get(url, { jar, redirects: 0 });
    loc = res.headers.Location ? absolute(res.headers.Location) : '';
    if (loc.startsWith(REDIRECT_URI)) break;
    if (res.status === 200 && res.body.includes('LoginForm.UserName')) {
      const action = unescapeHtml((res.body.match(/<form[^>]*action="([^"]*)"/) || [])[1] || '');
      const login = submitLogin(jar, action, res.body, username, password);
      loc = login.headers.Location ? absolute(login.headers.Location) : '';
      if (!loc) throw new Error(`login rejected (HTTP ${login.status})`);
    }
    if (!loc) throw new Error(`no redirect at ${url} (HTTP ${res.status})`);
    url = loc;
  }
  if (!loc.startsWith(REDIRECT_URI)) throw new Error(`never reached the redirect URI (last: ${loc})`);
  const code = (loc.match(/[?&]code=([^&]*)/) || [])[1];
  if (!code) throw new Error(`no code in ${loc}`);
  const res = http.post(`${BASE_URL}/connect/token`, {
    grant_type: 'authorization_code', client_id: CLIENT_ID, code: decodeURIComponent(code),
    redirect_uri: REDIRECT_URI, code_verifier: verifier,
  });
  if (res.status !== 200) throw new Error(`token endpoint returned HTTP ${res.status}`);
  return res.json();
}
