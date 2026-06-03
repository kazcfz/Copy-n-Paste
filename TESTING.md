# Testing

## Local smoke tests

Run the local extension smoke suite:

```sh
npm run build
npm run test:smoke
```

This covers the extension overlay against local fixtures, including direct file inputs, picker proxies, drag-and-drop targets, and pickerless upload buttons.

## Authenticated real-site tests

Run authenticated real-site checks after building the extension:

```sh
npm run build
npm run test:sites
```

The real-site suite reuses `playwright-profiles/real-sites`, so log in once and keep that profile for subsequent runs.

Current real-site targets include:

- Google Contacts
- LinkedIn
- Bluesky
- Gemini

To limit the run to one or more targets:

```powershell
$env:CNP_SITE_TARGETS='bsky,gemini'; npm run test:sites; Remove-Item Env:CNP_SITE_TARGETS -ErrorAction SilentlyContinue
```

Keep `CNP_BROWSER_CHANNEL` empty when running Chromium extension tests so the unpacked extension can load:

```powershell
$env:CNP_BROWSER_CHANNEL=''; npm run test:sites; Remove-Item Env:CNP_BROWSER_CHANNEL -ErrorAction SilentlyContinue
```

## Manual diagnostics

Use the headed diagnostic browser when a live site diverges from the local smoke fixtures:

```powershell
$env:CNP_BROWSER_CHANNEL=''; npm run diagnose:sites -- bsky gemini; Remove-Item Env:CNP_BROWSER_CHANNEL -ErrorAction SilentlyContinue
```

This opens the persistent Playwright profile and logs:

- manual click steps
- file input creation and activation
- overlay upload activation events
- upload-related UI add/remove events

## Native picker diagnostics

By default, Playwright can intercept chooser events for logging. That is useful for automated diagnostics, but it can suppress the visible Windows file picker.

To let the native Windows file picker appear during manual diagnostics, disable chooser interception:

```powershell
$env:CNP_BROWSER_CHANNEL=''; $env:CNP_INTERCEPT_FILE_CHOOSER='0'; npm run diagnose:sites -- bsky gemini; Remove-Item Env:CNP_BROWSER_CHANNEL -ErrorAction SilentlyContinue; Remove-Item Env:CNP_INTERCEPT_FILE_CHOOSER -ErrorAction SilentlyContinue
```

Use this mode when verifying whether clicking the overlay `Upload Files` row opens the actual OS picker.

## Suggested workflow

1. Run `npm run build`.
2. Run `npm run test:smoke`.
3. If a regression only reproduces on a live site, run `npm run diagnose:sites` and log in through the persistent profile.
4. Run `npm run test:sites` for the affected targets.
5. If the issue is specifically about the visible Windows picker, rerun diagnostics with `CNP_INTERCEPT_FILE_CHOOSER='0'`.