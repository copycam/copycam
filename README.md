# CopyCam

Point your phone at any text. It lands on your computer's clipboard, over Wi-Fi. Nothing else.

This repo contains the whole product:

- **Desktop companion** ([server/](server)) — a small Node server you run on your PC. Serves the phone app over your LAN, runs OCR (tesseract.js), and writes received text to the clipboard.
- **Phone app** ([mobile.html](mobile.html) + [src/mobile/](src/mobile)) — a web app, no install. Opened by scanning the pairing QR with your phone's camera.
- **Landing page + interactive demo** ([index.html](index.html) + [src/App.jsx](src/App.jsx)) — the marketing page, ported from the original Claude Design prototype.

## Use it

```
npm install
npm start        # builds, then starts the companion server
```

1. `npm start` on the PC prints a QR code (also at http://localhost:8788/desktop).
2. Scan it with your phone's camera (phone must be on the same Wi-Fi). CopyCam opens in the phone browser — no app store, no account. The first connect shows a one-time "not private" warning (CopyCam's own self-signed certificate — works with iOS HTTPS-Only mode): tap Show Details / Advanced → Visit Website.
3. Tap the shutter, photograph some text, review the detected blocks, send. It's on your PC's clipboard.

Pair once: the key is remembered on both sides (`~/.copycam/key.json` on the PC, localStorage on the phone). Rotate it any time with `npm run serve -- --reset`.

Notes:
- Windows will ask to allow Node on private networks the first time — allow it.
- The first scan downloads OCR data (~4 MB, cached in `~/.copycam`), so it needs internet once.
- `PORT=xxxx` overrides the default 8787 (phones, HTTPS); the desktop page runs on PORT+1 (localhost, HTTP).

## Using a real (trusted) certificate

Out of the box CopyCam self-signs, which triggers a one-time browser warning on the phone. To remove the warning entirely, give it a certificate the phone already trusts — either works:

- **mkcert** (easiest for personal use): `mkcert -install`, install the mkcert root CA on your phone too ([mkcert docs](https://github.com/FiloSottile/mkcert)), then `mkcert <your-lan-ip>` and drop the generated files at `~/.copycam/custom.crt` and `~/.copycam/custom.key`.
- **Let's Encrypt / any CA**: get a cert for a domain you own (DNS-01 works without exposing anything to the internet), point that domain at your PC's LAN IP (local DNS or a public A record to a private IP), then run with:
  ```
  TLS_CERT_FILE=path\to\fullchain.pem TLS_KEY_FILE=path\to\privkey.pem CC_DOMAIN=copycam.example.com npm run serve
  ```

`CC_DOMAIN` puts the domain in the QR URL (and the request allow-list) so it matches the certificate. The startup log shows which certificate source is active.

## How it's secured

Every payload between phone and PC is end-to-end encrypted (AES-256-GCM) with a key that only ever travels inside the QR code — see [SECURITY.md](SECURITY.md) for the exact threat model and its limits.

## Develop

```
npm run dev         # landing page + demo (Vite)
npm test            # unit + API tests (35)
npm run lint
npm run serve       # start companion without rebuilding
```
