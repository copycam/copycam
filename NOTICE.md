# Third-party notices

## OCR models bundled in the npm package

The `copycam` package on npm includes the default text-reading model so that a
first scan needs no download:

| File | What it is |
|---|---|
| `PP-OCRv6_small_det.ort` | text detection |
| `PP-OCRv6_small_rec.ort` | text recognition |
| `ppocrv6_dict.txt` | character dictionary |

They are PaddleOCR PP-OCRv6 models in ONNX Runtime format, as published at
<https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models> under the
Apache License 2.0 ([licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)). They are
redistributed unmodified; each file is checked against a pinned SHA-256 before it
is packaged.

copycam.app serves the same three files, unmodified, to the browser version
(copycam.app/app), which reads text in the browser tab.

Other languages' models, and the tesseract.js fallback's language data, are not
bundled. They download on first use and are cached on the computer.

The full list of dependencies and their licences is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and at <https://copycam.app/licenses/>.
