# Architecture Decision: Option A — Multi-tenant Code, Single-tenant Deployment

**Decided.** This is the deployment model for all operators.

## What this means

The codebase is written multi-tenant (operators table, operator-scoped queries everywhere), but each client gets their own dedicated deployment:

- Their own Vercel project (billed to them)
- Their own Railway project + PostgreSQL database (billed to them)
- Their own domain pointing at their own deployment
- Their database has exactly one row in `operators` — themselves

## Why not a shared central platform

- Clients own their infrastructure from day one — clean termination clause, no data handover needed
- Data isolation is free (separate databases), not a code concern
- If one client's deployment has an issue, it doesn't affect anyone else
- The code is identical regardless of deployment model

## Onboarding a new operator

1. Fork the repo
2. Create their Vercel + Railway projects on their accounts
3. Run Drizzle migrations against their fresh database
4. Seed their `operators` row + vessels + products
5. Configure their Stripe Connect account
6. Point their domain at their Vercel deployment
7. ~2-3 hours total

## The one hard rule

**Never build cross-operator features.** No admin views that aggregate across clients, no analytics that span deployments. Every DB query must be scoped to `operator_id`. This keeps each deployment safe and the codebase honest about what it is.
