import { toHex } from "../utils/bytes.js";

const UID_BRAND = Symbol.for('plist.UID');

export class UID extends Uint8Array {
  static override from(bytes: Uint8Array) {
    return new UID(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );
  }

  constructor(buffer: ArrayBufferLike, byteOffset?: number, length?: number) {
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
    return toHex(this);
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `UID(${this.toHex()})`;
  }
}
