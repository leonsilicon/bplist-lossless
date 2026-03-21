import { PlistDate } from "../classes/plist-date.js";
import { UID } from "../classes/uid.js";
import { Utf16String } from "../classes/utf16-string.js";
import {
  concatBytes,
  copyBytes,
  encodeLatin1,
  encodeUtf16BE,
  encodeUtf8,
  fromHex,
  isByteSource,
  toUint8Array,
  writeFloat64BE,
} from "./bytes.js";

export function serializeBplist(dicts: unknown) {
  const buffer = new WritableStreamBuffer();
  buffer.write(encodeUtf8("bplist00"));

  let entries = toEntries(dicts);
  const idSizeInBytes = computeIdSizeInBytes(entries.length);
  const offsets: number[] = [];
  let offsetSizeInBytes: number;
  let offsetTableOffset: number;

  updateEntryIds();

  entries.forEach(function(entry, entryIdx) {
    offsets[entryIdx] = buffer.size();
    if (!entry) {
      buffer.write(0x00);
    } else {
      write(entry);
    }
  });

  writeOffsetTable();
  writeTrailer();
  return buffer.getContents();

  function updateEntryIds() {
    const strings: Record<string, any> = {};
    let entryId = 0;
    entries.forEach(function(entry) {
      if (entry.id) {
        return;
      }
      if (entry.type === "string") {
        if (!entry.bplistOverride && strings.hasOwnProperty(entry.value)) {
          entry.type = "stringref";
          entry.id = strings[entry.value];
        } else {
          strings[entry.value] = entry.id = entryId++;
        }
      } else {
        entry.id = entryId++;
      }
    });

    entries = entries.filter(function(entry) {
      return entry.type !== "stringref";
    });
  }

  function writeTrailer() {
    buffer.write(new Uint8Array(6));
    writeByte(offsetSizeInBytes);
    writeByte(idSizeInBytes);
    writeLong(entries.length);
    writeLong(0);
    writeLong(offsetTableOffset);
  }

  function writeOffsetTable() {
    offsetTableOffset = buffer.size();
    offsetSizeInBytes = computeOffsetSizeInBytes(offsetTableOffset);
    offsets.forEach(function(offset) {
      writeBytes(offset, offsetSizeInBytes);
    });
  }

  function write(entry: any) {
    switch (entry.type) {
    case "dict":
      writeDict(entry);
      break;
    case "number":
    case "double":
      writeNumber(entry);
      break;
    case "UID":
      writeUID(entry);
      break;
    case "array":
      writeArray(entry);
      break;
    case "boolean":
      writeBoolean(entry);
      break;
    case "string":
    case "string-utf16":
      writeString(entry);
      break;
    case "date":
      writeDate(entry);
      break;
    case "data":
      writeData(entry);
      break;
    case "null":
      writeNull();
      break;
    default:
      throw new Error("unhandled entry type: " + entry.type);
    }
  }

  function writeDate(entry: any) {
    writeByte(0x33);
    buffer.write(PlistDate.from(entry.value).toBytes());
  }

  function writeDict(entry: any) {
    writeIntHeader(0xD, entry.entryKeys.length);
    entry.entryKeys.forEach(function(item: any) {
      writeID(item.id);
    });
    entry.entryValues.forEach(function(item: any) {
      writeID(item.id);
    });
  }

  function writeNumber(entry: any) {
    if (typeof entry.value === "bigint") {
      const size = getIntSize(entry.value);
      const header = 0x10 | Math.log2(size);

      writeByte(header);
      buffer.write(bigintToBuffer(entry.value, size));
    } else if (entry.type !== "double" && parseFloat(entry.value).toFixed() == entry.value) {
      if (entry.value < 0) {
        writeByte(0x13);
        writeBytes(entry.value, 8, true);
      } else if (entry.value <= 0xff) {
        writeByte(0x10);
        writeBytes(entry.value, 1);
      } else if (entry.value <= 0xffff) {
        writeByte(0x11);
        writeBytes(entry.value, 2);
      } else if (entry.value <= 0xffffffff) {
        writeByte(0x12);
        writeBytes(entry.value, 4);
      } else {
        writeByte(0x13);
        writeBytes(entry.value, 8);
      }
    } else {
      writeByte(0x23);
      writeDouble(entry.value);
    }
  }

  function writeUID(entry: any) {
    let raw: Uint8Array;

    if (entry.value instanceof UID) {
      raw = copyBytes(entry.value);
    } else if (typeof entry.value === "bigint") {
      if (entry.value < 0n) {
        throw new TypeError("UID must be unsigned");
      }

      let hex = entry.value.toString(16);
      if (hex.length % 2 !== 0) hex = "0" + hex;
      raw = fromHex(hex || "00");
    } else if (
      typeof entry.value === "number" &&
      Number.isInteger(entry.value) &&
      entry.value >= 0
    ) {
      const n = BigInt(entry.value);
      let hex = n.toString(16);
      if (hex.length % 2 !== 0) hex = "0" + hex;
      raw = fromHex(hex || "00");
    } else {
      throw new TypeError("UID value must be a UID, bigint, or unsigned integer number");
    }

    let start = 0;
    while (start < raw.length - 1 && raw[start] === 0) start++;
    raw = raw.subarray(start);

    if (raw.length < 1 || raw.length > 16) {
      throw new RangeError(`UID must be between 1 and 16 bytes, got ${raw.length}`);
    }

    writeByte(0x80 | (raw.length - 1));
    buffer.write(raw);
  }

  function writeArray(entry: any) {
    writeIntHeader(0xA, entry.entries.length);
    entry.entries.forEach(function(item: any) {
      writeID(item.id);
    });
  }

  function writeBoolean(entry: any) {
    writeByte(entry.value ? 0x09 : 0x08);
  }

  function writeNull() {
    writeByte(0x00);
  }

  function writeString(entry: any) {
    if (entry.type === "string-utf16") {
      const utf16 = Utf16String.isUtf16String(entry.value)
        ? copyBytes(entry.value)
        : encodeUtf16BE(entry.value);

      writeIntHeader(0x6, utf16.length / 2);
      buffer.write(utf16);
    } else {
      const ascii = encodeLatin1(entry.value);
      writeIntHeader(0x5, ascii.length);
      buffer.write(ascii);
    }
  }

  function writeData(entry: any) {
    writeIntHeader(0x4, entry.value.length);
    buffer.write(entry.value);
  }

  function writeLong(l: number) {
    writeBytes(l, 8);
  }

  function writeByte(b: number) {
    buffer.write(b);
  }

  function writeDouble(v: number) {
    buffer.write(writeFloat64BE(v));
  }

  function writeIntHeader(kind: number, value: number) {
    if (value < 15) {
      writeByte((kind << 4) + value);
    } else if (value < 256) {
      writeByte((kind << 4) + 15);
      writeByte(0x10);
      writeBytes(value, 1);
    } else if (value < 65536) {
      writeByte((kind << 4) + 15);
      writeByte(0x11);
      writeBytes(value, 2);
    } else {
      writeByte((kind << 4) + 15);
      writeByte(0x12);
      writeBytes(value, 4);
    }
  }

  function writeID(id: number) {
    writeBytes(id, idSizeInBytes);
  }

  function writeBytes(value: number, bytes: number, isSignedInt = false) {
    const buf = new Uint8Array(bytes);
    let z = 0;

    while (bytes > 4) {
      buf[z++] = isSignedInt ? 0xff : 0;
      bytes--;
    }

    for (let i = bytes - 1; i >= 0; i--) {
      buf[z++] = value >> (8 * i);
    }

    buffer.write(buf);
  }
}

function toEntries(dicts: any) {
  if (dicts === null) {
    return [
      {
        type: "null",
        value: null,
      },
    ];
  } else if (typeof dicts === "boolean") {
    return [
      {
        type: "boolean",
        value: dicts,
      },
    ];
  } else if (typeof dicts === "bigint") {
    return [
      {
        type: "number",
        value: dicts,
      },
    ];
  } else if (typeof dicts === "number") {
    return [
      {
        type: "double",
        value: dicts,
      },
    ];
  } else if (typeof dicts === "string") {
    return [
      {
        type: mustBeUtf16(dicts) ? "string-utf16" : "string",
        value: dicts,
      },
    ];
  } else if (Utf16String.isUtf16String(dicts)) {
    return [
      {
        type: "string-utf16",
        value: dicts,
      },
    ];
  } else if (UID.isUID(dicts)) {
    return [
      {
        type: "UID",
        value: dicts,
      },
    ];
  } else if (isByteSource(dicts)) {
    return [
      {
        type: "data",
        value: copyBytes(toUint8Array(dicts)),
      },
    ];
  } else if (
    PlistDate.isPlistDate(dicts) ||
    Object.prototype.toString.call(dicts) === "[object Date]"
  ) {
    return [
      {
        type: "date",
        value: dicts,
      },
    ];
  } else if (Array.isArray(dicts)) {
    return toEntriesArray(dicts);
  } else if (isPlainObject(dicts)) {
    return toEntriesObject(dicts);
  } else {
    throw new Error("unhandled entry: " + dicts);
  }
}

function toEntriesArray(arr: unknown[]) {
  let results = [
    {
      type: "array",
      entries: [] as unknown[],
    },
  ];
  arr.forEach(function(v) {
    const entry = toEntries(v);
    results[0]!.entries.push(entry[0]);
    results = results.concat(entry);
  });
  return results;
}

function toEntriesObject(dict: Record<string, unknown>) {
  const result = {
    type: "dict",
    entryKeys: [] as unknown[],
    entryValues: [] as unknown[],
  };

  const results: any[] = [result];

  for (const key of Reflect.ownKeys(dict)) {
    if (typeof key !== "string") continue;

    const entryKey = toEntries(key);
    const entryValue = toEntries((dict as any)[key]);

    result.entryKeys.push(entryKey[0]!);
    result.entryValues.push(entryValue[0]!);

    results.push(...entryKey);
    results.push(...entryValue);
  }

  return results;
}

function computeOffsetSizeInBytes(maxOffset: number) {
  if (maxOffset < 256) {
    return 1;
  }
  if (maxOffset < 65536) {
    return 2;
  }
  if (maxOffset < 4294967296) {
    return 4;
  }
  return 8;
}

function computeIdSizeInBytes(numberOfIds: number) {
  if (numberOfIds < 256) {
    return 1;
  }
  if (numberOfIds < 65536) {
    return 2;
  }
  return 4;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

class WritableStreamBuffer {
  _chunks: Uint8Array[];
  _size: number;

  constructor() {
    this._chunks = [];
    this._size = 0;
  }

  write(chunk: unknown, encoding?: any) {
    let buf: Uint8Array;

    if (typeof chunk === "number") {
      buf = Uint8Array.of(chunk & 0xff);
    } else if (isByteSource(chunk)) {
      buf = copyBytes(chunk);
    } else if (typeof chunk === "string") {
      if (encoding && encoding !== "utf8") {
        throw new TypeError(`Unsupported string encoding passed to write(): ${String(encoding)}`);
      }
      buf = encodeUtf8(chunk);
    } else {
      throw new TypeError("Unsupported chunk type passed to write()");
    }

    this._chunks.push(buf);
    this._size += buf.length;
    return true;
  }

  size() {
    return this._size;
  }

  getContents() {
    return concatBytes(this._chunks, this._size);
  }
}

function bigintToBuffer(value: bigint, size: number): Uint8Array {
  const buf = new Uint8Array(size);

  let temp = value;

  if (value < 0) {
    temp = (1n << BigInt(size * 8)) + value;
  }

  for (let i = size - 1; i >= 0; i--) {
    buf[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }

  return buf;
}

function getIntSize(value: bigint): number {
  if (value >= -0x80n && value <= 0x7fn) return 1;
  if (value >= -0x8000n && value <= 0x7fffn) return 2;
  if (value >= -0x80000000n && value <= 0x7fffffffn) return 4;
  if (value >= -0x8000000000000000n && value <= 0x7fffffffffffffffn) return 8;
  return 16;
}

function mustBeUtf16(str: string) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}
