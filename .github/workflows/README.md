# GitHub Actions Workflows

## Workflows

| File | Trigger | What it does |
|---|---|---|
| `mobile-checks.yml` | PR targeting `main` touching `apps/mobile/**` or `packages/**` | TypeScript typecheck + `expo-doctor` validation. Posts a PR comment explaining failures. |
| `mobile-preview.yml` | Push to `main` touching `apps/mobile/**` or `packages/**` | EAS Build (`preview` profile, all platforms) + EAS Update (OTA push to the `main` branch). |
| `mobile-release.yml` | Push of a `v*` tag (e.g. `v1.0.0`) | EAS Build (`consumer` profile, all platforms) then `eas submit` to App Store + Google Play. |
| `web-checks.yml` | PR targeting `main` touching `apps/web/**` or `packages/**` | TypeScript typecheck + full Next.js build (catches build-time errors). |

## Required GitHub Secrets

Add one secret under **Settings → Secrets and variables → Actions**:

| Secret | How to get it |
|---|---|
| `EXPO_TOKEN` | expo.dev → Account Settings → Access Tokens → Create token |

## Apple & Google Credentials (EAS, not GitHub)

Apple App Store and Google Play credentials are stored securely inside EAS — not in GitHub secrets. To configure them, run locally:

```bash
cd apps/mobile
eas credentials
```

EAS will walk you through uploading your Apple distribution certificate + provisioning profile and your Google service account key. Once stored in EAS, `eas submit` in CI pulls them automatically with just `EXPO_TOKEN`.

## How to Trigger a Production Release

1. Ensure `main` is in the state you want to ship.
2. Create and push a semver tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `mobile-release.yml` workflow starts automatically and builds + submits to both stores.

## OTA Update Strategy

- **`main` branch** always reflects the latest preview. Every merge to `main` runs an EAS Update, so preview-profile installs get JS updates over the air within minutes.
- **Production releases** are gated behind a `v*` tag. Native binary changes (new SDK, new native deps) require a new tagged release; pure JS/asset changes can ship as OTA updates between releases.
