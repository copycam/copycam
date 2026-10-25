# Changelog

What changed in each release of the `copycam` package. The newest is first.

## 0.2.0

The phone now reaches the companion from any network, with no certificate warning, and directly when both are on the same Wi-Fi.

- **The pairing code is now a copycam.app link.** The companion joins copycam.app's relay, so the phone opens the page from copycam.app (a real certificate: no more "not private" warning) and reaches your computer from any network, mobile data included. Everything stays sealed end to end: the relay can't read the photos or the text.
- **Direct on your Wi-Fi.** When the phone and the computer share a network, they open a direct connection (WebRTC) by themselves and talk straight to each other; anywhere else, they go through copycam.app. The phone shows which: "Linked · direct on Wi-Fi" or "Linked · through copycam.app". The introduction that sets up the direct connection is sealed like every other message.
- **`--local-only`: only connect on your own Wi-Fi.** The companion then never contacts copycam.app and works exactly as 0.1.x did. It also falls back to its own Wi-Fi link by itself when copycam.app can't be reached at start.
- **Same pairing, same security.** One pairing key, one handler and one replay check for every route: a message used on one route can't be replayed on another. Your existing pairing key is kept; scan the new code once.
- New dependencies: `werift` (WebRTC, MIT) and `ws` (WebSockets on Node 20, MIT). The companion points werift's STUN lookup at nothing, so it contacts no outside server.

## 0.1.1

Nothing about how CopyCam runs has changed: the companion, the phone page and the text reading are the same as 0.1.0.

- **Added `THIRD_PARTY_NOTICES.md`.** It lists the licence of everything CopyCam includes or installs, and reproduces the full licence text of the code that is bundled into the phone page (React, `@noble/ciphers` and their dependencies), which those licences require. It also appears on the website at [copycam.app/licenses](https://copycam.app/licenses/).
- **The documentation says what a Linux install downloads.** On 64-bit Linux, one of CopyCam's components (ONNX Runtime) fetches an optional graphics-card add-on of about 270 MB that CopyCam never uses. `README.md`, `SECURITY.md` and the troubleshooting guide explain how to skip it: `ONNXRUNTIME_NODE_INSTALL=skip npx copycam`.
- **Checked on every change on Windows, macOS and Linux.** An automated test installs the packed package into an empty folder and checks that it reads text offline and serves the phone page. This changes nothing in the package.
- The website's pages ship in the package as before. They were updated (footer links, accessibility fixes) and are not used when CopyCam runs.

## 0.1.0

The first release.

- Point your phone at text and it lands on your computer's clipboard over Wi-Fi: a companion you start with `npx copycam`, and a phone page you open by scanning its QR code.
- Everything between the phone and the computer is encrypted (AES-256-GCM) with a key that only travels inside the QR code.
- Text is read on your own computer with PaddleOCR. The default model is bundled, so a first scan needs no download.
- Drag across the photo to choose the words to send; look-alike characters such as `0` and `O` are marked for checking.
- Licensed under the GPL-3.0.
