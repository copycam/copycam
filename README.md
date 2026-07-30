# CopyCam

Point your phone at any text. It lands on your computer's clipboard, over Wi-Fi. Nothing else.

This repo contains the whole product:

- **Desktop companion** ([server/](server)) — a small Node server you run on your PC. Serves the phone app over your LAN, runs OCR ([PaddleOCR models on ONNX Runtime](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr), no Python), and writes received text to the clipboard.
- **Phone app** ([mobile.html](mobile.html) + [src/mobile/](src/mobile)) — a web app, no install. Opened by scanning the pairing QR with your phone's camera.
- **Landing page + interactive demo** ([index.html](index.html) + [src/App.jsx](src/App.jsx)) — the marketing page, ported from the original Claude Design prototype.

## Use it

```
npm install
npm start        # builds, then starts the companion server
```

1. `npm start` on the PC prints a QR code (also at http://localhost:8788/desktop).
2. Scan it with your phone's camera (phone must be on the same Wi-Fi). CopyCam opens in the phone browser — no app store, no account. The first connect shows a one-time "not private" warning (CopyCam's own self-signed certificate — works with iOS HTTPS-Only mode): tap Show Details / Advanced → Visit Website.
3. Tap the shutter (the live viewfinder captures a frame), then review: the photo comes up with your text ready to select. **Drag across the words** — like selecting text natively — to pick exactly what you want (a tap selects one word); the selection highlights as you go. **All** / **Clear** are there for the quick cases. Send — it's on your PC's clipboard.

**Languages.** There's no real script *detection* — the default "Latin + CJK" pill is a fixed model, not a classifier, so it reads Arabic/Cyrillic/Hebrew/etc as garbage rather than switching to them automatically. For anything outside English/Spanish/French/German… + Chinese/Japanese/Korean, tap the language pill on the camera screen and pick the script in your photo — Cyrillic, Greek, Arabic, Devanagari, Korean, Japanese, Thai, Tamil or Telugu. Every model *also* reads Latin letters, so mixed text works: with **Cyrillic** selected, `Network: OFFICE-GUEST / Пароль: Ключ-Река-88` comes through intact. Your choice is remembered on the phone, so a whole book only needs picking once. Hebrew is not supported by the OCR models.

**Right-to-left text** (Arabic) is handled: PaddleOCR's recognizer reads a line's glyphs in left-to-right scan order regardless of script, so raw Arabic output comes out char-reversed and word-reversed — CopyCam corrects this (per whitespace-delimited token, so embedded numbers/Latin words aren't scrambled) before it ever reaches the review screen, so drag-selection, pasting, and clipboard order are all correct. This is a practical approximation (token-level), not a full Unicode Bidi Algorithm implementation — a multi-word *English phrase* embedded inside an Arabic line may have its words reordered.

**Flash.** Where the browser allows it (Android Chrome), a Flash pill appears on the camera screen. iOS Safari does not let web pages control the torch, so on iPhone the app instead offers a shortcut to the system camera app, which has its own flash — useful for dim or glossy pages.

Wrapped paragraphs are flowed back into continuous text automatically (a paragraph photographed across several lines pastes as one block, with blank lines between separate paragraphs). Swipe up the bottom sheet for a full preview of exactly what will be sent.

Pair once: the key is remembered on both sides (`~/.copycam/key.json` on the PC, localStorage on the phone). Rotate it any time with `npm run serve -- --reset`.

Notes:
- Windows will ask to allow Node on private networks the first time — allow it.
- The first scan downloads the OCR model (~6 MB, cached in `~/.cache/ppu-paddle-ocr`), so it needs internet once.
- `PORT=xxxx` overrides the default 8787 (phones, HTTPS); the desktop page runs on PORT+1 (localhost, HTTP).

## Languages

OCR is [PaddleOCR](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr) (PP-OCR models on ONNX Runtime, in-process — no Python). The default unified model reads **Latin scripts** (English, French, Spanish, German, Portuguese, Italian, Vietnamese, …) and **CJK** (Chinese, Japanese, Korean) out of the box.

For other scripts, set `CC_OCR_MODEL` to a script-specific model (downloaded on demand):

```
CC_OCR_MODEL=cyrillic npm run serve
```

Values: `tiny` (default), `small`, `medium` (larger unified tiers), or a script — `cyrillic`, `arabic`, `devanagari`, `greek`, `korean`, `latin`, `thai`, `tamil`, `telugu`, `japanese`. If the model can't load, it falls back to tesseract.js automatically.

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
npm test            # unit + API tests
npm run lint
npm run serve       # start companion without rebuilding
```
