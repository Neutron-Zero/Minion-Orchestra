If `../CLAUDE.md` exists, read it first for org-wide rules.

# Minion Orchestra App

## Repo Structure
- `origin` = Bitbucket (minion-orchestra-app) — full commit history, normal pushes
- GitHub (Neutron-Zero/Minion-Orchestra) — clean release history, NOT a remote on this repo

## GitHub Release Process
GitHub has a separate `github-release` local branch (orphan, no shared history with `main`).
To push a new release to GitHub:
```bash
git checkout github-release
git checkout main -- .                  # overlay current files from main
git add -A
git commit -m "v<VERSION>"
git remote add github https://github.com/Neutron-Zero/Minion-Orchestra.git
git push github github-release:main
git remote remove github
git checkout main
```
- Each release appears as a single commit on GitHub (v1.8.0 → v1.9.0 → ...)
- Bitbucket keeps the full granular commit history
- The `github` remote is added temporarily for the push, then removed

## Build / Commit Rules
- NEVER build, commit, or push without asking the user first
- NEVER run `ng build` -- the dev server (`npm run dev`) hot-reloads automatically
- The user manages their own build/dev process
- Build command (when asked): `cd packages/client && ng build`
- Server version in `packages/server/server.py` (VERSION constant)
