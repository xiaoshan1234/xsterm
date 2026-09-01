import { describe, expect, it } from "vitest";
import {
  FRAME_MAGIC,
  FRAME_VERSION,
  HEADER_LEN,
  parseSessionOutputFrame,
} from "./sessionOutputFrame";

/**
 * Build a binary frame in memory without going through the Rust encoder,
 * so we can test the JS decoder against hand-crafted edge cases (e.g.
 * wrong magic, wrong version, declared length larger than buffer).
 */
function buildFrame(
  magic: number = FRAME_MAGIC,
  version: number = FRAME_VERSION,
  sessionId: number = 1,
  payload: Uint8Array = new Uint8Array(),
): Uint8Array {
  const buf = new Uint8Array(HEADER_LEN + payload.length);
  buf[0] = magic;
  buf[1] = version;
  const view = new DataView(buf.buffer);
  view.setUint32(2, sessionId, false); // big-endian
  view.setUint32(6, payload.length, false);
  buf.set(payload, HEADER_LEN);
  return buf;
}

describe("parseSessionOutputFrame", () => {
  it("decodes an ASCII payload", () => {
    const payload = new TextEncoder().encode("hello");
    const frame = buildFrame(FRAME_MAGIC, FRAME_VERSION, 42, payload);
    const parsed = parseSessionOutputFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.sessionId).toBe(42);
    expect(parsed!.data).toEqual(payload);
    // Returned data is a *view* into the input buffer — no copy.
    expect(parsed!.data.byteOffset).toBe(HEADER_LEN);
    expect(parsed!.data.byteLength).toBe(payload.length);
  });

  it("decodes an empty payload", () => {
    const frame = buildFrame(FRAME_MAGIC, FRAME_VERSION, 0, new Uint8Array());
    const parsed = parseSessionOutputFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.sessionId).toBe(0);
    expect(parsed!.data.byteLength).toBe(0);
  });

  it("decodes binary bytes (CJK, emoji) byte-exact", () => {
    const payload = new Uint8Array([0xe4, 0xb8, 0xad, 0xef,0xbf, 0xbd]); // "中" + 🎉
    const frame = buildFrame(FRAME_MAGIC, FRAME_VERSION, u32MaxSafe(), payload);
    const parsed = parseSessionOutputFrame(frame);
    expect(parsed!.data).toEqual(payload);
  });

  it("rejects short buffers", () => {
    expect(parseSessionOutputFrame(new Uint8Array(0))).toBeNull();
    expect(parseSessionOutputFrame(new Uint8Array(5))).toBeNull();
    expect(parseSessionOutputFrame(new Uint8Array(HEADER_LEN - 1))).toBeNull();
  });

  it("rejects wrong magic", () => {
    const frame = buildFrame(0xff, FRAME_VERSION, 1, new Uint8Array([0x41]));
    expect(parseSessionOutputFrame(frame)).toBeNull();
  });

  it("rejects wrong version", () => {
    const frame = buildFrame(FRAME_MAGIC, 0x99, 1, new Uint8Array([0x41]));
    expect(parseSessionOutputFrame(frame)).toBeNull();
  });

  it("rejects frames whose declared length exceeds the buffer", () => {
    // Header says 100 bytes of payload, but only 3 follow.
    const buf = new Uint8Array(HEADER_LEN + 3);
    buf[0] = FRAME_MAGIC;
    buf[1] = FRAME_VERSION;
    const view = new DataView(buf.buffer);
    view.setUint32(2, 1, false);
    view.setUint32(6, 100, false);
    expect(parseSessionOutputFrame(buf)).toBeNull();
  });

  it("accepts the largest legal session_id (u32 max safe)", () => {
    const frame = buildFrame(FRAME_MAGIC, FRAME_VERSION, 0xfffffffe, new Uint8Array([0x41]));
    const parsed = parseSessionOutputFrame(frame);
    expect(parsed!.sessionId).toBe(0xfffffffe);
  });

  it("returned data view shares the input buffer (no copy)", () => {
    const payload = new Uint8Array(64);
    const frame = buildFrame(FRAME_MAGIC, FRAME_VERSION, 1, payload);
    const parsed = parseSessionOutputFrame(frame)!;
    // The view points into the original buffer at the right offset.
    expect(parsed.data.buffer).toBe(frame.buffer);
    expect(parsed.data.byteOffset).toBe(HEADER_LEN);
  });
});

function u32MaxSafe(): number {
  return 0xfffffffe;
}