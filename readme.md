# bplist-lossless

> Lossless binary plist parser and serializer for any modern JavaScript runtime.
>
> No `Buffer` dependency. The library uses standard `Uint8Array` / `ArrayBuffer` APIs, so it works in browsers, Bun, Deno, Node.js, workers, and other non-Node runtimes.

`bplist-lossless` is adapted from [bplist-parser](https://github.com/joeferner/node-bplist-parser) and [bplist-creator](https://github.com/joeferner/node-bplist-creator), but rewritten around universal byte arrays instead of Node-specific `Buffer`.

The goal is the same: preserve plist-specific values closely enough that round-tripping stays exact.

```js
import { parseBplist, serializeBplist } from "bplist-lossless";

const source = await fetch("/file.plist");
const input = new Uint8Array(await source.arrayBuffer());

const parsed = parseBplist(input);
const output = serializeBplist(parsed);

console.log(output instanceof Uint8Array);
//=> true
```

## Install

```sh
npm install bplist-lossless
```

## Why This Version Is Universal

- No Node built-ins are required.
- No `Buffer` import or `Buffer` global is required.
- Binary input uses `Uint8Array`, `ArrayBuffer`, or typed-array views.
- Binary output is always `Uint8Array`.
- The same API works in browsers, Bun, Deno, Node.js, service workers, and edge runtimes.

If you happen to pass a Node `Buffer`, it still works because `Buffer` is a `Uint8Array`, but the library itself no longer depends on it.

## Usage

```js
import {
  parseBplist,
  serializeBplist,
  PlistDate,
  UID,
} from "bplist-lossless";

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesEqual(a, b) {
  return (
    a.length === b.length &&
    a.every((byte, index) => byte === b[index])
  );
}

const value = {
  id: UID.fromNumber(42),
  count: 42n,
  name: "Example",
  createdAt: PlistDate.fromUnixMilliseconds(1710000000123),
  payload: Uint8Array.of(0x68, 0x69),
};

const bytes = serializeBplist(value);
const parsed = parseBplist(bytes);

console.log(bytesToHex(bytes.subarray(0, 8)));
//=> 62706c6973743030

console.log(typeof parsed.count, parsed.count);
//=> bigint 42n

console.log(parsed.id instanceof UID, parsed.id.toHex());
//=> true 2a

console.log(parsed.createdAt instanceof PlistDate, parsed.createdAt.getTime());
//=> true 1710000000123

console.log(bytesToHex(parsed.payload));
//=> 6869

console.log(bytesEqual(serializeBplist(parsed), bytes));
//=> true
```

Binary plist UTF-16 strings are preserved as `Utf16String` instead of being flattened into a plain JavaScript string:

```js
import { parseBplist, serializeBplist, Utf16String } from "bplist-lossless";

function bytesEqual(a, b) {
  return (
    a.length === b.length &&
    a.every((byte, index) => byte === b[index])
  );
}

const rawUtf16 = Uint8Array.from([
  0x00, 0x48, 0x00, 0x65, 0x00, 0x6c,
  0x00, 0x6c, 0x00, 0x6f, 0x00, 0x20,
  0x4f, 0x60, 0x59, 0x7d,
]);

const bytes = serializeBplist({
  title: Utf16String.from(rawUtf16),
});

const parsed = parseBplist(bytes);

console.log(parsed.title instanceof Utf16String);
//=> true

console.log(parsed.title.toString());
//=> Hello 你好

console.log(parsed.title.toHex());
//=> 00480065006c006c006f00204f60597d

console.log(bytesEqual(serializeBplist(parsed), bytes));
//=> true
```

## API

### `parseBplist(input)`

Parse a binary plist from:

- `Uint8Array`
- `ArrayBuffer`
- any typed-array view

Returned values use plist-aware types where needed:

- `bigint` for integers
- `number` for reals
- `UID` for plist UIDs
- `Utf16String` for UTF-16 plist strings
- `PlistDate` for plist dates
- `Uint8Array` for data blobs
- arrays and null-prototype objects for containers

### `serializeBplist(value)`

Serialize a supported JavaScript value into a binary plist `Uint8Array`.

Supported input values:

- `null`
- `boolean`
- `bigint`
- `number`
- `string`
- `Utf16String`
- `UID`
- `Date`
- `PlistDate`
- `Uint8Array`
- `ArrayBuffer`
- typed-array views
- arrays
- plain objects

### `PlistDate`

`Date` subclass that keeps the exact 8-byte binary plist payload as the source of truth.

Useful methods:

- `PlistDate.from(value)`
- `PlistDate.fromBytes(bytes)`
- `PlistDate.fromBuffer(bytes)`
- `PlistDate.fromUnixMilliseconds(milliseconds)`
- `date.getRawBytes()`
- `date.toBytes()`
- `date.getPlistSeconds()`

`PlistDate.fromBuffer()` and `date.toBuffer()` are retained as compatibility aliases, but they work with and return `Uint8Array`.

### `UID`

`Uint8Array` subclass for plist UIDs.

Useful methods:

- `UID.from(bytes)`
- `UID.fromNumber(value)`
- `uid.toHex()`
- `UID.isUID(value)`

### `Utf16String`

`Uint8Array` subclass for plist UTF-16 strings.

Useful methods:

- `Utf16String.from(bytes)`
- `value.toString()`
- `value.toHex()`
- `Utf16String.isUtf16String(value)`

## Why This Exists

Most plist libraries map plist values into convenient JavaScript values. That is fine for many use-cases, but it loses information:

- integers become `number`
- UIDs become generic byte arrays
- UTF-16 plist strings become plain JavaScript strings
- plist dates lose their exact stored payload

`bplist-lossless` keeps those distinctions intact so binary plist data can be parsed, modified, and serialized back without accidental normalization.

## License

MIT
