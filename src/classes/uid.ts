import { toHex } from "../utils/bytes.js";

const UID_BRAND = Symbol.for('plist.UID');

export class UID extends Uint8Array {
  static override from(bytes: Uint8Array) {
    return new UID(
      bytes.buffer as ArrayBuffer,
      bytes.byteOffset,
      bytes.byteLength
    );
  }

  static fromNumber(value: number): UID {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError("UID number value must be an unsigned integer.");
    }

    let hex = value.toString(16);
    if (hex.length % 2 !== 0) {
      hex = `0${hex}`;
    }

    const bytes = new Uint8Array(Math.max(1, hex.length / 2));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) {
      start++;
    }

    const raw = bytes.subarray(start);
    if (raw.length > 16) {
      throw new RangeError("UID too large for binary plist");
    }

    return UID.from(raw);
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
    return toHex(this);
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `UID(${this.toHex()})`;
  }
}
