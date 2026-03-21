import type { ByteSource } from "./bytes.js";
import { PlistDate } from "../classes/plist-date.js";
import { UID } from "../classes/uid.js";
import { Utf16String } from "../classes/utf16-string.js";
import {
  decodeUtf8,
  readFloat32BE,
  readFloat64BE,
  toUint8Array,
} from "./bytes.js";

export var maxObjectSize = 100 * 1000 * 1000; // 100Meg
export var maxObjectCount = 32768;

export function parseBplist(input: ByteSource) {
  const buffer = toUint8Array(input);

  const header = decodeUtf8(buffer.subarray(0, "bplist".length));
  if (header !== "bplist") {
    throw new Error("Invalid binary plist. Expected 'bplist' at offset 0.");
  }

  const trailer = buffer.slice(buffer.length - 32, buffer.length);
  const offsetSize = trailer[6]!;
  const objectRefSize = trailer[7]!;
  const numObjects = toSafeNumber(readBigUInt64BE(trailer, 8));
  const topObject = toSafeNumber(readBigUInt64BE(trailer, 16));
  const offsetTableOffset = toSafeNumber(readBigUInt64BE(trailer, 24));

  if (numObjects > maxObjectCount) {
    throw new Error("maxObjectCount exceeded");
  }

  const offsetTable: number[] = [];

  for (let i = 0; i < numObjects; i++) {
    const offsetBytes = buffer.slice(
      offsetTableOffset + i * offsetSize,
      offsetTableOffset + (i + 1) * offsetSize,
    );
    offsetTable[i] = toSafeNumber(readUInt(offsetBytes, 0));
  }

  function parseObject(tableOffset: number): any {
    const offset = offsetTable[tableOffset]!;
    const type = buffer[offset]!;
    const objType = (type & 0xf0) >> 4;
    const objInfo = type & 0x0f;

    switch (objType) {
    case 0x0:
      return parseSimple();
    case 0x1:
      return parseInteger();
    case 0x8:
      return parseUID();
    case 0x2:
      return parseReal();
    case 0x3:
      return parseDate();
    case 0x4:
      return parseData();
    case 0x5:
      return parsePlistString(false);
    case 0x6:
      return parsePlistString(true);
    case 0xa:
      return parseArray();
    case 0xd:
      return parseDictionary();
    default:
      throw new Error("Unhandled type 0x" + objType.toString(16));
    }

    function parseSimple() {
      switch (objInfo) {
      case 0x0:
        return null;
      case 0x8:
        return false;
      case 0x9:
        return true;
      case 0xf:
        return null;
      default:
        throw new Error("Unhandled simple type 0x" + objType.toString(16));
      }
    }

    function parseInteger() {
      const length = 1 << objInfo;

      if (length > maxObjectSize) {
        throw new Error(
          `Too little heap space available! Wanted to read ${length} bytes, but only ${maxObjectSize} are available.`,
        );
      }

      const start = offset + 1;
      const end = start + length;
      const data = buffer.subarray(start, end);

      let value = 0n;

      for (let i = 0; i < data.length; i++) {
        value = (value << 8n) | BigInt(data[i]!);
      }

      const bits = BigInt(length * 8);
      const signBit = 1n << (bits - 1n);

      if (value & signBit) {
        value -= 1n << bits;
      }

      return value;
    }

    function parseUID() {
      const length = objInfo + 1;
      if (length < maxObjectSize) {
        return new UID(
          buffer.buffer as ArrayBuffer,
          buffer.byteOffset + offset + 1,
          length,
        );
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parseReal() {
      const length = Math.pow(2, objInfo);
      if (length < maxObjectSize) {
        const realBuffer = buffer.slice(offset + 1, offset + 1 + length);
        if (length === 4) {
          return readFloat32BE(realBuffer);
        }
        if (length === 8) {
          return readFloat64BE(realBuffer);
        }
      } else {
        throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
      }
    }

    function parseDate() {
      if (objInfo !== 0x3) {
        console.error("Unknown date type: " + objInfo + ". Parsing anyway...");
      }

      const raw = buffer.subarray(offset + 1, offset + 9);
      return PlistDate.fromBytes(raw);
    }

    function parseData() {
      let dataoffset = 1;
      let length = objInfo;
      if (objInfo == 0xf) {
        const intTypeByte = buffer[offset + 1]!;
        const intType = (intTypeByte & 0xf0) / 0x10;
        if (intType != 0x1) {
          console.error("0x4: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = intTypeByte & 0x0f;
        const intLength = Math.pow(2, intInfo);
        dataoffset = 2 + intLength;
        length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
      }
      if (length < maxObjectSize) {
        return buffer.slice(offset + dataoffset, offset + dataoffset + length);
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parsePlistString(isUtf16: boolean) {
      let length = objInfo;
      let stroffset = 1;
      if (objInfo == 0xf) {
        const intTypeByte = buffer[offset + 1]!;
        const intType = (intTypeByte & 0xf0) / 0x10;
        if (intType != 0x1) {
          console.error("UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = intTypeByte & 0x0f;
        const intLength = Math.pow(2, intInfo);
        stroffset = 2 + intLength;
        length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
      }
      length *= Number(isUtf16) + 1;
      if (length < maxObjectSize) {
        const plistString = buffer.slice(offset + stroffset, offset + stroffset + length);
        if (isUtf16) {
          return Utf16String.from(plistString);
        }
        return decodeUtf8(plistString);
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parseArray() {
      let length = objInfo;
      let arrayoffset = 1;
      if (objInfo == 0xf) {
        const intTypeByte = buffer[offset + 1]!;
        const intType = (intTypeByte & 0xf0) / 0x10;
        if (intType != 0x1) {
          console.error("0xa: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = intTypeByte & 0x0f;
        const intLength = Math.pow(2, intInfo);
        arrayoffset = 2 + intLength;
        length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
      }
      if (length * objectRefSize > maxObjectSize) {
        throw new Error("Too little heap space available!");
      }
      const array = [];
      for (let i = 0; i < length; i++) {
        const objRef = toSafeNumber(
          readUInt(
            buffer.slice(
              offset + arrayoffset + i * objectRefSize,
              offset + arrayoffset + (i + 1) * objectRefSize,
            ),
          ),
        );
        array[i] = parseObject(objRef);
      }
      return array;
    }

    function parseDictionary() {
      let length = objInfo;
      let dictoffset = 1;
      if (objInfo == 0xf) {
        const intTypeByte = buffer[offset + 1]!;
        const intType = (intTypeByte & 0xf0) / 0x10;
        if (intType != 0x1) {
          console.error("0xD: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = intTypeByte & 0x0f;
        const intLength = Math.pow(2, intInfo);
        dictoffset = 2 + intLength;
        length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
      }
      if (length * 2 * objectRefSize > maxObjectSize) {
        throw new Error("Too little heap space available!");
      }
      const dict: Record<string, any> = createSafeObject();
      for (let i = 0; i < length; i++) {
        const keyRef = toSafeNumber(
          readUInt(
            buffer.slice(
              offset + dictoffset + i * objectRefSize,
              offset + dictoffset + (i + 1) * objectRefSize,
            ),
          ),
        );
        const valRef = toSafeNumber(
          readUInt(
            buffer.slice(
              offset + dictoffset + (length * objectRefSize) + i * objectRefSize,
              offset + dictoffset + (length * objectRefSize) + (i + 1) * objectRefSize,
            ),
          ),
        );
        const key = parseObject(keyRef);
        const val = parseObject(valRef);
        dict[key] = val;
      }
      return dict;
    }
  }

  return parseObject(topObject);
}

function readUInt(buffer: Uint8Array, start = 0): bigint {
  let result = 0n;

  for (let i = start; i < buffer.length; i++) {
    result <<= 8n;
    result |= BigInt(buffer[i]!);
  }

  return result;
}

function toSafeNumber(x: bigint): number {
  if (x > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Offset too large");
  }
  return Number(x);
}

function createSafeObject(): Record<string, any> {
  return Object.create(null);
}

function readBigUInt64BE(buf: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(buf[offset + i]!);
  }
  return value;
}
