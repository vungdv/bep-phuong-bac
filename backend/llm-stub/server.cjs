// Tiny stand-in for an OpenAI-compatible chat completions server (POST /v1/chat/completions), used by the tests.
// No dependencies. Deterministic: the reply depends only on the user message, never on randomness or time of request
// (except the {{today}} placeholders, which follow the Asia/Ho_Chi_Minh calendar).
//
// Markers in the user message (first one found wins), all case-sensitive:
//   [stub:500]                 HTTP 500
//   [stub:delay=SECONDS]       wait, then answer like the rules below (use more than Bpb:Llm:TimeoutSeconds to test timeouts)
//   [stub:garbage]             HTTP 200 with a body that is not JSON
//   [stub:empty]               HTTP 200 with {"choices":[]}
//   [stub:notool]              a normal reply with text and no tool call
//   [stub:tool=NAME args={...}] call tool NAME with the JSON after "args=" (to the end of the marker; may be omitted: {}).
//                              The tool is called even if the request did not list it (to test "unknown tool").
//   [stub:argstring=TEXT]      call the first listed tool with the raw string TEXT as arguments (not valid JSON on purpose)
// Otherwise replies.json rows are tried in order, then its "fallback".
//
// GET /health -> 200. GET /requests/last -> the last request body received (JSON), GET /requests -> count. DELETE /requests clears.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const replies = JSON.parse(fs.readFileSync(path.join(__dirname, 'replies.json'), 'utf8'));
const received = [];

function vnDate(offsetDays) {
  const ms = Date.now() + 7 * 3600e3 + offsetDays * 86400e3;
  return new Date(ms).toISOString().slice(0, 10);
}
const fill = (s) => s.replace(/\{\{today\}\}/g, vnDate(0)).replace(/\{\{tomorrow\}\}/g, vnDate(1)).replace(/\{\{yesterday\}\}/g, vnDate(-1));
const resolveArgs = (a) => JSON.parse(fill(JSON.stringify(a)));

function toolReply(name, args) {
  return {
    id: 'chatcmpl-stub', object: 'chat.completion', model: 'stub',
    choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [
      { id: 'call_stub', type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }],
  };
}

/** Returns { status, body (object or raw string), delaySeconds } for a parsed request. */
function decide(req) {
  const user = [...(req.messages || [])].reverse().find((m) => m.role === 'user');
  const text = typeof user?.content === 'string' ? user.content : '';
  const tools = (req.tools || []).map((t) => t.function && t.function.name);
  const out = { status: 200, delaySeconds: 0 };

  const delay = text.match(/\[stub:delay=(\d+(?:\.\d+)?)\]/);
  if (delay) out.delaySeconds = Number(delay[1]);

  if (text.includes('[stub:500]')) return { ...out, status: 500, body: { error: { message: 'stub: internal error' } } };
  if (text.includes('[stub:garbage]')) return { ...out, body: 'this is <not> json {{' };
  if (text.includes('[stub:empty]')) return { ...out, body: { choices: [] } };
  if (text.includes('[stub:notool]')) {
    return { ...out, body: { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'I will not call a tool.' } }] } };
  }
  const raw = text.match(/\[stub:argstring=([^\]]*)\]/);
  if (raw) return { ...out, body: toolReply(tools[0] || 'none', raw[1]) };
  const marker = text.match(/\[stub:tool=([A-Za-z0-9_.-]+)(?:\s+args=(\{.*?\}))?\]/s);
  if (marker) {
    let args = {};
    if (marker[2]) { try { args = resolveArgs(JSON.parse(marker[2])); } catch { return { ...out, body: toolReply(marker[1], marker[2]) }; } }
    return { ...out, body: toolReply(marker[1], args) };
  }

  const lower = text.toLowerCase();
  for (const r of replies.replies) {
    if (lower.includes(r.match.toLowerCase()) && (tools.length === 0 || tools.includes(r.tool))) {
      return { ...out, body: toolReply(r.tool, resolveArgs(r.arguments)) };
    }
  }
  const fb = replies.fallback;
  const name = tools.includes(fb.tool) ? fb.tool : (tools[0] || fb.tool);
  return { ...out, body: toolReply(name, tools.includes(fb.tool) ? resolveArgs(fb.arguments) : {}) };
}

const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, 'ok');
  if (req.url === '/requests/last') return received.length ? send(200, received[received.length - 1]) : send(404, { error: 'none' });
  if (req.url === '/requests') {
    if (req.method === 'DELETE') { received.length = 0; return send(200, { count: 0 }); }
    return send(200, { count: received.length });
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: 'not found' });
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'bad json' }); }
    received.push(parsed);
    const d = decide(parsed);
    setTimeout(() => send(d.status, d.body), d.delaySeconds * 1000);
  });
});
server.listen(Number(process.env.PORT || 8080), () => console.log('llm-stub listening')); // never logs request content
