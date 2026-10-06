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

The same workflow also publishes the `inclusive-eval` alias in `alias/`. It's released on its own, with its own version and `alias-v<version>` tags; see [Releasing the inclusive-eval alias](#releasing-the-inclusive-eval-alias).

## One-time setup

The workflow has no npm token. npm trusts this repository's workflow directly (OIDC trusted publishing), and every release gets a provenance attestation. npm checks the repository, the workflow file and the environment, but not which branch or tag ran it, so the GitHub side has to restrict that.

### 1. GitHub: protect the environment and the release tags

Do this before the first release tag, so the first release is already protected.

1. **Settings → Environments → New environment**, named `npm`.
   - **Required reviewers:** add yourself, so every release waits for your approval.
   - **Allow administrators to bypass configured protection rules** is ticked by default. Untick it if the approval should also apply to you as an admin.
   - **Deployment branches and tags:** "Selected branches and tags", with two rules of type **Tag**: pattern `eval-v*` and pattern `alias-v*`.
2. **Settings → Rules → Rulesets → New tag ruleset**, targeting tags matching `eval-v*` and `alias-v*`. Restrict creations, updates and deletions, and leave only yourself on the bypass list, so nobody else can push or move a release tag.

### 2. npm: add the trusted publisher to each package

For **each** of the eight packages, and for `inclusive-eval`, on npmjs.com:

1. Open the package, then **Settings → Trusted Publisher → GitHub Actions**.
2. Enter:
   - **Organization or user:** `MichaelVacirca`
   - **Repository:** `inclusive-eval-lab`
   - **Workflow filename:** `publish-eval.yml`
   - **Environment name:** `npm`
3. Under allowed actions, tick **`npm publish`**. New trusted publishers default to staged publishing only, and the release has to publish directly. npm labels direct publishing "Not recommended" because staged versions wait for a manual promotion on npmjs.com; here the required reviewer on the `npm` environment is that human gate instead. Leave **Allow npm dist-tag** unticked: the workflow never runs `npm dist-tag` (a prerelease's `next` tag travels inside the publish request).
4. Save.

npm doesn't check the settings when you save them, and a saved trusted publisher can't be edited ("Cannot be changed later"). A typo shows up only during a release, as an authentication error on that package; to fix it, delete that connection and add a new one.

The same setup from a terminal, logged in to npm as the packages' owner:

```bash
for pkg in eval-core domain-identity domain-healthcare domain-employment domain-education domain-content adversarial eval; do
  npm trust github "@inclusive-ai/$pkg" --file publish-eval.yml --repo MichaelVacirca/inclusive-eval-lab --env npm --allow-publish
done
npm trust github inclusive-eval --file publish-eval.yml --repo MichaelVacirca/inclusive-eval-lab --env npm --allow-publish
```

### 3. After the first release has gone out

1. On npmjs.com, for **each** package, `inclusive-eval` included, set **Settings → Publishing access** to "Require two-factor authentication and disallow bypass 2fa tokens (recommended)", so only the trusted publisher (or you, with 2FA) can publish. npm's documentation calls this "Require two-factor authentication and disallow tokens".
2. Delete the old `NPM_TOKEN` repository secret if it exists (Settings → Secrets and variables → Actions), and revoke that token on npmjs.com (Access Tokens). Nothing uses it any more.

## Cutting a release

1. Bump every package and its internal dependency ranges, then update the lockfile:

   ```bash
   node scripts/release.mts bump 3.4.0
   npm install --package-lock-only
   node scripts/release.mts check
   ```

   For a new major version, also move the alias's `@inclusive-ai/eval` range in `alias/package.json` to the new major (`^4.0.0` for 4.0.0) in the same pull request; `check` fails until you do.

2. Commit, open a pull request, and merge it once CI is green. CI runs `node scripts/release.mts check` on every change.
3. Tag the merge commit on `main`, one release at a time. Either push the tag:

   ```bash
   git tag eval-v3.4.0 <merge commit>
   git push origin eval-v3.4.0
   ```

   or, on GitHub, open **Releases → Draft a new release**, type `eval-v3.4.0` as a new tag with target `main`, and publish the release. Either way only a repository admin can create the tag, because of the `eval-v*` tag ruleset; automation without admin rights, such as a coding agent's push, is refused.

4. Approve the **Publish npm packages** run when GitHub asks, and watch it.

A new version can take several minutes to show up on npm after the run publishes it (npm says "Your package is being processed"), and packages from the same run can appear at different times. Wait for all of them before installing the release or re-running the job; a re-run inside that window fails harmlessly, because npm refuses to publish over a version it already accepted.

If a release fails partway because of something outside the repository (a trusted-publisher typo, a registry outage), fix that and re-run the job; packages that already went out are skipped. If the fix needs a code change, release it as a new version, because a tag stays on its commit.

A prerelease version such as `3.4.0-beta.1` is published under the `next` dist-tag, so `npm install @inclusive-ai/eval` keeps getting the latest stable release. Stable versions get `latest` from npm itself, which refuses to move `latest` back to a lower version.

To see exactly what would be published without publishing anything:

```bash
npm run build
node scripts/release.mts publish eval-v3.4.0 --dry-run
```

## Releasing the inclusive-eval alias

`inclusive-eval` (in `alias/`) lets `npx inclusive-eval` run the CLI with the SDK included. It has no code of its own beyond `bin.js`, which starts `@inclusive-ai/eval`'s CLI. It isn't a workspace, so `npm ci` and the `eval-v*` releases leave it alone, and it keeps its own version.

`node scripts/release.mts check` (which CI runs) also checks the alias:
- its SDK range must equal the root `package.json`'s, so a change to the root SDK range fails CI until the alias follows;
- its `@inclusive-ai/eval` range must be a caret range in this repository's major version, no higher than the version here (a prerelease suffix here is ignored, so `^4.0.0` passes while `main` is at `4.0.0-beta.1`; the publish step still waits for 4.0.0 on npm);
- it must depend on nothing else, have no scripts, and point npm at this repository with `directory` `alias`.

CI keeps the alias on `main` in step with the root SDK range, but the published alias only changes when it is released. When a CLI release moves the root SDK range, release the alias right after that CLI release, or `npx inclusive-eval` runs the new CLI with the old SDK.

Before the first `alias-v*` tag, check the one-time setup covers the alias (it fails safe if it doesn't: the run is refused or the publish is rejected):
- the `npm` environment has a tag rule for `alias-v*`, and the tag ruleset targets `alias-v*`;
- `inclusive-eval` has the trusted publisher on npmjs.com;
- once its first trusted-publishing release is out, its publishing access disallows tokens.

To release it:

1. Edit `alias/package.json`: raise `version`, and change the dependency ranges if needed. Run `node scripts/release.mts check`.
2. Commit, open a pull request, and merge it once CI is green.
3. Tag the merge commit on `main` as `alias-v<version>`, the same way as an `eval-v*` tag:

   ```bash
   git tag alias-v1.0.3 <merge commit>
   git push origin alias-v1.0.3
   ```

4. Approve the run. For an `alias-v*` tag the workflow skips the install, build and tests, checks the alias, checks that the `@inclusive-ai/eval` version its range starts at is already on npm, and publishes `alias/`.

Release the CLI first when the alias needs a new one: an alias that asks for an `@inclusive-ai/eval` version npm doesn't have yet is refused.
