# Plan: Process pre-order messages (workflow + generic LLM Extract activity)

Spec: [specs/2026-11-20-process-preorder.spec.md](../../specs/2026-11-20-process-preorder.spec.md) (Draft). Builds on the backend order spec. One bounded context: orders. This plan replaces an earlier version that predated the spec rewrite (it mentioned a webhook, `ChannelMessageId` and `Order.SourceMessage`, none of which the spec now has).

## Scope

- Non-goals (must NOT be built): channel receiving (webhook, Zalo), outbound replies, editing or cancelling orders, orders app UI or `OrdersApi` changes, training, attachments, multi-tenant, production hosting.
- Slice 5 Metrics (P24) is out of this run; it waits on backend gap G1. P23 is logs only.
- Decisions per the spec: D2 one order per message (multi is `Rejected`, reason `multiple`), D3 chosen by the workflow designer (T3 picks the simplest approach and documents it in the README), D5 missing date is `Rejected`, D7 keep, D8 admin only.
- The spec is never edited. Spike findings go to `docs/plans/2026-11-20-process-preorder.spike.md`. If spike items 1, 3 or 4 fail (spec fallback), stop and escalate.

## Tasks (spec slices 0 to 4)

| # | Task | Spec | File scope | Depends on | Acceptance |
|---|---|---|---|---|---|
| T0 | Spike on OC 3.0.1, "Not verified" items 1 to 8 (item 8 only if Ollama is reachable, else "unverified"; item 7 informational). No production code, throwaway code stays out of git. | Slice 0 | `docs/plans/2026-11-20-process-preorder.spike.md` | none | Pass/fail/unverified per item with evidence; go/no-go for T1 to T4 |
| T1 | Schema: `Order.SourceContentItemId` field, sample `ChannelMessage` type (`Channel`, `SenderName`, `Text`, `SentAt`, no status fields), Workflows features enabled, `Kitchen` denied on `ChannelMessage` and workflows, k6 test. | Data, P22, P25 | `backend/Bpb.Backend/Recipes/BpbOrders.recipe.json`, `backend/k6/**` | T0 | Recipe provisions with no admin clicks; Kitchen gets 403; existing orders GraphQL shape unchanged; k6 passes |
| T2 | Module `Bpb.Workflows.Llm` (E1 to E11): `LlmExtractTask`, display driver and views, `ILlmClient` + `ChatCompletionsClient`, `LlmOptions`; `Bpb.Workflows.Llm.Tests`; `llm-stub`; Ollama service in compose; `.env.example`; Makefile model pull; one k6 test with a tiny workflow through the activity; enable module in recipe. | E1 to E11, P20 | `backend/Bpb.Workflows.Llm/**`, `backend/Bpb.Workflows.Llm.Tests/**`, `backend/llm-stub/**`, `backend/docker-compose.yml`, `backend/.env.example`, `backend/Bpb.Backend/Bpb.Backend.csproj`, `backend/Bpb.Backend/Recipes/BpbOrders.recipe.json`, `backend/k6/**`, `Makefile` | T0, T1 | Unit tests cover every case in the spec's Unit row; no prompts logged; module depends only on Orchard Core |
| T3 | `ExtractOrder` workflow in the recipe (P9 to P19), `No` per designer, pipeline k6 tests (order, not an order, invalid qty, past date, LLM 500, timeout, garbage, injection, replay creates one order, a second content type), `llm-stub` canned replies. | P9 to P19, P22, P25 | `backend/Bpb.Backend/Recipes/BpbOrders.recipe.json`, `backend/k6/**`, `backend/llm-stub/**`, `backend/README.md` | T1, T2 | All Pipeline-row scenarios pass via `make test-backend` |
| T4 | Operate: structured log field `SourceContentItemId` (+ trace ids) on workflow run and order, retry procedure and README section, Playwright e2e (message via API shows in orders app). | P23, P18 doc, Acceptance 4, 5 | `backend/README.md`, `backend/Bpb.Backend/**` (logging only), `apps/e2e/**`, `Makefile` | T3 | Logs carry the id and never message text or secrets; `make stack-up` provisions with no admin clicks; e2e passes |

Sequential T0 → T1 → T2 → T3 → T4 (shared recipe and csproj). Each: worker → `git status` scope check → fresh reviewer → my commit.

## Acceptance for the run

Spec Acceptance criteria 1 to 5, with the LLM served by `llm-stub` in tests.

## Commands

`dotnet build` / `dotnet test` under `backend/`; `make stack-up`, `make test-backend`; Playwright in `apps/e2e`.
