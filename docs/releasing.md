# Releasing the @inclusive-ai packages

All eight packages are released together, at one version, from this repository:

| Package | Directory |
|---|---|
| `@inclusive-ai/eval-core` | `core/eval-engine` |
| `@inclusive-ai/domain-identity` | `domains/identity` |
| `@inclusive-ai/domain-healthcare` | `domains/healthcare` |
| `@inclusive-ai/domain-employment` | `domains/employment` |
| `@inclusive-ai/domain-education` | `domains/education` |
| `@inclusive-ai/domain-content` | `domains/content` |
| `@inclusive-ai/adversarial` | `packages/adversarial` |
| `@inclusive-ai/eval` | `packages/eval` |

Pushing a tag `eval-v<version>` runs `.github/workflows/publish-eval.yml`. It checks that the tagged commit is on `main` and that the tag matches every package, builds, typechecks and tests everything, then publishes the packages to npm with dependencies first. A version that is already on npm is skipped, so a release that stopped partway can be re-run.

## One-time setup

The workflow has no npm token. npm trusts this repository's workflow directly (OIDC trusted publishing), and every release gets a provenance attestation. npm checks the repository, the workflow file and the environment, but not which branch or tag ran it, so the GitHub side has to restrict that.

### 1. GitHub: protect the environment and the release tags

Do this before the first release tag, so the first release is already protected.

1. **Settings → Environments → New environment**, named `npm`.
   - **Required reviewers:** add yourself, so every release waits for your approval.
   - **Deployment branches and tags:** "Selected branches and tags", with one rule of type **Tag** and pattern `eval-v*`.
2. **Settings → Rules → Rulesets → New tag ruleset**, targeting tags matching `eval-v*`. Restrict creations, updates and deletions, and leave only yourself on the bypass list, so nobody else can push or move a release tag.

### 2. npm: add the trusted publisher to each package

For **each** of the eight packages, on npmjs.com:

1. Open the package, then **Settings → Trusted Publisher → GitHub Actions**.
2. Enter:
   - **Organization or user:** `MichaelVacirca`
   - **Repository:** `inclusive-eval-lab`
   - **Workflow filename:** `publish-eval.yml`
   - **Environment name:** `npm`
3. Under allowed actions, tick **`npm publish`**. New trusted publishers default to staged publishing only, and the release has to publish directly.
4. Save.

npm doesn't check the settings when you save them. A typo shows up only during a release, as an authentication error on that package.

The same setup from a terminal, logged in to npm as the packages' owner:

```bash
for pkg in eval-core domain-identity domain-healthcare domain-employment domain-education domain-content adversarial eval; do
  npm trust github "@inclusive-ai/$pkg" --file publish-eval.yml --repo MichaelVacirca/inclusive-eval-lab --env npm --allow-publish
done
```

### 3. After the first release has gone out

1. On npmjs.com, for **each** package, set **Settings → Publishing access** to "Require two-factor authentication and disallow tokens", so only the trusted publisher (or you, with 2FA) can publish.
2. Delete the old `NPM_TOKEN` repository secret if it exists (Settings → Secrets and variables → Actions), and revoke that token on npmjs.com (Access Tokens). Nothing uses it any more.

## Cutting a release

1. Bump every package and its internal dependency ranges, then update the lockfile:

   ```bash
   node scripts/release.mts bump 3.4.0
   npm install --package-lock-only
   node scripts/release.mts check
   ```

2. Commit, open a pull request, and merge it once CI is green. CI runs `node scripts/release.mts check` on every change.
3. Tag the merge commit on `main` and push the tag. Push one release tag at a time.

   ```bash
   git tag eval-v3.4.0 <merge commit>
   git push origin eval-v3.4.0
   ```

4. Approve the **Publish @inclusive-ai packages** run when GitHub asks, and watch it.

If a release fails partway because of something outside the repository (a trusted-publisher typo, a registry outage), fix that and re-run the job; packages that already went out are skipped. If the fix needs a code change, release it as a new version, because a tag stays on its commit.

A prerelease version such as `3.4.0-beta.1` is published under the `next` dist-tag, so `npm install @inclusive-ai/eval` keeps getting the latest stable release. Stable versions get `latest` from npm itself, which refuses to move `latest` back to a lower version.

To see exactly what would be published without publishing anything:

```bash
npm run build
node scripts/release.mts publish eval-v3.4.0 --dry-run
```
