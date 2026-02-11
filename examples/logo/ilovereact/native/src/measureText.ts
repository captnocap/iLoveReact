/**
 * measureText -- JS-side wrapper for Love2D text measurement.
 *
 * Calls the __hostMeasureText host function exposed by bridge_quickjs.lua
 * to measure text dimensions using Love2D's font APIs. This is a synchronous
 * call since QuickJS host functions execute inline.
 *
 * Only available in native mode (QuickJS). In web mode, use the browser's
 * native text measurement (Canvas measureText or DOM layout).
 */

declare const globalThis: {
  __hostMeasureText?: (params: Record<string, any>) => TextMeasurement;
  [key: string]: any;
};

export interface TextMeasurement {
  width: number;
  height: number;
}

export interface MeasureTextOptions {
  text: string;
  fontSize?: number;
  maxWidth?: number;
}

/**
 * Measure the dimensions of a text string using Love2D's font APIs.
 *
 * @param options.text      The text content to measure.
 * @param options.fontSize  Font size in pixels (default 14).
 * @param options.maxWidth  Maximum width for wrapping. Omit for single-line measurement.
 * @returns {TextMeasurement} The measured { width, height } in pixels.
 * @throws If __hostMeasureText is not available (e.g. running in web mode).
 */
export function measureText(options: MeasureTextOptions): TextMeasurement {
  if (typeof globalThis.__hostMeasureText !== 'function') {
    throw new Error(
      'measureText is only available in native mode. ' +
      '__hostMeasureText host function not found.'
    );
  }

  const params: Record<string, any> = {
    text: options.text,
    fontSize: options.fontSize ?? 14,
  };

  if (options.maxWidth !== undefined) {
    params.maxWidth = options.maxWidth;
  }

  return globalThis.__hostMeasureText(params);
}
