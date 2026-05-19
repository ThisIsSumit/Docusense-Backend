/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from './logger';

// require the CommonJS module
const _pdfParseModule: any = require('pdf-parse');

export async function parsePdf(buffer: Buffer): Promise<any> {
  const shape = {
    type: typeof _pdfParseModule,
    keys: Object.keys(_pdfParseModule || {}),
  };

  // ensure we pass a plain Uint8Array (some pdf-parse builds reject Node Buffer)
  const u8: Uint8Array = buffer instanceof Uint8Array && !Buffer.isBuffer(buffer)
    ? buffer
    : new Uint8Array(buffer);

  const normalize = (res: any) => {
    if (typeof res === 'string') return { text: res };
    if (res && typeof res === 'object') return res;
    return { text: String(res) };
  };

  // 1) Observed shape: module exposes `PDFParse` class
  if (_pdfParseModule && typeof _pdfParseModule.PDFParse === 'function') {
    try {
      const PDFParseClass = _pdfParseModule.PDFParse;
      const inst = new PDFParseClass(u8);
      if (inst) {
        if (typeof inst.getText === 'function') return normalize(await inst.getText());
        if (typeof inst.parse === 'function') return normalize(await inst.parse());
        if (inst.text && typeof inst.text === 'string') return normalize(inst);
      }
    } catch (err) {
      logger.debug({ err: (err as Error)?.message ?? err }, 'PDFParse class invocation failed');
    }
  }

  // 2) Fallback: module itself is callable or has default export
  try {
    if (typeof _pdfParseModule === 'function') return normalize(await _pdfParseModule(u8));
    if (_pdfParseModule && typeof _pdfParseModule.default === 'function') return normalize(await _pdfParseModule.default(u8));
  } catch (err) {
    logger.debug({ err: (err as Error)?.message ?? err }, 'pdf-parse fallback invocation failed');
  }

  const err = new Error(`Unsupported pdf-parse module shape: ${JSON.stringify(shape)}`);
  // @ts-ignore
  err.moduleShape = shape;
  throw err;
}
