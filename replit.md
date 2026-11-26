# Outreach Autopilot

Multichannel sales outreach automation: campaigns sequence cold emails, LinkedIn messages and cold calls; an AI agent replies to inbound messages automatically, writes call scripts and summarizes calls.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` (Replit AI Integrations)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; DB: PostgreSQL + Drizzle ORM; Zod validation; Orval codegen
- AI: OpenAI via Replit AI Integrations (`lib/integrations-openai-ai-server`)
- Frontend: React + Vite (`artifacts/outreach`, served at `/`)

## Where things live

- API contract: `lib/api-spec/openapi.yaml`
- DB schema: `lib/db/src/schema/outreach.ts`
- AI prompts: `artifacts/api-server/src/lib/ai.ts`
- Automation engine (sequence runner, auto-reply loop, scheduler): `artifacts/api-server/src/lib/outreach.ts`
- Frontend pages: `artifacts/outreach/src/pages/`

## Architecture decisions

- Auto-reply loop: inbound message → AI classifies sentiment + lead status → if global and campaign auto-reply are on (and the reply is not negative/objection while "escalate negative" is on) the AI reply is sent, otherwise the conversation is flagged `needs_review`.
- Any inbound reply stops the automated sequence for that lead (`nextStepAt = null`).
- An in-process scheduler runs due sequence steps for all `active` campaigns every 60 seconds.
- Real delivery: email via user-added SMTP mailboxes (IMAP reply sync, daily limits/warm-up, open tracking, unsubscribe), LinkedIn via Unipile, AI voice calls via Vapi — all configured in Settings. With nothing configured, outbound messages are kept in-app only. Inbound replies also arrive via `POST /api/webhooks/inbound` or "simulate reply".
- Apollo (user's own key, secret `Apollo_api_key`, billed by Apollo): Find leads page (people search + reveal/import) needs a paid Apollo plan; company details (industry, size, location, LinkedIn) via organization enrich work on the free plan and run automatically for new leads with a website or work email.
- Mailbox SMTP/IMAP passwords are stored unencrypted in the DB (known; revisit before production).
- The GitHub repo (productmanthana/marketingproduct) is the code exchange point; the workspace itself is not a git repo, so PRs are applied by copying changed files in.
- Message tables are named `outreach_conversations` / `outreach_messages` to avoid clashing with the AI integration's template tables.

## Product

Dashboard, campaigns with AI-generated multichannel sequences, leads (CSV import), unified inbox with AI auto-reply and AI drafts, call queue with AI scripts and summaries (summary auto-sends a recap email), settings.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
