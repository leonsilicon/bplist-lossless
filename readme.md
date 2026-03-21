# bplist-lossless

> Lossless binary plist parser and serializer for Node.js.

`bplist-lossless` is adapted from [bplist-parser](https://github.com/joeferner/node-bplist-parser) and [bplist-creator](https://github.com/joeferner/node-bplist-creator), but with one goal: preserve binary plist values closely enough that round-tripping stays exact.

```js
import { serializeBplist, parseBplist } from 'bplist-lossless'

const buf = fs.readFileSync('./file.plist');
expect(serializeBplist(parseBplist(buf))).toStrictEqual(buf);
//=> true
```

This is useful when you need to inspect or modify a binary plist without collapsing plist-specific values into lossy JavaScript types.

## Install

```sh
npm install bplist-lossless
```

## Usage

```js
import {
	parseBplist,
	serializeBplist,
	PlistDate,
	UID,
} from 'bplist-lossless';

const value = {
	id: UID.from(Buffer.from('2a', 'hex')),
	count: 42n,
	name: 'Example',
	// You can use a regular date if you don't care about microsecond precision
	createdAt: PlistDate.fromUnixMilliseconds(1710000000123),
	payload: Buffer.from('6869', 'hex'),
};

const buffer = serializeBplist(value);
const parsed = parseBplist(buffer);

console.log(buffer.subarray(0, 8).toString('hex'));
//=> 62706c6973743030

console.log(typeof parsed.count, parsed.count);
//=> bigint 42n

console.log(parsed.id instanceof UID, parsed.id.toHex());
//=> true 2a

console.log(parsed.createdAt instanceof PlistDate, parsed.createdAt.getTime());
//=> true 1710000000123

console.log(parsed.payload.toString('hex'));
//=> 6869

console.log(serializeBplist(parsed).equals(buffer));
//=> true
```

Binary plist UTF-16 strings are preserved as `Utf16String` instead of being flattened into a plain JavaScript string:

```js
import {parseBplist, serializeBplist, Utf16String} from 'bplist-lossless';

const rawUtf16 = Buffer.from('00480065006c006c006f00204f60597d', 'hex');
const buffer = serializeBplist({
	title: Utf16String.from(rawUtf16),
});

const parsed = parseBplist(buffer);

console.log(parsed.title instanceof Utf16String);
//=> true

console.log(parsed.title.toString());
//=> Hello 你好

console.log(parsed.title.toHex());
//=> 00480065006c006c006f00204f60597d

console.log(serializeBplist(parsed).equals(buffer));
//=> true
```

## API

### parseBplist(buffer)

Parse a binary plist `Buffer`.

Returned values use plist-aware types where needed:

- `bigint` for integers
- `number` for reals
- `UID` for plist UIDs
- `Utf16String` for UTF-16 plist strings
- `PlistDate` for plist dates
- `Buffer` for data blobs
- Arrays and null-prototype objects for containers

### serializeBplist(value)

Serialize a supported JavaScript value into a binary plist `Buffer`.

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
- `Buffer`
- arrays
- plain objects

### PlistDate

`Date` subclass that keeps the exact 8-byte binary plist payload as the source of truth.

Useful methods:

- `PlistDate.from(value)`
- `PlistDate.fromBuffer(buffer)`
- `PlistDate.fromUnixMilliseconds(milliseconds)`
- `date.getRawBytes()`
- `date.getPlistSeconds()`

### UID

`Uint8Array` subclass for plist UIDs.

Useful methods:

- `UID.from(bytes)`
- `uid.toHex()`
- `UID.isUID(value)`

### Utf16String

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
