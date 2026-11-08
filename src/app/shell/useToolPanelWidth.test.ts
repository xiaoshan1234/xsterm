import { describe, expect, it } from "vitest";
import {
  clampToolPanelWidth,
  DEFAULT_TOOL_PANEL_WIDTH,
  MAX_TOOL_PANEL_WIDTH,
  MIN_TOOL_PANEL_WIDTH,
} from "./useToolPanelWidth";

describe("clampToolPanelWidth", () => {
  it("keeps widths inside the documented bounds", () => {
    expect(clampToolPanelWidth(100)).toBe(MIN_TOOL_PANEL_WIDTH);
    expect(clampToolPanelWidth(260)).toBe(260);
    expect(clampToolPanelWidth(500)).toBe(MAX_TOOL_PANEL_WIDTH);
  });

  it("falls back to the default for invalid values", () => {
    expect(clampToolPanelWidth(Number.NaN)).toBe(DEFAULT_TOOL_PANEL_WIDTH);
  });
});
