import { decodeUtf16BE, toHex } from "../utils/bytes.js";

const UTF16_STRING_BRAND = Symbol.for('plist.Utf16String');

export class Utf16String extends Uint8Array {
  static override from(bytes: Uint8Array): Utf16String {
    return new Utf16String(
      bytes.buffer as ArrayBuffer,
      bytes.byteOffset,
      bytes.byteLength
    );
  }

  constructor(buffer: ArrayBuffer, byteOffset?: number, length?: number) {
    super(buffer, byteOffset, length);

    Object.defineProperty(this, UTF16_STRING_BRAND, {
      value: true,
      enumerable: false,
    });
  }

  static isUtf16String(value: unknown): value is Utf16String {
    return (
      value instanceof Uint8Array &&
      value != null &&
      (value as any)[UTF16_STRING_BRAND] === true
    );
  }

  override toString(): string {
    return decodeUtf16BE(this);
  }

  override toHex(): string {
    return toHex(this);
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Utf16String(${this.toString()})`;
  }
}
