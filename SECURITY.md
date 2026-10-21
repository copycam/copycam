# CopyCam security model

CopyCam moves text you photograph — often literally passwords — from your phone to your PC's clipboard over the local network. This document states exactly what protects that text, and what doesn't.

## Design

**The QR code is the trust root.** When the companion starts, it generates a random 256-bit key, stored in `~/.copycam/key.json` (mode 0600). The pairing QR encodes `https://<lan-ip>:8787/?h=8788#k=<key>` — the browser app opens it as-is; the native app reads the host, the cleartext port from `h`, and the key. Two properties matter:

- The key rides in the **URL fragment**, which browsers never send over the network. It exists only in the QR image and, after scanning, on the phone: in `localStorage` for the browser app (which immediately scrubs it from the address bar), or in the Keychain / Android Keystore for the native app.
- Scanning the QR requires being physically able to see your screen. That visual channel — not the network — is how the secret is exchanged.

**Every API message is sealed.** Both directions use AES-256-GCM envelopes ([shared/crypto.js](shared/crypto.js); the native app's TypeScript port is checked byte-for-byte against it by that app's own tests):

- Confidentiality + integrity: a Wi-Fi eavesdropper sees only ciphertext; any tampering fails the GCM tag.
- **Authentication = key possession.** There are no accounts; a request that doesn't decrypt is rejected with no detail.
- **Replay protection**: each envelope carries a timestamp and must be within 2 minutes of the server's clock, and each nonce is accepted once — the server remembers it for as long as its message could still pass that freshness check, and only messages that authenticate are recorded, so someone without the key can't flood the list. Each endpoint uses a distinct AAD, so a captured `/api/ocr` payload can't be replayed against `/api/clip`.

**Wi-Fi QR codes are decoded on your PC.** The companion looks for a Wi-Fi QR in the photo it already receives, and returns the network name and password inside the same sealed reply. Decoding is [zxing-wasm](https://github.com/Sec-ant/zxing-wasm), running locally: its WebAssembly binary is loaded from the installed package rather than the CDN the library would otherwise fetch it from, so a scan makes no network request (verified with `fetch` and `XMLHttpRequest` disabled). The credentials are never logged — the terminal and the desktop page say only that a code was found.

**What the companion connects to.** Reading runs on your PC and photos never go anywhere else. In normal use the companion makes no outbound connection: the default reading model ships inside the npm package ([NOTICE.md](NOTICE.md)). Two cases download a file once and cache it on your computer: the model for a non-default script (from `raw.githubusercontent.com` and `media.githubusercontent.com`) and, only if PaddleOCR cannot load, the tesseract.js fallback's English language data (from `cdn.jsdelivr.net`). Those are plain file requests that carry no photo and no text. A git checkout has no bundled model until you run `npm run models`, so its first scan downloads the default one too. Installing on 64-bit Linux also lets ONNX Runtime download an optional graphics-card add-on from Microsoft's NuGet service (`api.nuget.org`), which CopyCam does not use; set `ONNXRUNTIME_NODE_INSTALL=skip` before installing to prevent it.

**Server hardening** ([server/app.js](server/app.js), [server/index.js](server/index.js)):

- Two listeners: HTTPS on 8787 for the browser app (self-signed, auto-generated, stored in `~/.copycam/tls.json`), and plain HTTP on 8788 for the native app and the desktop page. Both are bound to all interfaces so a phone can reach them.
- `/desktop` and `/desktop/events` (which display the QR, i.e. the key) are **loopback-only** on either listener — a LAN device requesting them gets 403, and tests assert exactly that from a real LAN address.
- Host-header allow-list (the PC's own addresses, plus `CC_DOMAIN` if set) defeats DNS-rebinding attempts from malicious websites.
- Per-IP rate limiting, 20 MB body cap, no `x-powered-by`, `nosniff`, `no-referrer`, and no clipboard contents ever logged (only character counts).

## The native app talks cleartext, on purpose

The upcoming React Native app uses the companion's **plain-HTTP**
listener rather than the self-signed HTTPS one, because React Native cannot be
told to trust that certificate and Expo Go offers no way to bypass TLS
validation. The trade-off is different from the browser's, and better:

- Payloads are still sealed with AES-256-GCM — TLS was never what protected
  them.
- The browser app's real TLS benefit is protecting the **served page** from
  tampering. The native app has no served page: its JavaScript ships inside the
  app bundle, so that attack surface does not exist.
- The cleartext listener still refuses `/desktop` and `/desktop/events` to
  anything but this PC, and tests assert that an unsealed `/api` request from
  the LAN is rejected.

What an eavesdropper on your Wi-Fi can see that they could not before: the
*size* and *timing* of scans, and the fact that the app is talking to this PC.
Not the photo, not the text.

## What this protects against

- Passive eavesdroppers on your Wi-Fi (including other devices on a WPA2-PSK network that can decrypt each other's radio traffic).
- Anyone on the LAN poking the API: without the key they cannot write your clipboard, submit images for OCR, or read anything.
- Replayed or cross-purposed captured payloads.
- Random websites you visit trying to reach the companion via DNS rebinding.
- Third-party snooping on your text: OCR runs entirely on your own PC (PaddleOCR models on ONNX Runtime, in-process). Photographed text — passwords included — is never sent to any cloud OCR service.

## What this does NOT protect against

Be honest with yourself about these:

- **An active man-in-the-middle on your own LAN** (e.g. ARP spoofing), against the **browser app**. It loads over HTTPS with a **self-signed certificate** by default (required for iOS HTTPS-Only mode; one-time "not private" warning on first connect). That encrypts the page load against passive observers, but because the cert has no trust anchor, an active MITM could present its own self-signed cert and tamper with the served JavaScript — the phone can't tell the difference. Run CopyCam on Wi-Fi you trust — your home network with a strong WPA2/WPA3 password, not airport Wi-Fi. **Installing a trusted certificate (see README "Using a real certificate") closes this gap**: the phone then verifies the server's identity and an impostor can't substitute its own cert. The native app has no served page to tamper with; an active attacker can drop or delay its sealed messages, but not read or forge them.
- **Anyone who can photograph your screen while the QR is showing** gets the key. The QR page is loopback-only, but the terminal QR is visible to whoever sees your monitor. If in doubt, rotate: `npm run serve -- --reset`.
- **Compromised endpoints.** If the phone or the PC is already compromised, the clipboard (and everything else) is too.
- **Clipboard visibility on the PC**: anything on a clipboard is readable by any local process. That's inherent to clipboards.

## Key rotation

- `npm run serve -- --reset` generates a new key; previously paired phones stop working until they rescan. Both phone apps recognise the refusal and say the pairing has changed, rather than blaming the network.
- On the phone, **Scan the pairing code again** (offered whenever the computer can't be reached) clears the stored key and returns to the pairing screen.

## Dependencies

Checked 2026-09-16.

**Companion, browser app and landing page** (repo root): `npm audit` is clean. Eight advisories had been published since the previous check — against `qs` (inside the running server, via Express), `adm-zip` (install-time only, see below), and test/build tooling (`undici`, `postcss`, `nanoid`, `vitest`) — all fixed by non-breaking updates.

`onnxruntime-node` (the OCR runtime) pulls in `adm-zip`, which has had decompression-bomb and symlink-following advisories. It has never been reachable here: `adm-zip` only unpacks onnxruntime's own trusted binaries at install time, and the app never feeds user-supplied archives to it (phone photos go straight to the OCR image pipeline). A `package.json` `overrides` entry (`adm-zip: ^0.6.0`) still keeps it on a patched line. Real OCR was re-verified after the most recent update.

`zxing-wasm` (the QR decoder) ships a WebAssembly binary and pulls in two type-only packages. It runs in-process on photos you took, and reaches no network.

## Reporting

This is a personal-use tool; if you find an issue, open a GitHub issue or just fix it — the whole crypto surface is ~60 lines in [shared/crypto.js](shared/crypto.js).
