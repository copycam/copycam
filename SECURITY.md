# CopyCam security model

CopyCam moves text you photograph — often literally passwords — from your phone to your PC's clipboard over the local network. This document states exactly what protects that text, and what doesn't.

## Design

**The QR code is the trust root.** When the companion starts, it generates a random 256-bit key, stored in `~/.copycam/key.json` (mode 0600). The pairing QR encodes `http://<lan-ip>:8787/#k=<key>`. Two properties matter:

- The key rides in the **URL fragment**, which browsers never send over the network — it exists only in the QR image and, after scanning, in the phone's localStorage (the app immediately scrubs it from the address bar).
- Scanning the QR requires being physically able to see your screen. That visual channel — not the network — is how the secret is exchanged.

**Every API message is sealed.** Both directions use AES-256-GCM envelopes ([shared/crypto.js](shared/crypto.js)):

- Confidentiality + integrity: a Wi-Fi eavesdropper sees only ciphertext; any tampering fails the GCM tag.
- **Authentication = key possession.** There are no accounts; a request that doesn't decrypt is rejected with no detail.
- **Replay protection**: single-use nonces per server process, plus a 2-minute freshness window stamped inside each encrypted payload (covers cross-restart replays). Each endpoint uses a distinct AAD, so a captured `/api/ocr` payload can't be replayed against `/api/clip`.

**Server hardening** ([server/app.js](server/app.js), [server/index.js](server/index.js)):

- Phones are served over HTTPS (self-signed, auto-generated, stored in `~/.copycam/tls.json`); the desktop page runs on a separate HTTP listener **bound to 127.0.0.1**.
- `/desktop` (which displays the QR, i.e. the key) is additionally **loopback-only** — a LAN device requesting it gets 403.
- Host-header allow-list defeats DNS-rebinding attempts from malicious websites.
- Per-IP rate limiting, 20 MB body cap, no `x-powered-by`, `nosniff`, no clipboard contents ever logged (only character counts).

## What this protects against

- Passive eavesdroppers on your Wi-Fi (including other devices on a WPA2-PSK network that can decrypt each other's radio traffic).
- Anyone on the LAN poking the API: without the key they cannot write your clipboard, submit images for OCR, or read anything.
- Replayed or cross-purposed captured payloads.
- Random websites you visit trying to reach the companion via DNS rebinding.

## What this does NOT protect against

Be honest with yourself about these:

- **An active man-in-the-middle on your own LAN** (e.g. ARP spoofing). The phone connects over HTTPS with a **self-signed certificate** by default (required for iOS HTTPS-Only mode; one-time "not private" warning on first connect). That encrypts the page load against passive observers, but because the cert has no trust anchor, an active MITM could present its own self-signed cert and tamper with the served JavaScript — the phone can't tell the difference. Run CopyCam on Wi-Fi you trust — your home network with a strong WPA2/WPA3 password, not airport Wi-Fi. **Installing a trusted certificate (see README "Using a real certificate") closes this gap**: the phone then verifies the server's identity and an impostor can't substitute its own cert.
- **Anyone who can photograph your screen while the QR is showing** gets the key. The QR page is loopback-only, but the terminal QR is visible to whoever sees your monitor. If in doubt, rotate: `npm run serve -- --reset`.
- **Compromised endpoints.** If the phone or the PC is already compromised, the clipboard (and everything else) is too.
- **Clipboard visibility on the PC**: anything on a clipboard is readable by any local process. That's inherent to clipboards.

## Key rotation

- `npm run serve -- --reset` generates a new key; previously paired phones stop working until they rescan.
- On the phone, "Forget pairing" (shown on connection errors) clears the stored key.

## Reporting

This is a personal-use tool; if you find an issue, open a GitHub issue or just fix it — the whole crypto surface is ~60 lines in [shared/crypto.js](shared/crypto.js).
