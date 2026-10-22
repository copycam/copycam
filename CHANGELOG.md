# Changelog

What changed in each release of the `copycam` package. The newest is first.

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
