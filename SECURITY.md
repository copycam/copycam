# CopyCam security model

CopyCam moves text you photograph — often literally passwords — from your phone to your computer's clipboard. It comes in two forms, the **browser version** at copycam.app/app and the **desktop companion** (`npx copycam`), and a phone reaches either by two routes: **direct on the Wi-Fi** when they share a network, and **through copycam.app's relay** from anywhere else. This document states exactly what protects that text in each case, and what doesn't.

All of it shares one core: the QR code carries the key, every message is sealed with AES-256-GCM, and the computer reads the text itself. The companion's own design comes first below; [The browser version](#the-browser-version) and [Two routes, one pairing](#two-routes-one-pairing) cover the rest.

## Design

**The QR code is the trust root.** When the companion starts, it generates a random 256-bit key, stored in `~/.copycam/key.json` (mode 0600) beside the secret that makes it the computer in its relay room. Its pairing QR encodes `https://copycam.app/p/#r=<room>&k=<key>`, the same link the browser version uses (see below). With `--local-only`, or when copycam.app can't be reached at start, it encodes the companion's own address instead, `https://<lan-ip>:8787/?h=8788#k=<key>` — the browser app opens it as-is; the native app reads the host, the cleartext port from `h`, and the key. Two properties matter:

- The key rides in the **URL fragment**, which browsers never send over the network. It exists only in the QR image and, after scanning, on the phone: in `localStorage` for the browser app (which immediately scrubs it from the address bar), or in the Keychain / Android Keystore for the native app.
- Scanning the QR requires being physically able to see your screen. That visual channel — not the network — is how the secret is exchanged.

**Every API message is sealed.** Both directions use AES-256-GCM envelopes ([shared/crypto.js](shared/crypto.js); the native app's TypeScript port is checked byte-for-byte against it by that app's own tests), checked by [shared/host.js](shared/host.js), the same code in both versions:

- Confidentiality + integrity: a Wi-Fi eavesdropper sees only ciphertext; any tampering fails the GCM tag.
- **Authentication = key possession.** There are no accounts; a request that doesn't decrypt is rejected with no detail.
- **Replay protection**: each envelope carries a timestamp and must be within 2 minutes of the server's clock, and each nonce is accepted once — the server remembers it for as long as its message could still pass that freshness check, and only messages that authenticate are recorded, so someone without the key can't flood the list. Each endpoint uses a distinct AAD, so a captured `/api/ocr` payload can't be replayed against `/api/clip`.

**Wi-Fi QR codes are decoded on your PC.** The companion looks for a Wi-Fi QR in the photo it already receives, and returns the network name and password inside the same sealed reply. Decoding is [zxing-wasm](https://github.com/Sec-ant/zxing-wasm), running locally: its WebAssembly binary is loaded from the installed package rather than the CDN the library would otherwise fetch it from, so a scan makes no network request (verified with `fetch` and `XMLHttpRequest` disabled). The credentials are never logged — the terminal and the desktop page say only that a code was found.

**What the companion connects to.** Reading runs on your PC and photos are never read anywhere else. While it runs, the companion keeps one connection open to copycam.app's relay, which carries only sealed messages (see [Two routes, one pairing](#two-routes-one-pairing)); with `--local-only` it never contacts copycam.app. Its WebRTC library ([werift](https://github.com/shinyoshiaki/werift-webrtc)) would ask Google's STUN server for the computer's public address; the companion points it at a closed port on the computer instead, so it contacts nobody. The default reading model ships inside the npm package ([NOTICE.md](NOTICE.md)). Two cases download a file once and cache it on your computer: the model for a non-default script (from `raw.githubusercontent.com` and `media.githubusercontent.com`) and, only if PaddleOCR cannot load, the tesseract.js fallback's English language data (from `cdn.jsdelivr.net`). Those are plain file requests that carry no photo and no text. A git checkout has no bundled model until you run `npm run models`, so its first scan downloads the default one too. Installing on 64-bit Linux also lets ONNX Runtime download an optional graphics-card add-on (about 270 MB) from Microsoft's NuGet service (`api.nuget.org`), which CopyCam does not use; set `ONNXRUNTIME_NODE_INSTALL=skip` before installing to prevent it.

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

## The browser version

copycam.app/app is the computer's side of CopyCam in a browser tab; copycam.app/p is the phone's. They speak the same sealed protocol as the companion, over the relay or a direct WebRTC channel, because a phone can't open an ordinary connection to a browser tab.

**Pairing.** The tab makes two random values the first time it runs, and keeps them in the browser's `localStorage` for copycam.app: a 256-bit **secret**, which makes it the computer in its relay room, and the 256-bit session **key**. Its QR code encodes `https://copycam.app/p/#r=<room>&k=<key>`, where `room` is the first 132 bits of SHA-256 of the secret. Both values are in the URL fragment, which browsers never send over the network; the phone page stores them and scrubs them from the address bar at once.

**The relay** ([worker/](worker/)) is a Cloudflare Worker with one Durable Object per room. The tab connects to `/relay/pc/<secret>` and phones to `/relay/phone/<room>`; the Worker derives the room from the secret, so knowing the room (from the QR) lets a phone knock but never lets anyone take the computer's place. The relay forwards text frames between the computer and up to four phones, chunking large messages (shared/relay.js), and:

- stores nothing and logs nothing: no Durable Object storage is used, and Workers logs are off;
- accepts connections only from copycam.app's own pages and from clients that aren't browsers (`Origin` check: every browser sends one, so another website's page can't connect; the companion and the mobile app send none), only well-formed addresses, frames of at most 257 KB, and at most 600 frames and 48 MB per connection per minute;
- lets a newly opened tab replace an older one in the same room (the old tab is told, and offers to take back over).

Every frame carries a sealed box, so the relay sees which room is active, when, the size of each message, and the connecting IP addresses. It can delay, drop or reorder messages, but it can't read, forge or replay them: the computer tab checks every box exactly as the companion does.

**Pairing from the Home Screen.** The phone page can be added to the Home Screen. An iPhone gives a Home Screen app storage of its own, so that app pairs by reading the computer's QR code itself, in the page ([jsQR](https://github.com/cozmo/jsQR)); it accepts only a link to copycam.app/p/ on its own origin.

**Reading happens in the tab.** The photo is decrypted in the computer's tab and read there by the same PaddleOCR model and reading code as the companion ([shared/reading.js](shared/reading.js)), compiled to WebAssembly and run in a worker ([src/web/reader.worker.js](src/web/reader.worker.js)), along with the Wi-Fi QR decoder. Every file it needs is served by copycam.app itself, content-addressed and cached by the browser; nothing comes from a CDN. A "new code" in the tab (`Unlink phones`) replaces the key but keeps the room, so phones holding the old key reach the tab, are refused, and are told to rescan.

**The clipboard.** A browser only lets the page in front write the clipboard. When the tab is in front, text goes straight onto it; otherwise the tab holds the text, the phone is told it is waiting, and it is copied when the tab comes back to the front or the Copy button is clicked. An optional notification says text has arrived; it never contains the text.

**Page hardening.** The app pages get their own headers from the Worker: a Content Security Policy that allows only copycam.app's own scripts (plus WebAssembly in the computer tab), connections only to copycam.app, no frames, no third-party scripts (the information pages' analytics beacon is not loaded there), `no-referrer`, and a Permissions Policy that grants the camera to the phone page only.

## Two routes, one pairing

The phone always starts on the relay, which works from any network, and tries the direct route in the background ([src/mobile/relay.js](src/mobile/relay.js), [shared/direct.js](shared/direct.js)). It shows which one it's on: "Linked · direct on Wi-Fi" or "Linked · through copycam.app".

- **The introduction is sealed.** A WebRTC connection needs the two devices to exchange an offer and an answer, which list where to find each one on the local network. They travel through the relay as an ordinary sealed request (`rtc`, handled by [shared/host.js](shared/host.js)) with its own AAD, freshness check and single-use nonce, so the relay sees a box it can't open, and someone without the key can't make the computer open a channel at all.
- **Only the local network.** Both sides offer only local-network ("host") candidates and use no STUN or TURN server, so a direct channel can only form on the same network; it never runs across the internet. On a guest network, an isolated network or mobile data it simply doesn't form, and the phone stays on the relay.
- **The same boxes, the same handler.** The channel is encrypted by WebRTC itself (DTLS), and inside it every message is the same sealed box as on the relay, answered by the same handler. Its nonce ledger is shared by every route, so a message captured on one route can't be replayed on the other.
- **Which way a message goes.** Once the channel is open, messages go over it. For a photo, the phone compares how fast each route has recently uploaded (the computer acknowledges each complete request) and uses the faster: the WebRTC lab found the direct channel can be the slower one on some phones and networks. If the channel drops, a message in flight is sent again, sealed afresh, through the relay.
- **What the relay sees.** On the relay route, every message's size and timing. On the direct route, only the sealed introduction and anything sent through the relay instead.

The companion joins the relay the same way the tab does, so its phones get the same two routes; `npx copycam --local-only` ("Only connect on my own Wi-Fi") keeps it off copycam.app altogether, and phones then reach it only over the Wi-Fi.

### What the browser version trusts that the companion doesn't

- **copycam.app serving honest code.** The companion runs code you installed; the browser version runs whatever copycam.app serves on each visit. Whoever controls the site (me, or anyone who compromised its Cloudflare account or the repository it deploys from) could serve a page that leaks the key or the text. That is the cost of nothing to install; if it matters for what you scan, use the companion, which needs no website at all. The served code is built from this repository by Cloudflare on every push, so what runs is what is published here.
- **The browser's storage.** The key lives in copycam.app's `localStorage` in both browsers. Anything that can read that site's storage (a malicious extension, someone with the unlocked computer) can link to your tab, or read the list of text it received while it is open.
- **Availability.** If copycam.app or Cloudflare is down, so is the browser version.

What the browser version does *not* need: a Wi-Fi you trust. The pages load over real HTTPS, and everything between phone and tab is sealed, so the phone can be on any network.

## What this protects against

- Passive eavesdroppers on your Wi-Fi (including other devices on a WPA2-PSK network that can decrypt each other's radio traffic).
- Anyone on the LAN poking the API: without the key they cannot write your clipboard, submit images for OCR, or read anything.
- Replayed or cross-purposed captured payloads.
- Random websites you visit trying to reach the companion via DNS rebinding.
- Third-party snooping on your text: OCR runs entirely on your own computer (PaddleOCR models on ONNX Runtime: in-process in the companion, in the tab in the browser version). Photographed text — passwords included — is never sent to any cloud OCR service.
- The relay and anyone between you and it: they carry only sealed boxes, and on the direct route only the sealed introduction.
- Other devices on the Wi-Fi watching the direct route: it is encrypted by WebRTC, and every message inside is sealed anyway.

## What this does NOT protect against

Be honest with yourself about these:

- **An active man-in-the-middle on your own LAN** (e.g. ARP spoofing), against the **companion's browser page**. It loads over HTTPS with a **self-signed certificate** by default (required for iOS HTTPS-Only mode; one-time "not private" warning on first connect). That encrypts the page load against passive observers, but because the cert has no trust anchor, an active MITM could present its own self-signed cert and tamper with the served JavaScript — the phone can't tell the difference. Run CopyCam on Wi-Fi you trust — your home network with a strong WPA2/WPA3 password, not airport Wi-Fi. **Installing a trusted certificate (see README "Using a real certificate") closes this gap**: the phone then verifies the server's identity and an impostor can't substitute its own cert. The native app has no served page to tamper with; an active attacker can drop or delay its sealed messages, but not read or forge them.
- **Anyone who can photograph your screen while the QR is showing** gets the key. The QR page is loopback-only, but the terminal QR is visible to whoever sees your monitor. If in doubt, rotate: `npm run serve -- --reset`.
- **Compromised endpoints.** If the phone or the PC is already compromised, the clipboard (and everything else) is too.
- **Clipboard visibility on the PC**: anything on a clipboard is readable by any local process. That's inherent to clipboards.

## Key rotation

- `npm run serve -- --reset` generates a new key; previously paired phones stop working until they rescan. Both phone apps recognise the refusal and say the pairing has changed, rather than blaming the network.
- In the browser version, **Unlink phones (new code)** on the computer page does the same.
- On the phone, **Scan the pairing code again** (offered whenever the computer can't be reached) clears the stored key and returns to the pairing screen.

## Dependencies

Checked 2026-09-16.

**Companion, browser app and landing page** (repo root): `npm audit` is clean. Eight advisories had been published since the previous check — against `qs` (inside the running server, via Express), `adm-zip` (install-time only, see below), and test/build tooling (`undici`, `postcss`, `nanoid`, `vitest`) — all fixed by non-breaking updates.

`onnxruntime-node` (the OCR runtime) pulls in `adm-zip`, which has had decompression-bomb and symlink-following advisories. It has never been reachable here: `adm-zip` only unpacks onnxruntime's own trusted binaries at install time, and the app never feeds user-supplied archives to it (phone photos go straight to the OCR image pipeline). A `package.json` `overrides` entry (`adm-zip: ^0.6.0`) still keeps it on a patched line. Real OCR was re-verified after the most recent update.

`zxing-wasm` (the QR decoder) ships a WebAssembly binary and pulls in two type-only packages. It runs in-process on photos you took, and reaches no network.

## Reporting

This is a personal-use tool; if you find an issue, open a GitHub issue or just fix it — the whole crypto surface is ~60 lines in [shared/crypto.js](shared/crypto.js).
