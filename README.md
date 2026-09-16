# CopyCam

Point your phone at any text. It lands on your computer's clipboard, over Wi-Fi. Nothing else.

This repo contains the whole product:

- **Desktop companion** ([server/](server)) — a small Node server you run on your PC. Runs OCR ([PaddleOCR models on ONNX Runtime](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr), no Python), writes received text to the clipboard, shows the pairing QR, and serves the browser app.
- **Phone app, browser** ([mobile.html](mobile.html) + [src/mobile/](src/mobile)) — zero install. Scan the pairing QR with the phone's camera and it opens in the browser.
- **Phone app, native** ([mobile/](mobile)) — React Native + TypeScript (Expo), runs free in Expo Go. Scans the pairing QR in-app, keeps the key in the Keychain / Keystore, and can drive the iPhone's flash. See [mobile/README.md](mobile/README.md).
- **Landing page + interactive demo** ([index.html](index.html) + [src/App.jsx](src/App.jsx)) — the marketing page, ported from the original Claude Design prototype.

Both phone apps speak the same encrypted protocol to the same companion and offer the same features, so either works.

## Use it

```
npm install
npm start        # builds the web assets, then starts the companion
```

`npm start` prints a pairing QR (also shown at http://localhost:8788/desktop). Then pick a phone app — the phone must be on the same Wi-Fi:

- **Browser, nothing to install.** Scan the QR with the phone's camera and open the link. The first connect shows a one-time "not private" warning — that's CopyCam's own self-signed certificate (it's what makes iOS HTTPS-Only mode work): tap Show Details / Advanced → Visit Website.
- **Native app, in Expo Go.** Run `npm run app`, sign in to the same Expo account on the PC and in Expo Go, scan the Expo QR to load the app, then scan the pairing QR from inside it. Details in [mobile/README.md](mobile/README.md).

### Scanning

1. Frame the text inside the brackets and tap the shutter. Only what's inside the frame is read, and it doesn't matter which way up the phone is — the companion works that out by reading the text.
2. The photo comes back with the text selectable. **Drag across the words** to pick exactly what you want (a tap selects one word); **All** / **Clear** cover the quick cases.
3. **Check anything marked.** OCR is never perfect, so inside passwords, keys and addresses the preview underlines characters that have a look-alike twin (0 and O, 1 and l, 5 and S) and shows the spaces beside them as faint dots, since one wrongly added space breaks a password. Where the recogniser itself was unsure, the highlight on the photo turns amber and the sheet says so. None of this alters the text — it only shows you where to look.
4. **Edit** turns the preview into a text field, for fixing a misread character or adding a word. Once edited, your text is what gets sent; **Discard edits** goes back to the selection.
5. **Send** — it's on your PC's clipboard.

**A Wi-Fi code beats reading the label.** If the photo contains the Wi-Fi QR code most routers print, the review offers the network name and password from the code itself — exact, with no OCR in the path. A photo of nothing but the QR works fine.

Wrapped paragraphs are flowed back into continuous text (a paragraph photographed across several lines pastes as one block, with blank lines between separate paragraphs). Swipe up the bottom sheet for a full preview of exactly what will be sent.

If something fails, the way out matches what went wrong: a lost connection offers **Try again** or rescanning the pairing code; a photo with nothing readable in it offers **Scan again**; a failed send stays on the review — photo, selection and edits intact — so it's one more tap.

### Languages

Scans use an accurate reader by default and take roughly two seconds. **Latin + CJK — faster** in the script picker swaps in a model about twice as quick that misreads more: measured over 384 rendered lines, 86% of lines exactly right against 57%.

There is no real script *detection*: the default **Latin + CJK** option is a fixed model, not a classifier, so it reads Arabic, Cyrillic and the rest as garbage rather than switching to them. For anything outside English/Spanish/French/German… plus Chinese/Japanese/Korean, tap the script pill on the camera screen and pick the script in your photo — Cyrillic, Greek, Arabic, Devanagari, Korean, Japanese, Thai, Tamil or Telugu. Every model *also* reads Latin letters, so mixed text works: with **Cyrillic** selected, `Network: OFFICE-GUEST / Пароль: Ключ-Река-88` comes through intact. The choice is remembered on the phone, so a whole book only needs picking once. **Hebrew is not supported** by any available model.

**Right-to-left text** (Arabic) is handled. PaddleOCR reads a line's glyphs in left-to-right scan order regardless of script, so raw Arabic output comes out char-reversed and word-reversed; the companion corrects this per whitespace-delimited token (so embedded numbers and Latin words aren't scrambled) before the phone ever sees it, and both phone apps align the preview from the text's own direction. This is a practical token-level approximation, not the full Unicode Bidi Algorithm — a multi-word English phrase inside an Arabic line may have its words reordered.

### Flash

The native app switches the phone's flash on, on iPhone and Android. In the browser, a Flash pill appears only where the browser allows it (Android Chrome); iOS Safari never lets a web page control the torch, so there the browser app offers a shortcut to the system camera, which has its own flash.

### Pairing

Pair once: the key is remembered on both sides — `~/.copycam/key.json` on the PC; `localStorage` in the browser app; the Keychain / Keystore in the native app. Rotate it any time with `npm run serve -- --reset`; paired phones then need to rescan.

### Notes

- Windows asks to allow Node on private networks the first time — allow it.
- The first scan downloads the OCR model (~6 MB, cached in `~/.cache/ppu-paddle-ocr`), so it needs internet once.
- Ports: `PORT` (default 8787) is HTTPS for the browser app; `PORT+1` (8788) is plain HTTP for the native app and the desktop page. The desktop page itself only answers to this PC (loopback); the sealed API answers the LAN on both.
- The PC's address goes into the pairing QR. Virtual adapters (WSL, Hyper-V, VirtualBox, VMware, Docker, Tailscale, ZeroTier) and self-assigned `169.254.*` addresses are passed over in favour of your real Wi-Fi/Ethernet address; if it still picks the wrong one, set `CC_IP=192.168.x.y`.
- If the PC's address changes (DHCP), phones can't reach it until they rescan the QR. A DHCP reservation in your router stops that happening.

## OCR models

OCR is [PaddleOCR](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr) (PP-OCR models on ONNX Runtime, in-process — no Python). The default unified model reads **Latin scripts** (English, French, Spanish, German, Portuguese, Italian, Vietnamese, …) and **CJK** (Chinese, Japanese, Korean). The phone's script pill picks a model per scan; `CC_OCR_MODEL` sets the default used when a phone doesn't send one:

```
CC_OCR_MODEL=cyrillic npm run serve
```

Values: `auto` (default — the unified V6 small model), `fast` (V6 tiny: about twice as quick, misreads more), `medium` (larger still, slower), or a script — `latin`, `cyrillic`, `greek`, `arabic`, `devanagari`, `korean`, `japanese`, `thai`, `tamil`, `telugu`. Models download on first use. If PaddleOCR can't load, it falls back to tesseract.js automatically.

## Using a real (trusted) certificate

Out of the box CopyCam self-signs, which triggers a one-time warning in the phone's browser. To remove the warning entirely, give it a certificate the phone already trusts — either works:

- **mkcert** (easiest for personal use): `mkcert -install`, install the mkcert root CA on your phone too ([mkcert docs](https://github.com/FiloSottile/mkcert)), then `mkcert <your-lan-ip>` and drop the generated files at `~/.copycam/custom.crt` and `~/.copycam/custom.key`.
- **Let's Encrypt / any CA**: get a cert for a domain you own (DNS-01 works without exposing anything to the internet), point that domain at your PC's LAN IP (local DNS or a public A record to a private IP), then run with:
  ```
  TLS_CERT_FILE=path\to\fullchain.pem TLS_KEY_FILE=path\to\privkey.pem CC_DOMAIN=copycam.example.com npm run serve
  ```

`CC_DOMAIN` puts the domain in the QR URL and the request allow-list (on both ports, so the native app keeps working) so it matches the certificate. The startup log shows which certificate source is active. The native app doesn't use the certificate at all — see [mobile/README.md](mobile/README.md) for why.

## What it can't read

No OCR is perfect, and these are the limits as measured here rather than assumed. Over 384 rendered lines (4 fonts, 2 sizes, clean and photo-degraded) the default reader gets 86% of lines exactly right. What remains, in order: wrong spacing inside a line; look-alike characters in passwords (`0`/`O`, `1`/`l`, `5`/`S`); and misreads on small, soft serif text.

The companion closes up the spaces a recogniser adds beside an underscore or inside an email address, because written text never has them there — that alone fixed `HOMEBASE _5G`. The rest is what the review's marks, the amber "hard to read" highlight and **Edit** are for. For Wi-Fi specifically, photograph the label's QR code and skip reading altogether.

## How it's secured

Every payload between phone and PC is end-to-end encrypted (AES-256-GCM) with a key that only ever travels inside the QR code — see [SECURITY.md](SECURITY.md) for the exact threat model and its limits.

## Develop

```
npm run dev         # landing page + demo (Vite)
npm run serve       # start the companion without rebuilding
npm run app         # native app dev server (Expo)
npm test            # unit, API and cross-client compatibility tests
npm run lint
npm run app:check   # typecheck the native app
```
