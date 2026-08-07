/**
 * Temporary smoke test: verifies harness.ts appFixture + tc lifecycle.
 * Delete after verification.
 */
import { describe, before, after } from "node:test";
import assert from "node:assert";
import { appFixture, tc } from "../lib/harness.ts";

const fixture = appFixture();

describe("harness smoke", () => {
  before(() => fixture.before());
  after(() => fixture.after());

  tc("000", "harness self-check", async (driver) => {
    const title = await driver.getTitle();
    assert.ok(title !== undefined, "driver should have a title");
  });
});
