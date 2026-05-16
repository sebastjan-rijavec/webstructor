# Releasing Webstructor

How to cut, publish, and deploy a new version.

## Semver in one line

`MAJOR.MINOR.PATCH` — bump **MAJOR** for breaking changes, **MINOR** for new
features, **PATCH** for bug fixes.

While in `0.x.x`, big changes go in **minor**, everything else in **patch**.
Reserve `1.0.0` for the first time you'd be embarrassed to break the editor
for someone using it.

## When to bump what

| Change | Bump |
| --- | --- |
| Bug fix, perf tweak, refactor, doc edit | `patch` |
| New feature, new UI element, new library asset | `minor` |
| Removed/renamed public API, changed default behaviour, scene-file format change | `major` |

If unsure, prefer the smaller bump.

## The release flow

1. Make sure `main` is clean and pushed:
   ```bash
   git status        # working tree clean
   git pull          # main is up to date
   ```
2. Pick the bump:
   ```bash
   npm run release:patch     # 0.1.0 → 0.1.1
   npm run release:minor     # 0.1.0 → 0.2.0
   npm run release:major     # 0.1.0 → 1.0.0
   ```
3. The script does the rest, in order:
   - bumps `package.json`
   - regenerates `CHANGELOG.md` from commits since the last tag
   - creates `chore(release): vX.Y.Z` commit
   - tags `vX.Y.Z` (annotated)
   - pushes commit + tag to `origin/main`
   - creates a GitHub Release with auto-generated notes
   - runs `npm run deploy` (build + rsync to home server)

End-to-end: ~30 seconds plus the build.

## Commit messages

Both formats work, but **conventional commits** make the CHANGELOG much
nicer because each release section is grouped by type.

```
feat: add procedural panel widget          → Features
fix: correct shadow camera frustum bounds  → Bug Fixes
perf: skip redundant re-renders            → Performance
refactor: extract right-rail sections      → Refactor
docs: clarify deploy steps                 → Documentation
build: bump three.js to 0.170              → Build
chore: tidy gitignore                      → Chore
```

The version bump itself is **manual** (`release:patch|minor|major`), so
your commit prefixes only affect the CHANGELOG content, not which kind of
release happens.

## Working on a release in GitHub

The pattern that keeps things organised:

1. **Create a milestone** for each version (`v0.2.0`, `v0.3.0`, ...) under
   the repo's *Milestones* tab.
2. **File issues** for each chunk of scope and attach them to the
   milestone. One issue = one focused unit of work.
3. **Develop on feature branches** — `feature/<short-name>` for non-trivial
   work. Merge back to `main` when ready (close the issue via the merge
   commit using `Closes #42`).
4. When all issues in the milestone are closed, **run the release command
   from `main`**. Close the milestone afterwards.

The `Releases` tab on GitHub will populate automatically (the publish
script creates each release).

## Things that can go wrong

| Symptom | Fix |
| --- | --- |
| `gh release create` fails | `gh auth status` — re-auth if needed |
| `rsync` permission denied | On server: `sudo chown -R seb:seb /var/www/webstructor` |
| Bumped locally but publish step failed | Local commit + tag already exist. Recover with: `git push --follow-tags origin main && node scripts/release-publish.mjs` |
| Released the wrong version | Easier to roll forward with another `release:patch` than to untag |
| Need to retry deploy only | `npm run deploy` |

## Hot fixes for a shipped version

If `v0.2.0` is live and you need an urgent fix without dragging in `main`'s
in-progress work:

```bash
git checkout -b hotfix/<thing> v0.2.0
# fix it, commit
git checkout main
git merge --no-ff hotfix/<thing>
npm run release:patch              # publishes v0.2.1
```

## Pre-releases (alpha / beta)

Rarely needed for this project, but if you want `v0.3.0-alpha.1`:

```bash
npx commit-and-tag-version --prerelease alpha
node scripts/release-publish.mjs   # if you also want to push + deploy
```

Subsequent calls increment the suffix (`alpha.1` → `alpha.2`).

## What lives where

- `package.json` — current version
- `CHANGELOG.md` — auto-generated, do not hand-edit
- `.versionrc.json` — CHANGELOG section configuration
- `scripts/release-publish.mjs` — push + GitHub Release + deploy
- `vite.config.ts` — `base` path baked into the build (currently `/webstructor/`)
