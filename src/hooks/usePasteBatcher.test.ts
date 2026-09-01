import { describe, expect, it } from "vitest";
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  appendToPasteQueue,
  chunkBytes,
  formatPasteForBracketedMode,
} from "./usePasteBatcher";

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

describe("formatPasteForBracketedMode", () => {
  it("normalizes CRLF and LF to CR but does not wrap when mode is off", () => {
    expect(formatPasteForBracketedMode("a\nb\r\nc", false)).toBe("a\rb\rc");
  });

  it("normalizes bare CR (idempotent) when mode is off", () => {
    expect(formatPasteForBracketedMode("a\rb\rc", false)).toBe("a\rb\rc");
  });

  it("wraps with start/end markers when mode is on AND content contains a CR", () => {
    expect(formatPasteForBracketedMode("a\nb", true)).toBe(
      `${BRACKETED_PASTE_START}a\rb${BRACKETED_PASTE_END}`,
    );
  });

  it("normalizes line endings even when wrapping", () => {
    expect(formatPasteForBracketedMode("a\r\nb\nc", true)).toBe(
      `${BRACKETED_PASTE_START}a\rb\rc${BRACKETED_PASTE_END}`,
    );
  });

  it("does NOT wrap when mode is on but content has no CR (no newline)", () => {
    // Mode on but single-line paste — wrap is unnecessary, sending raw is
    // indistinguishable from typed input.
    expect(formatPasteForBracketedMode("abc", true)).toBe("abc");
  });

  it("does NOT wrap when mode is off AND content has a CR (paste proceeds raw)", () => {
    // Mode off: shell/PTY will treat CR as Enter on its own. The dialog's
    // "Convert CRLF/LF to CR" option is the user-facing guard, not this fn.
    expect(formatPasteForBracketedMode("a\nb", false)).toBe("a\rb");
  });

  it("preserves multibyte characters (CJK, emoji) in wrapped output", () => {
    const wrapped = formatPasteForBracketedMode("echo 中\n😀", true);
    expect(wrapped.startsWith(BRACKETED_PASTE_START)).toBe(true);
    expect(wrapped.endsWith(BRACKETED_PASTE_END)).toBe(true);
    expect(wrapped).toContain("中");
    expect(wrapped).toContain("😀");
    expect(wrapped).toContain("\r"); // normalized LF→CR
  });

  it("returns empty string for empty input regardless of mode", () => {
    expect(formatPasteForBracketedMode("", false)).toBe("");
    expect(formatPasteForBracketedMode("", true)).toBe("");
  });
});

describe("appendToPasteQueue", () => {
  it("executes appended ops in append order, even when added in the same tick", async () => {
    const queue = { current: Promise.resolve() as Promise<unknown> };
    const order: number[] = [];

    appendToPasteQueue(queue, async () => {
      order.push(1);
    });
    appendToPasteQueue(queue, async () => {
      order.push(2);
    });
    appendToPasteQueue(queue, async () => {
      order.push(3);
    });

    await queue.current;
    expect(order).toEqual([1, 2, 3]);
  });

  it("serializes async work — each op awaits the previous", async () => {
    const queue = { current: Promise.resolve() as Promise<unknown> };
    const events: string[] = [];

    appendToPasteQueue(queue, async () => {
      events.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      events.push("a-end");
    });
    appendToPasteQueue(queue, async () => {
      events.push("b-start");
      await new Promise((r) => setTimeout(r, 0));
      events.push("b-end");
    });

    await queue.current;
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("isolates a rejection so later ops still run", async () => {
    const queue = { current: Promise.resolve() as Promise<unknown> };
    const ran: string[] = [];

    appendToPasteQueue(queue, async () => {
      ran.push("first");
    });
    appendToPasteQueue(queue, async () => {
      throw new Error("simulated write failure");
    });
    appendToPasteQueue(queue, async () => {
      ran.push("third");
    });

    // Wait long enough for the whole chain to settle; the rejected middle
    // op must not stop the third from running.
    await new Promise((r) => setTimeout(r, 10));
    await queue.current.catch(() => undefined);
    expect(ran).toEqual(["first", "third"]);
  });

  it("appends onto a pre-existing rejection without leaking it", async () => {
    const queue = { current: Promise.reject(new Error("boom")) as Promise<unknown> };
    const ran: string[] = [];

    appendToPasteQueue(queue, async () => {
      ran.push("after-boom");
    });
    await queue.current.catch(() => undefined);
    expect(ran).toEqual(["after-boom"]);
  });
});