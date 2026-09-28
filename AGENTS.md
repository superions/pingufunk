# Pingufunk (RundfunkArr fork) development

## Purpose

This fork aims to replace an external Sonarr/Radarr compatibility proxy with
native, tested RundfunkArr fixes and optional integrations. **PostgreSQL is a
mandatory target, not an optional optimization.** Read
`todo/proxy-retirement.md` (the sole executable phased contract),
`docs/proxy-retirement-plan.md`, its review and `docs/postgresql-migration-plan.md`
before changing the relevant behavior. Re-check upstream before implementing a
workaround: some historical defects are already fixed.

This guide contains Pingufunk-specific adaptations of useful Myoxus working
practices, not Myoxus's deployment or product architecture. The active user
request determines scope; a plan or skill never supplies deployment permission.

## Architecture and persisted contracts

- `src/app/api/`: Next.js route and transport contracts, including Newznab and
  SAB-compatible download APIs. `src/services/`: matching, metadata, rules and
  downloads. `src/providers/`: content providers. `src/server/`: download workers
  and media processing. `src/lib/`: shared infrastructure. `prisma/`: schema and
  migrations. Check the actual owner before introducing a new abstraction.
- Keep authoritative identity, language, matching, secrets and persistence
  decisions server-side. Prefer an existing structured owner over a second
  parser, XML-rewrite layer or independent client-side business model.
- Preserve shipped IDs, RSS/NZB identity, public categories, queue/history,
  file paths and configuration through an explicit tested transition. Do not
  invent compatibility layers for behavior that never shipped. Do not relabel
  ambiguous content as the requested series, film, episode or language.
- The future active runtime is PostgreSQL. SQLite is a legacy migration source
  and a bounded rollback artifact; it must not remain the final production
  backend or silently become a runtime fallback after a PostgreSQL failure.
- Use a new PostgreSQL-native migration chain. Preserve historical SQLite SQL
  as recovery input/history; never replay it against PostgreSQL or copy its
  `_prisma_migrations` ledger into the target. Applied migrations are append-only.
  Review schema, generated client, initialization and real source data together.
- Do not combine the database cutover, new matching semantics, worker replica
  increases and proxy removal into one unreviewable deployment. PostgreSQL alone
  does not make the current in-process download queue safe for multiple replicas.

## Repository workflow

- `origin`: `superions/pingufunk`; `upstream`: `rundfunkarr/rundfunkarr`.
- Keep `main` compatible with upstream. Work on focused `codex/<topic>` branches.
- Prefer small, upstreamable commits and regression tests over a permanent fork.
- Follow `CONTRIBUTING.md`: German documentation, English code/comments and
  Conventional Commit messages.
- Do not push to upstream or open upstream issues/PRs without user direction.
- Preserve unrelated dirty work. Do not reset, clean, force-push or rewrite
  published history to simplify a task. Inspect branch, remotes and changes first.
- Commit and push coherent completed checkpoints to the own fork's topic branch
  during long implementation tasks. A pushed checkpoint is not a release,
  deployment or proof that another checkout or served bundle changed.
- Generate Prisma clients and other generated artifacts with their actual tools;
  do not hand-edit them. Inspect staged paths for local config, audit artifacts
  and database dumps before committing.
- Keep approved plan scope, dependencies and acceptance criteria intact during
  implementation. Mark completion only after the stated requirements are met;
  report new findings instead of silently weakening the contract. Change that
  contract only in an authorized planning/replanning task.

## Safety and verification

- Development only by default. No production deployment, proxy removal,
  live library searches/grabs, service restarts or database migration without
  explicit authorization for that operation.
- Never commit credentials, private infrastructure details, live API responses,
  real configuration databases, or downloaded media. Use synthetic fixtures,
  ignored local environment files and secret-file support for integrations.
- Do not copy the private proxy source wholesale into this public fork. Extract
  behavior into independently implemented fixes and sanitized regression cases.
- Use Node.js >=24 and `npm ci`. Run `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run format:check`, and `npm run build` as appropriate.
  Report existing failures separately from regressions caused by a change.
- Frontend verification is desktop-only. No mobile/compact/device tests.
- Tests must mock Sonarr, Radarr, metadata providers and download sources unless
  a specific integration test is separately authorized. Use disposable local
  databases; never connect tests to production.
- Review fork CI before enabling publication: upstream uses Blacksmith runners
  and publishes images. Do not assume the fork has the same runner entitlement.
- Keep integration credentials server-side, redact logs, bound retries/timeouts,
  and fail closed on uncertain series/episode/language matches.
- Database connection URLs are secrets too. Never print them, including DEBUG
  output, errors, subprocess arguments or screenshots. Use ignored local
  environment files or mounted secret files; no credentials in examples.
- A migration must back up, check source integrity, validate semantic data
  equality and rehearse rollback. Never use `migrate reset`, production
  `migrate dev`, automatic truncation, or `db push` as a production migration.
  Resolve the actual DB, schema, instance and role before any authorized write.
- Separate development, disposable test and production runtimes. Do not infer
  hosts, SSH targets, credentials, container names or database versions from
  another project. Preserve existing Swarm/HAProxy/network/volume/secret topology.

## Verification and evidence

- Select gates from current `package.json`, tests and workflow definitions.
  Use focused tests for diagnosis, then the relevant owning suite at the coherent
  milestone. The normal implementation gates remain `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run format:check` and `npm run build` as appropriate.
- Tests must fail for the actual protected behavior. Status 200, nonempty XML,
  source-string assertions or an always-successful mock are not sufficient proof
  of matching, data preservation or import safety. Assert the consuming contract
  and negative cases. Do not swallow errors or skip product defects for green CI.
- Database tests must use disposable PostgreSQL instances once P11 is implemented;
  SQLite fixtures are appropriate only for migration/legacy characterization.
  No substitute SQLite-only gate may qualify PostgreSQL support. Tests must clean
  up their own transactions, files, connections and process trees, not shared data.
- Reuse green evidence until a relevant input changes. Documentation edits,
  committing, pushing or elapsed time do not by themselves invalidate product
  tests. Distinguish new execution, reused evidence and unverified gates honestly.
- Bound long-running tests and builds and identify process ownership before
  termination. Do not kill broad process-name patterns or prune shared caches,
  Docker volumes or other tasks' artifacts to cure a hang.
- Visual changes require desktop-only interaction with the actually served
  development/test bundle, matched before/after route/state screenshots and
  browser-console review. A source edit or unit test is not visual verification.
  Do not trigger real searches, grabs or downloads merely for UI QA.
- For nontrivial changes review inline contracts, units, ordering, cancellation,
  cache invalidation and persistence invariants. Keep useful English comments;
  remove stale rationale rather than narrating obvious code or inventing history.
- Put maintained references and runbooks in `docs/`. The user-requested phased
  contract lives in `todo/proxy-retirement.md`; track executable work only there.
  Report systematic findings in the relevant review and reopen the owner TODO.
  Do not add duplicate TODO indexes, ledgers or done archives without a need.

## Repository skills

Read the full applicable SKILL.md before acting and any routed reference needed
for the task. These skills are portable project files under `.agents/skills`;
they do not depend on Myoxus scripts, hosts or a global skill installation.

| Task                                                                 | Skill                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Implementation verification, CI gates and evidence reuse             | [pingufunk-test-gates](.agents/skills/pingufunk-test-gates/SKILL.md)                         |
| Served-runtime diagnosis, hangs and stale bundles                    | [pingufunk-dev-runtime](.agents/skills/pingufunk-dev-runtime/SKILL.md)                       |
| Desktop UI changes or visual review                                  | [pingufunk-visual-qa](.agents/skills/pingufunk-visual-qa/SKILL.md)                           |
| Explicit dependency audit, removal or consolidation                  | [pingufunk-dependency-review](.agents/skills/pingufunk-dependency-review/SKILL.md)           |
| OCI release preparation, publication or verification                 | [pingufunk-container-release](.agents/skills/pingufunk-container-release/SKILL.md)           |
| Nontrivial inline TypeScript/TSX, shell or SQL contracts             | [pingufunk-inline-doc](.agents/skills/pingufunk-inline-doc/SKILL.md)                         |
| PostgreSQL implementation, migration rehearsal or authorized cutover | [pingufunk-postgresql-migration](.agents/skills/pingufunk-postgresql-migration/SKILL.md)     |
| Approved plans/raw findings into executable phased TODOs             | [pingufunk-agentic-todo-authoring](.agents/skills/pingufunk-agentic-todo-authoring/SKILL.md) |

The adaptation rationale and exclusions are documented in
[docs/agent-workflow.md](docs/agent-workflow.md). No subagent delegation is implied;
delegate only when the active user/instructions authorize it.
