If `../CLAUDE.md` exists, read it first for org-wide rules.

# Minion Orchestra App

## Repo Structure
- `origin` = Bitbucket (minion-orchestra-app)
- `github` = GitHub (Minion-Orchestra)
- Push to both remotes when asked: `git push` + `git push github main`

## Build / Commit Rules
- NEVER build, commit, or push without asking the user first
- NEVER run `ng build` -- the dev server (`npm run dev`) hot-reloads automatically
- The user manages their own build/dev process
- Build command (when asked): `cd packages/client && ng build`
- Server version in `packages/server/server.py` (VERSION constant)
