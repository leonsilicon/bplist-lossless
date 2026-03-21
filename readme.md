# bplist-lossless

A library that's adapted from `bplist-creator` and `bplist-parser` to guarantee that `serializeBplist(parseBplist(buf))` will _always_ equal `buf` (verified via `fast-check`).

To achieve this, it makes the following API changes:

- Always uses `bigint` for plist integers (compared to `number` for reals)
- A custom `Uint8Array` subclass for plist UIDs and UTF-16 strings (compared to `Buffer` for data, and `string` for UTF-8 strings)
- A custom `PlistDate` subclass based on `@google-cloud/precise-date` that handles the extra precision in `bplist`.

