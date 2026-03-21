import { PlistDate } from "../classes/plist-date.js";
import { UID } from "../classes/uid.js";
import { Utf16String } from "../classes/utf16-string.js";

export var maxObjectSize = 100 * 1000 * 1000; // 100Meg
export var maxObjectCount = 32768;

export function parseBplist(buffer: Buffer) {
  // check header
  const header = buffer.slice(0, 'bplist'.length).toString('utf8');
  if (header !== 'bplist') {
    throw new Error("Invalid binary plist. Expected 'bplist' at offset 0.");
  }

  // Handle trailer, last 32 bytes of the file
  const trailer = buffer.slice(buffer.length - 32, buffer.length);
  // 6 null bytes (index 0 to 5)
  const offsetSize = trailer.readUInt8(6);
  const objectRefSize = trailer.readUInt8(7);
  const numObjects = toSafeNumber(trailer.readBigUInt64BE(8));
  const topObject = toSafeNumber(trailer.readBigUInt64BE(16));
  const offsetTableOffset = toSafeNumber(trailer.readBigUInt64BE(24));

  if (numObjects > maxObjectCount) {
    throw new Error("maxObjectCount exceeded");
  }

  // Handle offset table
  const offsetTable: number[] = [];

  for (let i = 0; i < numObjects; i++) {
    const offsetBytes = buffer.slice(
      offsetTableOffset + i * offsetSize,
      offsetTableOffset + (i + 1) * offsetSize
    );
    offsetTable[i] = toSafeNumber(readUInt(offsetBytes, 0));
  }

  // Parses an object inside the currently parsed binary property list.
  // For the format specification check
  // <a href="https://www.opensource.apple.com/source/CF/CF-635/CFBinaryPList.c">
  // Apple's binary property list parser implementation</a>.
  function parseObject(tableOffset: number): any {
    const offset = offsetTable[tableOffset]!;
    const type = buffer[offset]!;
    const objType = (type & 0xF0) >> 4; //First  4 bits
    const objInfo = (type & 0x0F);      //Second 4 bits
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
    case 0x5: // ASCII
      return parsePlistString(false);
    case 0x6: // UTF-16
      return parsePlistString(true);
    case 0xA:
      return parseArray();
    case 0xD:
      return parseDictionary();
    default:
      throw new Error("Unhandled type 0x" + objType.toString(16));
    }

    function parseSimple() {
      //Simple
      switch (objInfo) {
      case 0x0: // null
        return null;
      case 0x8: // false
        return false;
      case 0x9: // true
        return true;
      case 0xF: // filler byte
        return null;
      default:
        throw new Error("Unhandled simple type 0x" + objType.toString(16));
      }
    }

    function bufferToHexString(buffer: Buffer) {
      let str = '';
      let i;
      for (i = 0; i < buffer.length; i++) {
        if (buffer[i] != 0x00) {
          break;
        }
      }
      for (; i < buffer.length; i++) {
        const part = '00' + buffer[i]!.toString(16);
        str += part.substr(part.length - 2);
      }
      return str;
    }

    // Always return a BigInt for integers
    function parseInteger() {
      const length = 1 << objInfo;

      if (length > maxObjectSize) {
        throw new Error(
          `Too little heap space available! Wanted to read ${length} bytes, but only ${maxObjectSize} are available.`
        );
      }

      const start = Number(offset) + 1;
      const end = start + length;
      const data = buffer.subarray(start, end); // no copy

      let value = 0n;

      for (let i = 0; i < data.length; i++) {
        value = (value << 8n) | BigInt(data[i]!);
      }

      // 🔥 handle signed (two's complement)
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
          buffer.byteOffset + Number(offset) + 1,
          length
        );
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parseReal() {
      const length = Math.pow(2, objInfo);
      if (length < maxObjectSize) {
        const realBuffer = buffer.slice(offset + 1, offset + 1 + length);
        if (length === 4) {
          return realBuffer.readFloatBE(0);
        }
        if (length === 8) {
          return realBuffer.readDoubleBE(0);
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
    return PlistDate.fromBuffer(raw);
  }

    function parseData() {
      let dataoffset = 1;
      let length = objInfo;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1]!;
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0x4: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        dataoffset = 2 + intLength;
        if (intLength < 3) {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        } else {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        }
      }
      if (length < maxObjectSize) {
        return buffer.slice(offset + dataoffset, offset + dataoffset + length);
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parsePlistString (isUtf16: boolean) {
      let enc = "utf8";
      let length = objInfo;
      let stroffset = 1;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1]!;
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        stroffset = 2 + intLength;
        if (intLength < 3) {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        } else {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        }
      }
      // length is String length -> to get byte length multiply by 2, as 1 character takes 2 bytes in UTF-16
      length *= (Number(isUtf16) + 1);
      if (length < maxObjectSize) {
        let plistString = Buffer.from(buffer.slice(offset + stroffset, offset + stroffset + length));
        if (isUtf16) {
          return Utf16String.from(plistString);
        } else {
          return plistString.toString('utf8');
        }
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parseArray() {
      let length = objInfo;
      let arrayoffset = 1;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1]!;
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xa: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        arrayoffset = 2 + intLength;
        if (intLength < 3) {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        } else {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        }
      }
      if (length * objectRefSize > maxObjectSize) {
        throw new Error("Too little heap space available!");
      }
      const array = [];
      for (let i = 0; i < length; i++) {
        const objRef = toSafeNumber(readUInt(buffer.slice(offset + arrayoffset + i * objectRefSize, offset + arrayoffset + (i + 1) * objectRefSize)));
        array[i] = parseObject(objRef);
      }
      return array;
    }

    function parseDictionary() {
      let length = objInfo;
      let dictoffset = 1;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1]!;
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xD: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        dictoffset = 2 + intLength;
        if (intLength < 3) {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        } else {
          length = toSafeNumber(readUInt(buffer.slice(offset + 2, offset + 2 + intLength)));
        }
      }
      if (length * 2 * objectRefSize > maxObjectSize) {
        throw new Error("Too little heap space available!");
      }
      const dict: Record<string, any> = createSafeObject();
      for (let i = 0; i < length; i++) {
        const keyRef = toSafeNumber(readUInt(buffer.slice(offset + dictoffset + i * objectRefSize, offset + dictoffset + (i + 1) * objectRefSize)));
        const valRef = toSafeNumber(readUInt(buffer.slice(offset + dictoffset + (length * objectRefSize) + i * objectRefSize, offset + dictoffset + (length * objectRefSize) + (i + 1) * objectRefSize)));
        const key = parseObject(keyRef);
        const val = parseObject(valRef);
        dict[key] = val;
      }
      return dict;
    }
  }

  return parseObject(topObject);
};

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
    throw new Error('Offset too large');
  }
  return Number(x);
}

function createSafeObject(): Record<string, any> {
  return Object.create(null);
}
