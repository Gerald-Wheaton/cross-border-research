# Cross-Borders Rule Verification

A Next.js dashboard that uses AI to verify and update a tax/compliance rules knowledge base for US, India, and cross-border transactions.

## What it does

The app pulls rules from a Postgres database — each rule describes a tax, remittance, or compliance requirement — and runs an AI verification job against three fields per rule:

- `trigger_condition` — when the rule applies
- `legal_source` — the authoritative legal citation
- `edge_cases` — notable exceptions or edge behaviors

The AI (via Perplexity) researches each field, produces a revised text, a verdict (`correct` / `partially correct` / `incorrect`), source URLs, and an explanation. Results are written back to the database alongside the originals so they can be compared side-by-side in the dashboard.

## Stack

- **Next.js 16** — app router, server actions
- **Postgres (Neon)** — rules knowledge base
- **Perplexity** — research provider for AI verification
- **Tailwind + Radix UI** — dashboard UI

## Running locally

```bash
cp .env.example .env   # add DATABASE_URL and PERPLEXITY_API_KEY
bun install
bun dev
```

The dashboard is at `http://localhost:3000`. Start a verification job from the UI or hit `POST /api/job` directly.

## Database

Schema is documented in [`.codex/database.md`](.codex/database.md). Core tables: `rule`, `jurisdiction`, `category`, `verification_status`, `rule_interaction`.
