// LLM Extract activity through a real (tiny) workflow, against the running stack with the llm-stub as the LLM
// (make test-backend does `make stub-up` first). Run: make test-backend, or k6 run k6/llm-extract.js.
//
// The workflow is NOT in the production recipe or the module. The test-only recipe k6/recipes/LlmExtractProbe.recipe.json is
// imported through the admin (it temporarily enables the OrchardCore.Deployment feature for the JSON import and disables it
// again in teardown): content type LlmProbe -> LlmExtractTask (tools probe_alpha and
// probe_beta) -> a LlmProbeResult item that records the workflow properties. teardown() deletes everything it created
// (items, the workflow, both content types and the Deployment feature), so the stack is left as it was.
//
// Env: BASE_URL, SCRIPT_CLIENT_SECRET, ADMIN_PASSWORD (required), LLM_STUB_URL (default http://localhost:5099), SEED_UTC_OFFSET_HOURS.
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, day, required } from './lib/config.js';
import { JSON_HEADERS, bearer, graphql, scriptToken } from './lib/auth.js';
import { requestVerificationToken, submitLogin } from './lib/oidc.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
};

const STUB = __ENV.LLM_STUB_URL || 'http://localhost:5099';
const RECIPE = open('./recipes/LlmExtractProbe.recipe.json');
const ok = (name, cond) => check(null, { [name]: () => !!cond });

function adminSession() {
  const jar = new http.CookieJar();
  const page = http.get(`${BASE_URL}/Login`, { jar });
  const login = submitLogin(jar, '/Login', page.body, 'admin', required('ADMIN_PASSWORD'));
  if (login.status !== 302) throw new Error(`admin login failed (HTTP ${login.status})`);
  return jar;
}

function postForm(jar, pageUrl, actionPath) {
  const token = requestVerificationToken(http.get(`${BASE_URL}${pageUrl}`, { jar }).body);
  return http.post(`${BASE_URL}${actionPath}`, { __RequestVerificationToken: token }, { jar, redirects: 0 });
}

function workflowTypeId(jar) {
  const m = http.get(`${BASE_URL}/Admin/Workflows/Types`, { jar }).body.match(/Types\/Edit\/(\d+)[^"]*">LlmExtractProbe</);
  return m ? m[1] : '';
}

export function setup() {
  const jar = adminSession();
  const enable = postForm(jar, '/Admin/Features', '/Admin/Features/OrchardCore.Deployment/Enable');
  ok(`the Deployment feature (JSON import) is enabled for the test (${enable.status})`, enable.status === 302);
  const form = http.get(`${BASE_URL}/Admin/DeploymentPlan/Import/Json`, { jar });
  const run = http.post(`${BASE_URL}/Admin/DeploymentPlan/Import/Json`,
    { __RequestVerificationToken: requestVerificationToken(form.body), Json: RECIPE }, { jar, redirects: 0 });
  ok(`the test-only LlmExtractProbe recipe imports through the admin (${run.status})`, run.status === 302 || run.status === 200);
  return { token: scriptToken() };
}

export default function ({ token }) {
  const api = (method, path, body = null) => http.request(method, `${BASE_URL}${path}`, body, bearer(token, body ? JSON_HEADERS : {}));
  const stub = (method, path) => http.request(method, `${STUB}${path}`);
  ok('llm-stub is reachable', stub('GET', '/health').status === 200);

  /** Publishes an LlmProbe item (the workflow runs inline) and returns what the workflow recorded plus the stub's request log. */
  const probe = (text) => {
    stub('DELETE', '/requests');
    const created = api('POST', '/api/content', JSON.stringify({
      ContentType: 'LlmProbe', DisplayText: 'k6 probe', Published: true, LlmProbe: { Text: { Text: text } },
    }));
    const id = created.status === 200 ? created.json('ContentItemId') : '';
    const rows = graphql(token, '{ llmProbeResult { sourceId tool argsJson error contentItemId } }').json('data.llmProbeResult') || [];
    const result = rows.find((r) => r.sourceId === id) || null;
    const calls = stub('GET', '/requests').json('count');
    const last = calls ? stub('GET', '/requests/last').json() : null;
    return { status: created.status, id, result, calls, last };
  };

  // 1. one outcome per tool, arguments stored as a JSON string in the workflow properties, the request is the documented single shot
  const alpha = probe('hello stub-probe-alpha please');
  ok(`item with text for tool probe_alpha is created (${alpha.status})`, alpha.status === 200);
  ok('workflow took outcome probe_alpha and stored LlmTool', alpha.result && alpha.result.tool === 'probe_alpha');
  const args = alpha.result ? JSON.parse(alpha.result.argsJson) : {};
  ok('LlmArgsJson holds the tool arguments as JSON', args.label === 'alpha' && args.count === 1);
  ok('no error recorded on success', alpha.result && alpha.result.error === '');
  ok(`exactly one request reached the LLM (got ${alpha.calls})`, alpha.calls === 1);
  const req = alpha.last || {};
  ok('request: model from Bpb:Llm:Model', req.model === 'qwen2.5:7b-instruct');
  ok('request: system message is the rendered System prompt (Liquid date)', (req.messages || [])[0]
    && req.messages[0].role === 'system' && req.messages[0].content === `Today is ${day(0)}. Call exactly one tool.`);
  ok('request: the only user message is the rendered User prompt', (req.messages || []).length === 2
    && req.messages[1].role === 'user' && req.messages[1].content === 'hello stub-probe-alpha please');
  ok('request: tool_choice required, temperature 0, not streamed', req.tool_choice === 'required' && req.temperature === 0 && req.stream === false);
  ok('request: both configured tools with their schemas', (req.tools || []).map((t) => t.function.name).join() === 'probe_alpha,probe_beta'
    && req.tools[0].function.parameters.required[0] === 'label');

  const beta = probe('stub-probe-beta');
  ok('workflow took outcome probe_beta', beta.result && beta.result.tool === 'probe_beta' && JSON.parse(beta.result.argsJson).label === 'beta');

  // 2. Invalid: arguments break the tool schema, unknown tool, no tool call
  const bad = probe('[stub:tool=probe_alpha args={"count":0}]');
  ok('Invalid: arguments without the required label', bad.result && bad.result.tool === '' && bad.result.argsJson === '' && bad.result.error !== '');
  const badType = probe('[stub:tool=probe_alpha args={"label":"x","count":"many"}]');
  ok('Invalid: wrong argument type', badType.result && badType.result.tool === '' && badType.result.error === 'arguments do not match the tool schema');
  const unknown = probe('[stub:tool=drop_tables args={}]');
  ok('Invalid: unknown tool', unknown.result && unknown.result.tool === '' && unknown.result.error === 'unknown tool');
  const notool = probe('[stub:notool]');
  ok('Invalid: no tool call', notool.result && notool.result.tool === '' && notool.result.error === 'no tool call');
  const notJson = probe('[stub:argstring=this is not json]');
  ok('Invalid: arguments that are not JSON', notJson.result && notJson.result.tool === '' && notJson.result.error !== '');

  // 3. Failed: HTTP 500 and a garbage reply, one request each (no retry); the workflow still finishes and the source item is kept
  const err = probe('[stub:500]');
  ok('Failed: LLM answered HTTP 500', err.status === 200 && err.result && err.result.tool === '' && err.result.error === 'HTTP 500');
  ok(`Failed: not retried (requests: ${err.calls})`, err.calls === 1);
  const garbage = probe('[stub:garbage]');
  ok('Failed: unparseable reply', garbage.result && garbage.result.error === 'unparseable response' && garbage.calls === 1);
  const empty = probe('[stub:empty]');
  ok('Failed: empty reply', empty.result && empty.result.error === 'empty response');
  ok('the source item survives a Failed run', api('GET', `/api/content/${err.id}`).status === 200);

  // 4. the editor: the configured settings render in the activity edit form
  const jar = adminSession();
  const wf = workflowTypeId(jar);
  const form = wf ? http.get(`${BASE_URL}/Admin/Workflows/Types/${wf}/Activity/p2llm/Edit`, { jar }).body : '';
  for (const f of ['SystemPrompt', 'UserPrompt', 'Tools', 'ModelOverride', 'ResultKey']) {
    ok(`activity editor renders the ${f} setting`, form.includes(`name="LlmExtractTask.${f}"`));
  }
  ok('activity editor shows the saved tools', form.includes('probe_alpha'));
  const types = http.get(`${BASE_URL}/Admin/Workflows/Types/Edit/${wf}`, { jar }).body;
  ok('workflow editor shows the outcomes of the activity', ['probe_alpha', 'probe_beta', 'Invalid', 'Failed'].every((o) => types.includes(o)));
}

export function teardown({ token }) {
  const api = (method, path) => http.request(method, `${BASE_URL}${path}`, null, bearer(token));
  const gql = (q) => graphql(token, q).json('data');
  const ids = [
    ...(gql('{ llmProbeResult { contentItemId } }').llmProbeResult || []).map((r) => r.contentItemId),
    ...(gql('{ llmProbe { contentItemId } }').llmProbe || []).map((r) => r.contentItemId),
  ];
  const failed = ids.filter((id) => api('DELETE', `/api/content/${id}`).status !== 200);
  ok(`cleanup: ${ids.length} test items deleted`, failed.length === 0);
  const jar = adminSession();
  const wf = workflowTypeId(jar);
  if (wf) postForm(jar, '/Admin/Workflows/Types', `/Admin/Workflows/Types/Delete/${wf}`);
  ok('cleanup: the test workflow is deleted', workflowTypeId(jar) === '');
  for (const t of ['LlmProbe', 'LlmProbeResult']) {
    postForm(jar, '/Admin/ContentTypes/List', `/Admin/OrchardCore.ContentTypes/Admin/Delete/${t}`);
  }
  const left = http.get(`${BASE_URL}/Admin/ContentTypes/List`, { jar }).body;
  ok('cleanup: the test content types are deleted', !left.includes('LlmProbe'));
  const off = postForm(jar, '/Admin/Features', '/Admin/Features/OrchardCore.Deployment/Disable');
  ok(`cleanup: the Deployment feature is disabled again (${off.status})`, off.status === 302);
}
