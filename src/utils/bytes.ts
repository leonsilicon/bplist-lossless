export type ByteSource = Uint8Array | ArrayBuffer | ArrayBufferView;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function isByteSource(value: unknown): value is ByteSource {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

export function toUint8Array(input: ByteSource): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

export function copyBytes(input: ByteSource): Uint8Array {
  return new Uint8Array(toUint8Array(input));
}

export function concatBytes(chunks: Uint8Array[], totalSize?: number): Uint8Array {
  const size =
    totalSize ??
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return out;
}

export function encodeUtf8(value: string): Uint8Array {
  return UTF8_ENCODER.encode(value);
}

export function decodeUtf8(input: ByteSource): string {
  return UTF8_DECODER.decode(toUint8Array(input));
}

export function encodeLatin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length);

  for (let i = 0; i < value.length; i++) {
    const codeUnit = value.charCodeAt(i);
    if (codeUnit > 0xff) {
      throw new RangeError("Latin-1 encoding only supports code units <= 0xFF.");
    }
    out[i] = codeUnit;
  }

  return out;
}

export function encodeUtf16BE(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);

  for (let i = 0; i < value.length; i++) {
    const codeUnit = value.charCodeAt(i);
    out[i * 2] = codeUnit >>> 8;
    out[i * 2 + 1] = codeUnit & 0xff;
  }

  return out;
}

export function decodeUtf16BE(input: ByteSource): string {
  const bytes = toUint8Array(input);

  if (bytes.length % 2 !== 0) {
    throw new Error("Invalid UTF-16 byte length");
  }

  let result = "";
  const chunkSize = 0x4000;

  for (let start = 0; start < bytes.length; start += chunkSize * 2) {
    const end = Math.min(start + chunkSize * 2, bytes.length);
    const codeUnits: number[] = new Array((end - start) / 2);

    for (let i = start, j = 0; i < end; i += 2, j++) {
      codeUnits[j] = (bytes[i]! << 8) | bytes[i + 1]!;
    }

    result += String.fromCharCode(...codeUnits);
  }

  return result;
}

export function toHex(input: ByteSource): string {
  const bytes = toUint8Array(input);
  let out = "";

  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }

  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new TypeError("Hex input must have an even number of characters.");
  }

  const out = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new TypeError("Invalid hexadecimal input.");
    }
    out[i / 2] = byte;
  }

  return out;
}

export function toBase64(input: ByteSource): string {
  const bytes = toUint8Array(input);
  let out = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;

    out += BASE64_ALPHABET[(n >> 18) & 0x3f]!;
    out += BASE64_ALPHABET[(n >> 12) & 0x3f]!;
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(n >> 6) & 0x3f]! : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[n & 0x3f]! : "=";
  }

  return out;
}

export function bytesEqual(left: ByteSource, right: ByteSource): boolean {
  const a = toUint8Array(left);
  const b = toUint8Array(right);

  if (a.byteLength !== b.byteLength) {
    return false;
  }

  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

export function writeFloat64BE(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setFloat64(0, value, false);
  return out;
}

export function readFloat32BE(input: ByteSource, offset = 0): number {
  const bytes = toUint8Array(input);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, false);
}

export function readFloat64BE(input: ByteSource, offset = 0): number {
  const bytes = toUint8Array(input);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, false);
}
