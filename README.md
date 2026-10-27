# Croatian Invoice Barcode Scanner

Live version: https://bara82.github.io/hr-barcode-scanner-web/.

Scans or import from image and interprets Croatian invoice barcodes (PDF417 barcodes with HUB-3 data format). Works best with a good smartphone camera.

Barcodes are decoded using [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (ZXing-C++ compiled to WebAssembly). Accuracy is not guaranteed and results may vary depending on input quality. It generates a QR code in EPC / SEPA format (for example for the Revolut app) using [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT). Both libraries are vendored in `assets/`, so the app works without any CDN.

After a scan the app also checks the data and shows a warning if something looks wrong (it never blocks the result):

- IBAN checksum (ISO 13616)
- payment model and reference control digits for models HR01–HR11 (MOD11INI) and ISO 11649 `RF` references
- header (`HRVHUB30`), currency (`EUR`), amount

Other payment models are not verified. Always double check the data before paying.

## Dark / light mode and saving the QR

- The moon / sun button in the bottom bar switches between dark and light mode. Without a choice the app follows the system setting; the choice is remembered on the device. QR codes are never themed: they are always black on white with the standard 4-module white border, so they scan in both modes.
- The QR code is a real PNG image: long-press it on a phone (or right-click on a computer) and choose "Save image", or use the **Save QR as PNG** button. On phones the button opens the share sheet (Save Image / Save to Files), elsewhere it downloads the file.
- In History, **Export PNG** (per entry) and **PNG selected** save only the QR code as PNG, nothing else.

The PNG is written by `assets/qrimage.js` (no canvas needed), covered by `tests/qrimage.test.js`.

## Example

Example scan of a barcode from the [HUB-3 specification](https://hub.hr/sites/default/files/inline-files/2DBK_EUR_Uputa_0.pdf):

<img src="example.jpg" alt="Example barcode scan" width="300">

## Development

The app is a static page: open `index.html` through any web server (the camera needs HTTPS or `localhost`; `python3 -m http.server` is enough).

The logic that does not touch the page (validation, EPC payload, amount, encoding) lives in `assets/hub3.js` and is covered by tests:

```
npm install
npm test
```

`tests/hub3.test.js` is dependency-free; `tests/qrimage.test.js` checks that the saved PNG is valid and scans back to the exact payload. `tests/roundtrip.test.js` renders a real HUB-3 PDF417, decodes it, builds the EPC payload, renders the QR and decodes that again, with Croatian diacritics.
