import { describe, expect, it } from "vitest";
import { formatMoneyParts } from "./money";

describe("formatMoneyParts", () => {
  it("splits a positive amount into major/minor digits", () => {
    expect(formatMoneyParts(550)).toEqual({ sign: "", major: "5", minor: "50" });
  });

  it("zero-pads a single-digit minor amount", () => {
    expect(formatMoneyParts(5)).toEqual({ sign: "", major: "0", minor: "05" });
  });

  it("handles exact major amounts with no remainder", () => {
    expect(formatMoneyParts(200)).toEqual({ sign: "", major: "2", minor: "00" });
  });

  it("marks negative amounts with a sign and formats the absolute value", () => {
    expect(formatMoneyParts(-150)).toEqual({ sign: "-", major: "1", minor: "50" });
  });

  it("handles zero", () => {
    expect(formatMoneyParts(0)).toEqual({ sign: "", major: "0", minor: "00" });
  });
});
