# RundfunkArr fork development

## Purpose

This fork aims to replace an external Sonarr/Radarr compatibility proxy with
native, tested RundfunkArr fixes and optional integrations. Read
`docs/proxy-retirement-plan.md` before changing behavior. Re-check upstream
before implementing a workaround: some historical defects are already fixed.

## Repository workflow

- `origin`: `superions/rundfunkarr`; `upstream`: `rundfunkarr/rundfunkarr`.
- Keep `main` compatible with upstream. Work on focused `codex/<topic>` branches.
- Prefer small, upstreamable commits and regression tests over a permanent fork.
- Follow `CONTRIBUTING.md`: German documentation, English code/comments and
  Conventional Commit messages.
- Do not push to upstream or open upstream issues/PRs without user direction.

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
