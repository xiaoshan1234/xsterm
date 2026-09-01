import { describe, expect, it } from "vitest";
import { chunkBytes } from "./usePasteBatcher";

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("chunkBytes", () => {
  it("returns empty array for empty input", () => {
    expect(chunkBytes(new Uint8Array(0), 4)).toEqual([]);
  });

  it("returns a single chunk when input fits", () => {
    const out = chunkBytes(bytes("hello"), 100);
    expect(out.length).toBe(1);
    expect(new TextDecoder().decode(out[0])).toBe("hello");
  });

  it("splits ASCII text at byte boundaries", () => {
    const out = chunkBytes(bytes("abcdefghij"), 3);
    expect(out.map((b) => new TextDecoder().decode(b))).toEqual(["abc", "def", "ghi", "j"]);
  });

  it("does not split a 2-byte UTF-8 character (Latin-1 supplement)", () => {
    // "é" encodes to 0xC3 0xA9 in UTF-8. With chunkSize=1, the ASCII 'a'
    // gets its own chunk; the 2-byte "é" can't fit so it is emitted whole.
    const out = chunkBytes(bytes("aéb"), 1);
    expect(out.map((b) => new TextDecoder().decode(b))).toEqual(["a", "é", "b"]);
  });

  it("does not split a 3-byte UTF-8 character (BMP)", () => {
    // "中" is 0xE4 0xB8 0xAD. With chunkSize=1, "中" is emitted whole.
    const out = chunkBytes(bytes("a中b"), 1);
    expect(out.map((b) => new TextDecoder().decode(b))).toEqual(["a", "中", "b"]);
  });

  it("does not split a 4-byte UTF-8 character (emoji)", () => {
    // "😀" is 0xF0 0x9F 0x98 0x80. chunkSize=1 means each ASCII char is its
    // own chunk; the 4-byte emoji is emitted whole as one oversize chunk.
    const out = chunkBytes(bytes("a😀b"), 1);
    expect(out.map((b) => new TextDecoder().decode(b))).toEqual(["a", "😀", "b"]);
  });

  it("aligns subsequent chunks after a multibyte boundary", () => {
    // Sequence: "中" (3 bytes) + "abc" (3 bytes) = 6 bytes total.
    // chunkSize=4. First chunk should be "中a" (4 bytes), then "bc" (2 bytes).
    const out = chunkBytes(bytes("中abc"), 4);
    expect(out.map((b) => new TextDecoder().decode(b))).toEqual(["中a", "bc"]);
  });

  it("concatenating the chunks round-trips to the original string", () => {
    const original = "The quick brown 狐狸 jumps over the lazy 狗. 😀🎉🚀";
    const out = chunkBytes(bytes(original), 7);
    const joined = out.map((b) => new TextDecoder().decode(b)).join("");
    expect(joined).toBe(original);
  });

  it("throws on non-positive chunk size", () => {
    expect(() => chunkBytes(bytes("x"), 0)).toThrow();
    expect(() => chunkBytes(bytes("x"), -1)).toThrow();
  });

  it("handles a single oversize codepoint (codepoint > chunkSize) by emitting it whole", () => {
    // chunkSize=2 but the emoji is 4 bytes — must still emit, not infinite-loop.
    const out = chunkBytes(bytes("😀"), 2);
    expect(out.length).toBe(1);
    expect(new TextDecoder().decode(out[0])).toBe("😀");
  });
});