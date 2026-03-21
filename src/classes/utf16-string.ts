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
    const copy = new Uint8Array(this);

    if (this.length % 2 !== 0) {
      throw new Error('Invalid UTF-16 byte length');
    }

    for (let i = 0; i < copy.length; i += 2) {
      const a = copy[i];
      copy[i] = copy[i + 1]!;
      copy[i + 1] = a!;
    }

    return Buffer.from(copy).toString('ucs2');
  }

  override toHex(): string {
    return Array.from(this)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Utf16String(${this.toString()})`;
  }
}
