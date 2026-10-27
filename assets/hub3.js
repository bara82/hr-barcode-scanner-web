/* =========================================================
   hub3.js - pure logic (no DOM): HUB-3 parsing helpers, validation, EPC/SEPA payload.
   Loaded by index.html as a classic script (functions become globals) and by Node tests (module.exports).

   Sources:
   - HUB-3A 2D barcode spec (2DBK EUR uputa), hub.hr: 14 LF-terminated fields, UTF-8, amount = 15 digits of cents.
   - "Jedinstveni pregled osnovnih modela poziva na broj" (HUB/FINA): models HR01-HR11, MOD11INI.
   - ISO 13616 (IBAN, mod 97-10), ISO 11649 (RF creditor reference, mod 97-10).
========================================================= */
(function (root) {
  'use strict';

  /* ---------- amount ---------- */
  // HUB-3: amount in cents, up to 15 digits (zero-padded). Returns null if it isn't a plain number,
  // so callers fall back to the raw line.
  function formatAmount(amountString) {
    const digits = String(amountString || '').trim();
    if (!/^\d{1,15}$/.test(digits)) return null;
    const euros = parseInt(digits, 10) / 100.0;
    return {
      display: euros.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      copy: euros.toFixed(2) // "5.06" (dot), as the EPC payload needs
    };
  }

  /* ---------- text encoding ---------- */
  // Some decoders return UTF-8 bytes read as Windows-1252 ("Ä" + "\u008d" instead of "c-caron").
  // Only text that is provably mojibake is repaired: every char maps back to one byte AND those bytes
  // form valid UTF-8. Otherwise the text is returned unchanged.
  const CP1252_REVERSE = (function () {
    const m = new Map();
    try {
      const d = new TextDecoder('windows-1252');
      for (let b = 0; b < 256; b++) m.set(d.decode(Uint8Array.of(b)), b);
    } catch (e) { /* TextDecoder missing: repair disabled */ }
    return m;
  })();

  function repairMojibake(text) {
    if (!CP1252_REVERSE.size) return text;
    const bytes = [];
    for (const ch of text) {
      if (!CP1252_REVERSE.has(ch)) return text;
      bytes.push(CP1252_REVERSE.get(ch));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    } catch (e) {
      return text;
    }
  }

  // HUB-3 is UTF-8. Prefer the decoder's raw bytes; fall back to its own text.
  function decodeBytes(bytes, fallbackText) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return fallbackText;
    }
  }

  function fixEncoding(text) {
    return repairMojibake(text).toUpperCase();
  }

  /* ---------- check digit algorithms ---------- */
  // mod 97-10 over a string of digits and letters (A=10 ... Z=35)
  function mod97(str) {
    let rem = 0;
    for (const ch of str) {
      const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (const d of v) rem = (rem * 10 + Number(d)) % 97;
    }
    return rem;
  }

  function ibanIsValid(iban) {
    const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    return mod97(s.slice(4) + s.slice(0, 4)) === 1;
  }

  function isCroatianIbanShape(iban) {
    return /^HR\d{19}$/.test(String(iban || '').replace(/\s+/g, '').toUpperCase());
  }

  // ISO 11649: "RF" + 2 check digits + up to 21 alphanumerics
  function isRfReference(ref) {
    return /^RF\d{2}[A-Z0-9]{1,21}$/.test(String(ref || '').replace(/\s+/g, '').toUpperCase());
  }

  function rfIsValid(ref) {
    const s = String(ref || '').replace(/\s+/g, '').toUpperCase();
    return isRfReference(s) && mod97(s.slice(4) + s.slice(0, 4)) === 1;
  }

  // MOD11INI (HUB "standard" check): weights 2,3,4,... from the right over all digits except the last,
  // remainder 0 or 1 -> control digit 0, otherwise 11 - remainder.
  function mod11iniControlDigit(body) {
    let sum = 0, w = 2;
    for (let i = body.length - 1; i >= 0; i--, w++) sum += Number(body[i]) * w;
    const r = sum % 11;
    return r <= 1 ? 0 : 11 - r;
  }

  // `num` = digits including the trailing control digit
  function mod11iniIsValid(num) {
    if (!/^\d{2,}$/.test(num)) return false;
    return mod11iniControlDigit(num.slice(0, -1)) === Number(num.slice(-1));
  }

  /* ---------- reference number (poziv na broj) models ---------- */
  // Which groups carry a MOD11INI control digit. [[1,2]] = P2 and P3 together share one control digit.
  // Models using other algorithms (HR12-HR14, HR17+, ISO 7064 ...) are deliberately NOT checked here.
  const MOD11INI_UNITS = {
    HR01: 'all',
    HR02: [[1], [2]],
    HR03: [[0], [1], [2]],
    HR04: [[0], [2]],
    HR05: [[0]],            // P2 is only conditionally controlled (ISO 7064), so only P1 is checked
    HR06: [[1, 2]],
    HR07: [[1]],
    HR08: [[0, 1], [2]],
    HR09: [[0, 1]],
    HR10: [[0], [1, 2]],
    HR11: [[0], [1]]
  };

  // -> { status: 'ok' | 'bad' | 'skipped', problems: string[] }
  function checkReference(modelRaw, referenceRaw) {
    const model = String(modelRaw || '').trim().toUpperCase();
    const ref = String(referenceRaw || '').trim().toUpperCase();
    const problems = [];
    let status = 'skipped';

    if (!model && !ref) return { status, problems };

    if (model && !/^HR\d{2}$/.test(model)) problems.push('Payment model "' + model + '" is not of the form HRxx.');
    if (ref.length > 22) problems.push('Reference is longer than 22 characters (' + ref.length + ').');

    const compact = ref.replace(/\s+/g, '');

    if (isRfReference(compact)) {
      if (rfIsValid(compact)) status = 'ok';
      else { status = 'bad'; problems.push('RF reference failed the ISO 11649 check.'); }
      return { status, problems };
    }

    if (model === 'HR99') {
      if (ref) problems.push('Model HR99 means "no reference", but a reference is present.');
      return { status, problems };
    }

    const units = MOD11INI_UNITS[model];
    if (units && ref) {
      if (!/^[0-9-]+$/.test(compact)) {
        problems.push('Reference for model ' + model + ' should contain only digits and hyphens.');
        return { status: 'bad', problems };
      }
      const groups = compact.split('-');
      let plan = units === 'all' ? [groups.map((_, i) => i)] : units;
      if (model === 'HR06' && groups.length === 2) plan = [[1]];   // with two groups, P2 carries the control digit

      let checked = 0, failed = 0;
      for (const unit of plan) {
        if (unit.some(i => i >= groups.length || groups[i] === '')) continue;   // group not present: nothing to check
        const num = unit.map(i => groups[i]).join('');
        checked++;
        if (!mod11iniIsValid(num)) {
          failed++;
          problems.push('Control digit of ' + unit.map(i => 'P' + (i + 1)).join('+') + ' does not match (model ' + model + ').');
        }
      }
      if (checked) status = failed ? 'bad' : 'ok';
    }
    return { status, problems };
  }

  /* ---------- whole-barcode validation ---------- */
  // lines = the 14 HUB-3 lines (LF split, CR removed). Returns warnings (strings) + what could be verified.
  function validateHub3(lines) {
    const L = lines || [];
    const warnings = [];
    const summary = { ibanOk: false, referenceStatus: 'skipped' };

    if (L[0] !== 'HRVHUB30') warnings.push('Header is not HRVHUB30. This may not be a HUB-3 payment barcode.');
    if (L[1] && L[1] !== 'EUR') warnings.push('Currency is "' + L[1] + '", but the generated QR is always in EUR.');

    const amount = formatAmount(L[2]);
    if (!amount) warnings.push('Amount is missing or not a number. The QR will have no amount.');

    if (!String(L[6] || '').trim()) warnings.push('Recipient name is empty.');

    const iban = String(L[9] || '').replace(/\s+/g, '');
    if (!iban) {
      warnings.push('Recipient IBAN is missing.');
    } else if (!ibanIsValid(iban)) {
      warnings.push('IBAN failed its checksum (ISO 13616). The barcode may have been misread, or the invoice is wrong.');
    } else {
      summary.ibanOk = true;
      if (!isCroatianIbanShape(iban)) warnings.push('IBAN is valid but is not a Croatian IBAN (HR + 19 digits).');
    }

    const ref = checkReference(L[10], L[11]);
    summary.referenceStatus = ref.status;
    warnings.push(...ref.problems);

    return { warnings, summary };
  }

  /* ---------- EPC / SEPA QR (EPC069-12, version 001, UTF-8) ---------- */
  function epcClean(value, maxLen) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  }

  // Lines: BCD, version, charset(1=UTF-8), SCT, BIC, name(<=70), IBAN, EURx.xx, purpose,
  //        structured reference (ONLY an ISO 11649 "RF..." creditor reference), unstructured text (<=140).
  // Croatian HUB-3 references ("HR00 123-456") are NOT RF references, so they go in the unstructured line.
  // Only one of the two remittance lines may be filled. Trailing empty lines are dropped.
  function buildEpcPayload(data) {
    const d = data || {};
    const ibanClean = String(d.iban || '').replace(/\s+/g, '').toUpperCase();
    const refRaw = String(d.reference || '').trim();
    const refCompact = refRaw.replace(/\s+/g, '').toUpperCase();
    const rf = isRfReference(refCompact);

    const lines = [
      'BCD',
      '001',
      '1',
      'SCT',
      '',                                       // BIC optional (not needed inside SEPA)
      epcClean(d.name, 70),
      ibanClean,
      d.amount ? 'EUR' + d.amount : '',
      '',                                       // purpose code optional
      rf ? refCompact : '',                     // structured remittance
      rf ? '' : epcClean(refRaw, 140)           // unstructured remittance (model + reference)
    ];
    while (lines.length > 6 && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  const api = {
    formatAmount, repairMojibake, decodeBytes, fixEncoding,
    mod97, ibanIsValid, isCroatianIbanShape, isRfReference, rfIsValid,
    mod11iniControlDigit, mod11iniIsValid, checkReference, validateHub3,
    epcClean, buildEpcPayload
  };

  if (typeof module === 'object' && module.exports) module.exports = api;   // Node (tests)
  else Object.assign(root, api);                                           // browser: plain globals
})(typeof window !== 'undefined' ? window : globalThis);
