# Crash Relay Worker

A small HTTPS endpoint that accepts sanitized crash reports and turns them into GitHub Issues.
Reports sharing a fingerprint are appended as comments to the same open `crash` issue.

## Deploy in four steps

1. Install the Wrangler CLI and sign in to your Cloudflare account. Create a GitHub token with
   `Issues: write` scope for the target repository.

2. Authenticate the CLI from this directory:

   ```sh
   cd workers/crash-relay
   wrangler login
   ```

3. Deploy the worker and copy the HTTPS URL it prints:

   ```sh
   wrangler deploy
   ```

4. Store the two runtime secrets (never put them in `wrangler.toml`):

   ```sh
   wrangler secret put GITHUB_TOKEN
   wrangler secret put GITHUB_REPO
   ```

   `GITHUB_REPO` has the form `owner/repository`. Afterwards, build the desktop app with
   `ONE_RING_CRASH_RELAY_URL` set to the deployed HTTPS URL and enable **automatic crash
   reporting** in Settings. Reports stay on disk only until that opt-in is enabled.

## Endpoint contract

`POST /` accepts a JSON crash report smaller than 64 KiB with these fields:
`id`, `timestampUtc`, `appVersion`, `os`, `arch`, `kind` (`rust_panic` or `frontend_error`),
`message`, `location`, `stack`, and `fingerprint`.

Success returns `{ "ok": true, "issueUrl": "...", "deduplicated": false }`.
