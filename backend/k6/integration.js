// Backend integration test against a running stack (make stack-up).
// Run: make test-backend (loads backend/.env), or k6 run k6/integration.js.
// Env: BASE_URL, SCRIPT_CLIENT_SECRET, KITCHEN_USERNAME, KITCHEN_PASSWORD, ADMIN_PASSWORD (required), SEED_UTC_OFFSET_HOURS.
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, day, required } from './lib/config.js';
import { JSON_HEADERS, bearer, graphql, scriptToken } from './lib/auth.js';
import { seedOrders } from './lib/seed.js';
import {
  CLIENT_ID, authorizeUrl, codeFlowTokens, pkce, submitLogin,
} from './lib/oidc.js';

export const options = {
  vus: 1,
  iterations: 1,
  // Any failed check fails the run (non-zero exit code), so CI and `make` stop.
  thresholds: { checks: ['rate==1'] },
};

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];
const ok = (name, cond) => check(null, { [name]: () => !!cond });

export function setup() {
  required('KITCHEN_USERNAME'); required('KITCHEN_PASSWORD');
  const token = scriptToken();
  ok('token: client credentials works', token);
  // sample data (B7): the first run may seed or not, the second must find every day already seeded
  seedOrders(token);
  ok('seed is idempotent (re-run seeded nothing)', seedOrders(token).length === 0);
  return { token };
}

export default function ({ token }) {
  const get = (path, params = {}) => http.get(`${BASE_URL}${path}`, { redirects: 0, ...params });
  const gql = (query) => graphql(token, query);

  // health (B16) and tenant provisioned (B2): the root is not redirected to the setup screen
  ok('health: GET /health/live is 200', get('/health/live').status === 200);
  const root = http.get(`${BASE_URL}/`);
  ok(`tenant provisioned (no setup redirect, got ${root.url})`, !/setup/i.test(root.url));

  // Order type present (B3/B4)
  const fields = gql('{ __type(name:"OrderWhereInput"){ inputFields{name} } }')
    .json('data.__type.inputFields').map((f) => f.name);
  for (const f of ['no', 'customerName', 'qty', 'message', 'serviceDate', 'delivered']) {
    ok(`schema: Order filterable on ${f}`, fields.includes(f));
  }

  // 401 without a token and no order data (B12)
  const anon = http.post(`${BASE_URL}/api/graphql`, '{"query":"{ order { no customerName } }"}', { headers: JSON_HEADERS });
  ok(`no token: 401 and no data (got ${anon.status})`, anon.status === 401 && !/customerName|"data"/.test(anon.body));
  const bad = http.post(`${BASE_URL}/api/graphql`, '{"query":"{ order { no } }"}', bearer('garbage', JSON_HEADERS));
  ok(`bad token: 401 (got ${bad.status})`, bad.status === 401);

  // CORS preflight (B13)
  const preflight = (origin, path) => {
    const res = http.options(`${BASE_URL}${path}`, null, {
      headers: {
        Origin: origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    return { status: res.status, allow: res.headers['Access-Control-Allow-Origin'] || '' };
  };
  for (const path of ['/api/graphql', '/api/content', '/connect/token']) {
    for (const origin of LOCAL_ORIGINS) {
      const r = preflight(origin, path);
      ok(`preflight ${origin} -> ${path} allowed (${r.status}|${r.allow})`, r.status >= 200 && r.status < 300 && r.allow === origin);
    }
    const r = preflight('http://evil.example', path);
    ok(`preflight evil.example -> ${path} denied (${r.status}|${r.allow})`, r.allow === '');
  }

  // date filter on PostgreSQL (B7, B8 intent)
  const [Y, T, N] = [day(-1), day(0), day(1)];
  const list = (d) => gql(`{ order(where:{serviceDate:"${d}"}, orderBy:{createdUtc:ASC}) { no serviceDate delivered createdUtc } }`)
    .json('data.order');
  const tomorrow = list(N);
  ok(`list tomorrow (${N}): exactly 6 orders, only that day, in No/createdUtc order`,
    tomorrow.length === 6 && tomorrow.every((o) => o.serviceDate === N)
    && tomorrow.map((o) => o.no).join() === '1,2,3,4,5,6'
    && tomorrow.map((o) => o.createdUtc).join() === tomorrow.map((o) => o.createdUtc).sort().join());
  const yesterday = list(Y);
  const nDelivered = yesterday.filter((o) => o.delivered).length;
  ok(`yesterday (${Y}): 6 orders, some delivered`, yesterday.length === 6 && nDelivered > 0 && nDelivered < 6);
  const today = list(T);
  ok(`today (${T}): 6 orders, none delivered`, today.length === 6 && !today.some((o) => o.delivered));

  // --- B11/B12: public client with Authorization Code + PKCE, shared kitchen account (role Kitchen) ---
  const { challenge } = pkce();
  const accepted = http.get(authorizeUrl({ challenge }), { redirects: 0 });
  ok(`authorize: public client + PKCE is accepted (302 to the login flow, got ${accepted.status})`,
    accepted.status === 302 && (accepted.headers.Location || '').includes('/connect/authorize'));
  ok('authorize: request without PKCE is rejected', /invalid_request/i.test(http.get(authorizeUrl(), { redirects: 0 }).body));
  const evil = http.get(authorizeUrl({ redirectUri: 'http://evil.example/', challenge }), { redirects: 0 });
  ok('authorize: unregistered redirect URI is rejected', /invalid_request|invalid_client/i.test(evil.body));
  const pub = http.post(`${BASE_URL}/connect/token`, { grant_type: 'client_credentials', client_id: CLIENT_ID });
  ok(`public client cannot use client_credentials (${pub.status})`, pub.status >= 400 && pub.status < 500);
  const pub2 = http.post(`${BASE_URL}/connect/token`, { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: 'anything' });
  ok(`public client with a made-up secret cannot use client_credentials (${pub2.status})`, pub2.status >= 400 && pub2.status < 500);

  const kitchenUser = required('KITCHEN_USERNAME');
  const kitchenPassword = required('KITCHEN_PASSWORD');
  let tokens = {};
  try {
    tokens = codeFlowTokens(kitchenUser, kitchenPassword);
    ok('code flow: login form + PKCE round trip returns tokens', tokens.access_token);
  } catch (e) {
    ok(`code flow: login form + PKCE round trip returns tokens (${e.message})`, false);
  }
  ok('code flow: refresh token issued (offline_access)', tokens.refresh_token);
  const refreshed = http.post(`${BASE_URL}/connect/token`, {
    grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: tokens.refresh_token || '',
  });
  ok(`refresh_token grant works for the public client (${refreshed.status})`, refreshed.status === 200 && !!refreshed.json('access_token'));

  const ut = tokens.access_token || '';
  const asKitchen = (path, method = 'GET', body = null) =>
    http.request(method, `${BASE_URL}${path}`, body, { ...bearer(ut, body ? JSON_HEADERS : {}), redirects: 0 });
  const orders = asKitchen('/api/graphql', 'POST', JSON.stringify({
    query: `{ order(where:{serviceDate:"${N}"}) { contentItemId no delivered } }`,
  }));
  const kitchenOrders = orders.status === 200 ? orders.json('data.order') : [];
  ok(`kitchen token: GraphQL reads the day's 6 orders (${orders.status}, ${kitchenOrders.length})`,
    orders.status === 200 && kitchenOrders.length === 6);
  const id = kitchenOrders.length ? kitchenOrders[0].contentItemId : '';
  const item = asKitchen(`/api/content/${id}`);
  ok(`kitchen token: GET /api/content/{id} (${item.status})`, item.status === 200);
  if (item.status === 200) {
    const doc = item.json();
    doc.Order.Delivered.Value = !doc.Order.Delivered.Value;
    const upd = asKitchen('/api/content', 'POST', JSON.stringify(doc));
    ok(`kitchen token: POST /api/content updates an order (${upd.status})`, upd.status === 200);
    doc.Order.Delivered.Value = !doc.Order.Delivered.Value;
    asKitchen('/api/content', 'POST', JSON.stringify(doc)); // restore the flag
  }
  const del = asKitchen(`/api/content/${id}`, 'DELETE');
  ok(`kitchen token: DELETE an order is denied (${del.status})`, [401, 403, 404, 405].includes(del.status));
  ok('kitchen token: the order is still there after the denied DELETE', asKitchen(`/api/content/${id}`).status === 200);
  const other = asKitchen('/api/content', 'POST', '{"ContentType":"User"}');
  ok(`kitchen token: cannot create other content types (${other.status})`, !(other.status >= 200 && other.status < 300));
  for (const path of ['/Admin', '/Admin/Users/Create', '/Admin/Roles', '/Admin/OpenId/Application']) {
    const r = asKitchen(path);
    const loc = r.headers.Location || '';
    ok(`kitchen token: ${path} needs the cookie login or is denied (${r.status} ${loc})`,
      (r.status === 302 && loc.includes('Login')) || [401, 403, 404].includes(r.status));
  }
  // --- pre-order schema (P22, P25): ChannelMessage exists, Order.SourceContentItemId is additive, Kitchen is denied ---
  const adminJson = (method, path, body = null) =>
    http.request(method, `${BASE_URL}${path}`, body, bearer(token, body ? JSON_HEADERS : {}));
  const msg = adminJson('POST', '/api/content', JSON.stringify({
    ContentType: 'ChannelMessage', DisplayText: 'k6 schema test', Published: true,
    ChannelMessage: {
      Channel: { Text: 'k6' }, SenderName: { Text: 'Chị Lan' }, Text: { Text: 'chị đặt 3 phần cơm gà cho mai' },
      SentAt: { Text: '2099-01-01T08:00:00+07:00' },
    },
  }));
  ok(`admin token: POST /api/content creates a ChannelMessage (${msg.status})`, msg.status === 200);
  const msgId = msg.status === 200 ? msg.json('ContentItemId') : '';
  const msgBack = adminJson('GET', `/api/content/${msgId}`);
  ok(`admin token: the ChannelMessage reads back with its fields (${msgBack.status})`,
    msgBack.status === 200 && msgBack.json('ChannelMessage.Text.Text') === 'chị đặt 3 phần cơm gà cho mai'
    && msgBack.json('ChannelMessage.SenderName.Text') === 'Chị Lan' && msgBack.json('ChannelMessage.Channel.Text') === 'k6');

  const kCreate = asKitchen('/api/content', 'POST', JSON.stringify({
    ContentType: 'ChannelMessage', DisplayText: 'kitchen must not', Published: true,
    ChannelMessage: { Text: { Text: 'x' } },
  }));
  ok(`kitchen token: POST a ChannelMessage is 403 (${kCreate.status})`, kCreate.status === 403);
  const kRead = asKitchen(`/api/content/${msgId}`);
  ok(`kitchen token: GET a ChannelMessage is 403 (${kRead.status})`, kRead.status === 403);
  // The query must be valid, so "no data" cannot come from a typo: the admin token sees the message, the kitchen token must not.
  const channelQuery = JSON.stringify({ query: '{ channelMessage { contentItemId text } }' });
  const aGql = adminJson('POST', '/api/graphql', channelQuery);
  ok('admin token: the same GraphQL query lists the ChannelMessage (control)',
    aGql.status === 200 && (aGql.json('data.channelMessage') || []).some((m) => m.contentItemId === msgId));
  const kGql = asKitchen('/api/graphql', 'POST', channelQuery);
  const kGqlData = kGql.status === 200 ? (kGql.json('data.channelMessage') || []) : [];
  ok(`kitchen token: GraphQL returns an empty ChannelMessage list or errors, never the message (${kGql.status})`,
    kGqlData.length === 0 && !kGql.body.includes(msgId));
  const kDel = asKitchen(`/api/content/${msgId}`, 'DELETE');
  ok(`kitchen token: DELETE a ChannelMessage is denied (${kDel.status})`, kDel.status === 403);

  // workflows: the kitchen cookie session (not only a bearer token) is refused
  const kjar = new http.CookieJar();
  submitLogin(kjar, '/Login', http.get(`${BASE_URL}/Login`, { jar: kjar }).body, kitchenUser, kitchenPassword);
  for (const path of ['/Admin/Workflows/Types', '/Admin/Workflows/Types/Index']) {
    const r = http.get(`${BASE_URL}${path}`, { jar: kjar, redirects: 0 });
    const loc = r.headers.Location || '';
    ok(`kitchen cookie session: ${path} is denied (${r.status} ${loc})`,
      r.status === 403 || (r.status === 302 && /AccessDenied|Error\/403|Login/.test(loc)));
    const t = asKitchen(path);
    ok(`kitchen token: ${path} is denied (${t.status})`, [302, 401, 403, 404].includes(t.status));
  }
  const kAdminMsg = http.get(`${BASE_URL}/Admin/Contents/ContentItems/${msgId}/Edit`, { jar: kjar, redirects: 0 });
  ok(`kitchen cookie session: admin edit of a ChannelMessage is denied (${kAdminMsg.status})`,
    kAdminMsg.status === 403 || kAdminMsg.status === 404 || (kAdminMsg.status === 302 && /AccessDenied|Error\/403|Login/.test(kAdminMsg.headers.Location || '')));
  // the admin side works with no clicks (admin theme + navigation in the recipe)
  const adminJar = new http.CookieJar();
  submitLogin(adminJar, '/Login', http.get(`${BASE_URL}/Login`, { jar: adminJar }).body, 'admin', required('ADMIN_PASSWORD'));
  const wfPage = http.get(`${BASE_URL}/Admin/Workflows/Types`, { jar: adminJar, redirects: 0 });
  ok(`admin cookie session: /Admin/Workflows/Types renders (${wfPage.status})`, wfPage.status === 200);

  // Order: additive SourceContentItemId; the existing GraphQL shape is unchanged
  const srcOrder = adminJson('POST', '/api/content', JSON.stringify({
    ContentType: 'Order', DisplayText: 'k6 source order', Published: true,
    Order: {
      No: { Value: 1 }, CustomerName: { Text: 'Chị Lan' }, Qty: { Value: 3 }, Message: { Text: 'cơm gà' },
      ServiceDate: { Text: '2099-01-01' }, Delivered: { Value: false }, SourceContentItemId: { Text: msgId },
    },
  }));
  ok(`admin token: an Order accepts SourceContentItemId (${srcOrder.status})`,
    srcOrder.status === 200 && srcOrder.json('Order.SourceContentItemId.Text') === msgId);
  const srcOrderId = srcOrder.status === 200 ? srcOrder.json('ContentItemId') : '';
  const shape = gql('{ order(where:{serviceDate:"2099-01-01"}) { contentItemId no customerName qty message serviceDate delivered createdUtc } }');
  const shaped = shape.status === 200 ? shape.json('data.order') : [];
  ok(`graphql: existing Order fields unchanged and the new order is listed (${shape.status}, ${shaped.length})`,
    shaped.length === 1 && shaped[0].customerName === 'Chị Lan' && shaped[0].qty === 3 && shaped[0].delivered === false);
  const kShape = asKitchen('/api/graphql', 'POST', JSON.stringify({ query: '{ order(where:{serviceDate:"2099-01-01"}) { no customerName qty message serviceDate delivered } }' }));
  ok(`kitchen token: GraphQL Order shape still readable (${kShape.status})`,
    kShape.status === 200 && kShape.json('data.order').length === 1 && !kShape.json('errors'));
  // clean up so the seeded day counts stay exact
  ok('admin token: cleanup of the test order', adminJson('DELETE', `/api/content/${srcOrderId}`).status === 200);
  ok('admin token: cleanup of the test ChannelMessage', adminJson('DELETE', `/api/content/${msgId}`).status === 200);

  const pw = http.post(`${BASE_URL}/connect/token`, {
    grant_type: 'password', client_id: CLIENT_ID, username: kitchenUser, password: kitchenPassword,
  });
  ok(`password grant is disabled (${pw.status})`, pw.status >= 400 && pw.status < 500);

  // the kitchen account is not an Administrator: its cookie session cannot open the admin user form
  const jar = new http.CookieJar();
  const page = http.get(`${BASE_URL}/Login`, { jar });
  submitLogin(jar, '/Login', page.body, kitchenUser, kitchenPassword);
  const adminForm = http.get(`${BASE_URL}/Admin/Users/Create`, { jar, redirects: 0 });
  const adminLoc = adminForm.headers.Location || '';
  ok(`kitchen cookie session cannot open the admin user form (${adminForm.status} ${adminLoc})`,
    [401, 403, 404].includes(adminForm.status)
    || (adminForm.status === 302 && /Login|AccessDenied|Error\/403/.test(adminLoc)));
}
