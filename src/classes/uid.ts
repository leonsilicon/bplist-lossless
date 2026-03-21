const UID_BRAND = Symbol.for('plist.UID');

export class UID extends Uint8Array {
  static override from(bytes: Uint8Array) {
    return new UID(
      bytes.buffer as ArrayBuffer,
      bytes.byteOffset,
      bytes.byteLength
    );
  }

  constructor(buffer: ArrayBuffer, byteOffset?: number, length?: number) {
    super(buffer, byteOffset, length);

    Object.defineProperty(this, UID_BRAND, {
      value: true,
      enumerable: false,
    });
  }

  static isUID(value: unknown): value is UID {
    return (
      value instanceof Uint8Array &&
      value != null &&
      (value as any)[UID_BRAND] === true
    );
  }

  override toHex() {
    return Array.from(this)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `UID(${this.toHex()})`;
  }
}
