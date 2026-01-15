# Croatian Invoice Barcode Scanner

Live version: https://bara82.github.io/hr-barcode-scanner-web/.

Scans or import from image and interprets Croatian invoice barcodes (PDF417 barcodes with HUB-3 data format). Works best with a good smartphone camera.

Barcodes are decoded using [@zxing/library](https://github.com/zxing-js/library). Accuracy is not guaranteed and results may vary depending on input quality. It generates QR code in EPC / SEPA format for ex Revolut app.

## Example

Example scan of a barcode from the [HUB-3 specification](https://hub.hr/sites/default/files/inline-files/2DBK_EUR_Uputa_0.pdf):

<img src="example.jpeg" alt="Example barcode scan" width="300">
