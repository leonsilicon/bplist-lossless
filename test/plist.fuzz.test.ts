import { describe, expect, test } from "vitest";
import { test as propTest, fc } from "@fast-check/vitest";

import {
  parseBplist as parse,
  serializeBplist as serialize,
} from "../src/exports/main.js";
import { PlistDate } from "../src/classes/plist-date.js";
import { UID } from "../src/classes/uid.js";
import { Utf16String } from "../src/classes/utf16-string.js";

const FC_RUNS = Number(process.env.FC_RUNS ?? 100_000);
const FC_SEED = process.env.FC_SEED ? Number(process.env.FC_SEED) : 42;

function createSafeObject(): Record<string, unknown> {
  return Object.create(null);
}

function asBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }

  return out;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableNumberString(value: number): string {
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  return value.toString();
}

function asciiFrom(xs: readonly number[]): string {
  return String.fromCharCode(...xs);
}

function toUtf16String(text: string): Utf16String {
  const be = new Uint8Array(text.length * 2);

  for (let i = 0; i < text.length; i++) {
    const codeUnit = text.charCodeAt(i);
    be[i * 2] = codeUnit >>> 8;
    be[i * 2 + 1] = codeUnit & 0xff;
  }

  return Utf16String.from(be);
}

function encodeUid(value: bigint): UID {
  if (value < 0n) {
    throw new RangeError("UID must be unsigned");
  }

  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  if (hex.length === 0) hex = "00";

  const minimal = hex.length === 0 ? Uint8Array.of(0) : hexToBytes(hex);

  if (minimal.length > 16) {
    throw new RangeError("UID too large for binary plist");
  }

  return new UID(
    minimal.buffer as ArrayBuffer,
    minimal.byteOffset,
    minimal.byteLength,
  );
}

function normalizePlist(value: unknown): unknown {
  if (value instanceof UID) {
    return { $uidHex: bytesToHex(asBytes(value)) };
  }

  if (value instanceof Date) {
    const d = PlistDate.from(value);
    return { $dateMs: stableNumberString(d.getTime()) };
  }

  if (value instanceof Utf16String) {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return { $dataHex: bytesToHex(asBytes(value)) };
  }

  if (typeof value === "bigint") {
    return { $int: value.toString() };
  }

  if (typeof value === "number") {
    return { $real: stableNumberString(value) };
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizePlist);
  }

  if (typeof value === "object" && value !== null) {
    const out = createSafeObject();
    const obj = value as Record<string, unknown>;

    for (const key of Object.keys(obj).sort()) {
      out[key] = normalizePlist(obj[key]);
    }

    return out;
  }

  throw new Error(`Unsupported value in test normalizer: ${String(value)}`);
}

function expectPlistSemanticsEqual(actual: unknown, expected: unknown) {
  expect(normalizePlist(actual)).toStrictEqual(normalizePlist(expected));
}

function expectRoundTrip(input: unknown) {
  const output = parse(serialize(input));
  expectPlistSemanticsEqual(output, input);
}

const asciiStringArb = fc
  .array(fc.integer({ min: 0x00, max: 0x7f }), { maxLength: 24 })
  .map(asciiFrom);

const nonAsciiStringArb = fc
  .tuple(
    fc.array(fc.integer({ min: 0x00, max: 0x7f }), { maxLength: 8 }),
    fc.integer({ min: 0x80, max: 0xd7ff }),
    fc.array(fc.integer({ min: 0x00, max: 0x7f }), { maxLength: 8 }),
  )
  .map(([left, cp, right]) => {
    return asciiFrom(left) + String.fromCodePoint(cp) + asciiFrom(right);
  });

const plistKeyArb = fc.oneof(asciiStringArb, nonAsciiStringArb);

const plistStringArb = fc.oneof(
  asciiStringArb,
  nonAsciiStringArb,
  nonAsciiStringArb.map(toUtf16String),
);

function signedIntArb(bytes: 1 | 2 | 4 | 8 | 16): fc.Arbitrary<bigint> {
  const bits = BigInt(bytes * 8);
  return fc.bigInt({
    min: -(1n << (bits - 1n)),
    max: (1n << (bits - 1n)) - 1n,
  });
}

const plistIntegerArb = fc.oneof(
  signedIntArb(1),
  signedIntArb(2),
  signedIntArb(4),
  signedIntArb(8),
  signedIntArb(16),
);

const plistRealArb = fc
  .double({ noNaN: true })
  .filter((n) => !Number.isInteger(n) || Object.is(n, -0));

const plistDateArb = fc.oneof(
  fc.date().map((d) => new Date(d.getTime())),
  fc.date().map((d) => PlistDate.fromUnixMilliseconds(d.getTime())),
);

const plistDataArb = fc.uint8Array({ maxLength: 32 });

const plistUidArb = fc
  .bigInt({ min: 0n, max: (1n << 128n) - 1n })
  .map(encodeUid);

const depthIdentifier = fc.createDepthIdentifier();

const plistValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  leaf: fc.oneof(
    { withCrossShrink: true },
    fc.boolean(),
    fc.constant(null),
    plistIntegerArb,
    plistRealArb,
    plistStringArb,
    plistDateArb,
    plistDataArb,
    plistUidArb,
  ),

  array: fc.array(tie("value"), { maxLength: 8 }),

  dict: fc
    .uniqueArray(fc.tuple(plistKeyArb, tie("value")), {
      maxLength: 8,
      selector: ([k]) => k,
    })
    .map((entries) => {
      const out = createSafeObject();
      for (const [k, v] of entries) {
        out[k] = v;
      }
      return out;
    }),

  value: fc.oneof(
    { depthSize: "small", withCrossShrink: true, depthIdentifier },
    tie("leaf"),
    tie("array"),
    tie("dict"),
  ),
})).value;

propTest.prop([plistValueArb], {
  numRuns: FC_RUNS,
  seed: FC_SEED,
  verbose: 1,
  endOnFailure: true,
})("parse(serialize(x)) preserves plist semantics for valid Apple bplist values", (input) => {
  const output = parse(serialize(input));
  expectPlistSemanticsEqual(output, input);
});

describe("edge cases", () => {
  test("UID.fromNumber creates canonical UID bytes", () => {
    expect(UID.fromNumber(0).toHex()).toBe("00");
    expect(UID.fromNumber(42).toHex()).toBe("2a");
    expect(UID.fromNumber(256).toHex()).toBe("0100");
    expect(() => UID.fromNumber(-1)).toThrow(TypeError);
    expect(() => UID.fromNumber(1.5)).toThrow(TypeError);
  });

  test("empty arrays", () => {
    expectRoundTrip([]);
    expectRoundTrip([[]]);
    expectRoundTrip([[[]]]);
    expectRoundTrip([[], []]);
  });

  test("empty objects", () => {
    expectRoundTrip(createSafeObject());
    expectRoundTrip([createSafeObject()]);
    expectRoundTrip([createSafeObject(), createSafeObject()]);
  });

  test("negative bigints", () => {
    const outer = createSafeObject();
    const inner = createSafeObject();
    inner[""] = -9007199254740992n;
    outer[""] = inner;
    expectRoundTrip([outer]);
  });

  test("plain Date input compares equal to parsed PlistDate output", () => {
    expectRoundTrip(new Date("2000-01-01T00:00:00.000Z"));
  });

  test("dangerous dictionary keys", () => {
    const input = createSafeObject();
    input["__proto__"] = true;
    input["constructor"] = false;
    input["prototype"] = [1n, 2n, 3n];
    expectRoundTrip(input);
  });

  test("UID extremes", () => {
    expectRoundTrip(encodeUid(0n));
    expectRoundTrip(encodeUid((1n << 128n) - 1n));
  });

  test("null", () => {
    const output = parse(serialize(null));
    expect(output).toBeNull();
  });
});
