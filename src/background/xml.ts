import { DOMParser } from '@xmldom/xmldom';

// 0.8.15 documents this option in lib/dom-parser.js but omits it from Options.
const parserOptions: ConstructorParameters<typeof DOMParser>[0] & {
  normalizeLineEndings: (source: string) => string;
} = {
  // Preserve CR/CRLF/NEL/LS in vault values written by xmldom 0.7.13.
  normalizeLineEndings: source => source,
  errorHandler: {
    warning: (error: unknown) => { throw error; },
    error: (error: unknown) => { throw error; },
    fatalError: (error: unknown) => { throw error; },
  },
};

class KdbxDOMParser extends DOMParser {
  constructor() {
    super(parserOptions);
  }
}

/** Keep native DOM environments unchanged; workers use the configured parser for their lifetime. */
export function registerXmlParser(): void {
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = KdbxDOMParser;
  }
}
