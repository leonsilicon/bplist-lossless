const APPLE_PLIST_EPOCH_MS = Date.UTC(2001, 0, 1);

export type PlistDateBinaryInput = Buffer | Uint8Array | ArrayBuffer;
export type PlistDateInput =
  | PlistDate
  | Date
  | number
  | PlistDateBinaryInput;

type PlistCanonicalState = {
  raw: Buffer;
  plistSeconds: number;
  unixMilliseconds: number;
};

function isBinaryInput(value: unknown): value is PlistDateBinaryInput {
  return (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  );
}

function normalizeRaw8(input: PlistDateBinaryInput): Buffer {
  const raw = Buffer.isBuffer(input)
    ? Buffer.from(input)
    : input instanceof Uint8Array
      ? Buffer.from(input)
      : Buffer.from(new Uint8Array(input));

  if (raw.length !== 8) {
    throw new RangeError(
      `PlistDate raw value must be exactly 8 bytes, got ${raw.length}.`,
    );
  }

  return raw;
}

function encodePlistSeconds(seconds: number): Buffer {
  const raw = Buffer.allocUnsafe(8);
  raw.writeDoubleBE(seconds, 0);
  return raw;
}

function decodePlistSeconds(raw: Buffer): number {
  return raw.readDoubleBE(0);
}

function plistSecondsToUnixMilliseconds(seconds: number): number {
  return APPLE_PLIST_EPOCH_MS + seconds * 1000;
}

function unixMillisecondsToPlistSeconds(milliseconds: number): number {
  return (milliseconds - APPLE_PLIST_EPOCH_MS) / 1000;
}

function numberToStableString(value: number): string {
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  return value.toString();
}

/**
 * Exact raw plist path.
 */
function canonicalStateFromRaw(input: PlistDateBinaryInput): PlistCanonicalState {
  const raw = normalizeRaw8(input);
  const plistSeconds = decodePlistSeconds(raw);
  const unixMilliseconds = plistSecondsToUnixMilliseconds(plistSeconds);

  return { raw, plistSeconds, unixMilliseconds };
}

/**
 * Canonicalize a plist-seconds number by round-tripping it through the
 * actual 8-byte binary representation.
 */
function canonicalStateFromPlistSeconds(
  seconds: number,
): PlistCanonicalState {
  const raw = encodePlistSeconds(seconds);
  const plistSeconds = decodePlistSeconds(raw);
  const unixMilliseconds = plistSecondsToUnixMilliseconds(plistSeconds);

  return { raw, plistSeconds, unixMilliseconds };
}

/**
 * Canonicalize Unix milliseconds into the exact plist-representable value.
 *
 * This is the key fix for discrepancies like:
 *   4410317596806472
 * becoming
 *   4410317596806471.5
 *
 * We normalize immediately instead of only discovering the change after
 * encode -> decode.
 */
function canonicalStateFromUnixMilliseconds(
  milliseconds: number,
): PlistCanonicalState {
  return canonicalStateFromPlistSeconds(
    unixMillisecondsToPlistSeconds(milliseconds),
  );
}

function resolveInitialState(value?: PlistDateInput): PlistCanonicalState {
  if (value instanceof PlistDate) {
    return canonicalStateFromRaw(value.getRawBytes());
  }

  if (isBinaryInput(value)) {
    return canonicalStateFromRaw(value);
  }

  if (value instanceof Date) {
    return canonicalStateFromUnixMilliseconds(value.getTime());
  }

  if (typeof value === "number") {
    return canonicalStateFromUnixMilliseconds(value);
  }

  return canonicalStateFromUnixMilliseconds(Date.now());
}

export class PlistDate extends Date {
  static readonly APPLE_PLIST_EPOCH_MS = APPLE_PLIST_EPOCH_MS;

  /**
   * Raw 8-byte plist payload is the canonical source of truth.
   */
  #raw = encodePlistSeconds(0);

  constructor();
  constructor(value: PlistDateInput);
  constructor(value?: PlistDateInput) {
    const state = resolveInitialState(value);
    super(state.unixMilliseconds);
    this.#raw = state.raw;
  }

  static from(input: PlistDateInput): PlistDate {
    return new PlistDate(input);
  }

  static fromBuffer(input: PlistDateBinaryInput): PlistDate {
    return new PlistDate(input);
  }

  static fromPlistSeconds(seconds: number): PlistDate {
    return new PlistDate(encodePlistSeconds(seconds));
  }

  static fromUnixMilliseconds(milliseconds: number): PlistDate {
    return new PlistDate(milliseconds);
  }

  static isPlistDate(value: unknown): value is PlistDate {
    return value instanceof PlistDate;
  }

  #applyCanonicalState(state: PlistCanonicalState): void {
    this.#raw = Buffer.from(state.raw);

    // Native Date only keeps whole-millisecond precision internally.
    // We still keep the exact plist value in #raw and expose it through
    // plistSeconds/getTime().
    super.setTime(state.unixMilliseconds);
  }

  #replaceFromRaw(input: PlistDateBinaryInput): void {
    this.#applyCanonicalState(canonicalStateFromRaw(input));
  }

  #replaceFromPlistSeconds(seconds: number): void {
    this.#applyCanonicalState(canonicalStateFromPlistSeconds(seconds));
  }

  #replaceFromUnixMilliseconds(milliseconds: number): number {
    this.#applyCanonicalState(
      canonicalStateFromUnixMilliseconds(milliseconds),
    );
    return this.getTime();
  }

  #resyncFromDateState(): number {
    return this.#replaceFromUnixMilliseconds(super.getTime());
  }

  /**
   * Exact plist-native value:
   * seconds since 2001-01-01T00:00:00Z stored as IEEE 754
   * (Institute of Electrical and Electronics Engineers 754) double.
   */
  get plistSeconds(): number {
    return decodePlistSeconds(this.#raw);
  }

  getPlistSeconds(): number {
    return this.plistSeconds;
  }

  getPlistSecondsString(): string {
    return numberToStableString(this.plistSeconds);
  }

  /**
   * Exact raw 8-byte plist payload.
   * If the object was constructed from raw bytes, those bytes are preserved
   * until the date is mutated.
   */
  getRawBytes(): Buffer {
    return Buffer.from(this.#raw);
  }

  toRawString(encoding: BufferEncoding = "hex"): string {
    return this.#raw.toString(encoding);
  }

  getRawHex(): string {
    return this.toRawString("hex");
  }

  getRawBase64(): string {
    return this.toRawString("base64");
  }

  toPlistString(): string {
    return this.getPlistSecondsString();
  }

  toBuffer(): Buffer {
    return this.getRawBytes();
  }

  /**
   * Set the exact plist-native seconds value.
   * Returns the plist-seconds string.
   */
  setPlistSeconds(seconds: number): string {
    if (typeof seconds !== "number") {
      throw new TypeError("PlistDate seconds must be a number.");
    }

    this.#replaceFromPlistSeconds(seconds);
    return this.getPlistSecondsString();
  }

  /**
   * Replace the date from exact raw plist bytes.
   * Returns the plist-seconds string.
   */
  setRawBytes(input: PlistDateBinaryInput): string {
    this.#replaceFromRaw(input);
    return this.getPlistSecondsString();
  }

  /**
   * Parse raw hex into the exact 8-byte plist payload.
   */
  setRawHex(hex: string): string {
    if (typeof hex !== "string" || !/^[0-9a-fA-F]{16}$/.test(hex)) {
      throw new TypeError(
        "PlistDate raw hex must be a 16-character hexadecimal string.",
      );
    }

    return this.setRawBytes(Buffer.from(hex, "hex"));
  }

  /**
   * Exact Unix milliseconds derived from the canonical plist bytes.
   * This may include a fractional millisecond.
   */
  override getTime(): number {
    return plistSecondsToUnixMilliseconds(this.plistSeconds);
  }

  override valueOf(): number {
    return this.getTime();
  }

  override [Symbol.toPrimitive](hint: "default"): string;
  override [Symbol.toPrimitive](hint: "string"): string;
  override [Symbol.toPrimitive](hint: "number"): number;
  override [Symbol.toPrimitive](hint: string): string | number {
    if (hint === "number") {
      return this.getTime();
    }

    return this.toString();
  }

  override toJSON(): string {
    return new Date(this.getTime()).toISOString();
  }

  clone(): PlistDate {
    return new PlistDate(this.#raw);
  }

  equalsExactly(other: PlistDateInput): boolean {
    const rhs = PlistDate.from(other);
    return this.#raw.equals(rhs.#raw);
  }

  equalsValue(other: PlistDateInput): boolean {
    const rhs = PlistDate.from(other);
    return Object.is(this.plistSeconds, rhs.plistSeconds);
  }

  /**
   * Direct time-setting path: normalize immediately to the exact
   * plist-representable value.
   */
  override setTime(time: number): number {
    return this.#replaceFromUnixMilliseconds(time);
  }

  override setMilliseconds(ms: number): number {
    super.setMilliseconds(ms);
    return this.#resyncFromDateState();
  }

  override setUTCMilliseconds(ms: number): number {
    super.setUTCMilliseconds(ms);
    return this.#resyncFromDateState();
  }

  override setSeconds(sec: number, ms?: number): number {
    if (ms === undefined) {
      super.setSeconds(sec);
    } else {
      super.setSeconds(sec, ms);
    }
    return this.#resyncFromDateState();
  }

  override setUTCSeconds(sec: number, ms?: number): number {
    if (ms === undefined) {
      super.setUTCSeconds(sec);
    } else {
      super.setUTCSeconds(sec, ms);
    }
    return this.#resyncFromDateState();
  }

  override setMinutes(min: number, sec?: number, ms?: number): number {
    if (sec === undefined) {
      super.setMinutes(min);
    } else if (ms === undefined) {
      super.setMinutes(min, sec);
    } else {
      super.setMinutes(min, sec, ms);
    }
    return this.#resyncFromDateState();
  }

  override setUTCMinutes(min: number, sec?: number, ms?: number): number {
    if (sec === undefined) {
      super.setUTCMinutes(min);
    } else if (ms === undefined) {
      super.setUTCMinutes(min, sec);
    } else {
      super.setUTCMinutes(min, sec, ms);
    }
    return this.#resyncFromDateState();
  }

  override setHours(
    hours: number,
    min?: number,
    sec?: number,
    ms?: number,
  ): number {
    if (min === undefined) {
      super.setHours(hours);
    } else if (sec === undefined) {
      super.setHours(hours, min);
    } else if (ms === undefined) {
      super.setHours(hours, min, sec);
    } else {
      super.setHours(hours, min, sec, ms);
    }
    return this.#resyncFromDateState();
  }

  override setUTCHours(
    hours: number,
    min?: number,
    sec?: number,
    ms?: number,
  ): number {
    if (min === undefined) {
      super.setUTCHours(hours);
    } else if (sec === undefined) {
      super.setUTCHours(hours, min);
    } else if (ms === undefined) {
      super.setUTCHours(hours, min, sec);
    } else {
      super.setUTCHours(hours, min, sec, ms);
    }
    return this.#resyncFromDateState();
  }

  override setDate(date: number): number {
    super.setDate(date);
    return this.#resyncFromDateState();
  }

  override setUTCDate(date: number): number {
    super.setUTCDate(date);
    return this.#resyncFromDateState();
  }

  override setMonth(month: number, date?: number): number {
    if (date === undefined) {
      super.setMonth(month);
    } else {
      super.setMonth(month, date);
    }
    return this.#resyncFromDateState();
  }

  override setUTCMonth(month: number, date?: number): number {
    if (date === undefined) {
      super.setUTCMonth(month);
    } else {
      super.setUTCMonth(month, date);
    }
    return this.#resyncFromDateState();
  }

  override setFullYear(
    year: number,
    month?: number,
    date?: number,
  ): number {
    if (month === undefined) {
      super.setFullYear(year);
    } else if (date === undefined) {
      super.setFullYear(year, month);
    } else {
      super.setFullYear(year, month, date);
    }
    return this.#resyncFromDateState();
  }

  override setUTCFullYear(
    year: number,
    month?: number,
    date?: number,
  ): number {
    if (month === undefined) {
      super.setUTCFullYear(year);
    } else if (date === undefined) {
      super.setUTCFullYear(year, month);
    } else {
      super.setUTCFullYear(year, month, date);
    }
    return this.#resyncFromDateState();
  }

  /**
   * @deprecated This method is deprecated and should not be used. Use setFullYear() instead.
   */
  // @ts-ignore
  override setYear(year: number): number {
    // @ts-ignore
    super.setYear(year);
    return this.#resyncFromDateState();
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    const iso = (() => {
      try {
        return this.toISOString();
      } catch {
        return "Invalid Date";
      }
    })();

    return `PlistDate(${iso}, plistSeconds=${this.getPlistSecondsString()}, raw=${this.getRawHex()})`;
  }
}
