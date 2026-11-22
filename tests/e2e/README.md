# E2E smoke tests

`cdp-voice-smoke.mjs` drives Microsoft Edge over Chrome DevTools Protocol against the local dev servers. It uses fake microphone media, so it verifies the app path and honest provider errors without needing real speech or provider keys.

## Prerequisites

1. Start the dev servers from the repo root:

   ```powershell
   npm run dev
   ```

2. Launch Edge with remote debugging and fake media:

   ```powershell
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir="$env:TEMP\nexus-edge-cdp" `
     --no-first-run --no-default-browser-check `
     --use-fake-ui-for-media-stream `
     --use-fake-device-for-media-stream `
     --autoplay-policy=no-user-gesture-required `
     "http://localhost:3000/login"
   ```

3. Run the smoke test:

   ```powershell
   node tests/e2e/cdp-voice-smoke.mjs
   ```

The script registers a temporary user through the API, injects the session into the browser, opens the dashboard, presses Start/Stop listening, and prints the resulting page state plus console/page errors. With no provider keys it should end in the honest `provider-not-configured` error state, not a fake answer.
