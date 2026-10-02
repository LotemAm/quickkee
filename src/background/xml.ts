import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom';

const parserOptions: ConstructorParameters<typeof DOMParser>[0] = {
  // Preserve CR/CRLF/NEL/LS in vault values written by xmldom 0.7.13.
  normalizeLineEndings: source => source,
  onError: onWarningStopParsing,
};

class KdbxDOMParser extends DOMParser {
  constructor() {
    super(parserOptions);
  }
}

/** Keep native DOM environments unchanged; workers use the configured parser for their lifetime. */
export function registerXmlParser(): void {
  if (typeof globalThis.DOMParser === 'undefined') {
    // kdbxweb uses the XML subset; xmldom does not implement the browser's full DOM.
    globalThis.DOMParser = KdbxDOMParser as unknown as typeof globalThis.DOMParser;
  }
}
