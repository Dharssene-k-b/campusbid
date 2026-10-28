import { describe, expect, it } from "vitest";
import { countdown } from "./format";

describe("auction countdown formatting", () => {
  const now = Date.parse("2026-10-28T00:00:00.000Z");

  it("shows days and a zero-padded live clock for longer auctions", () => {
    expect(countdown("2026-10-29T04:23:17.000Z", now)).toBe("01d 04h 23m 17s");
  });

  it("shows hours, minutes, and seconds for auctions closing within one day", () => {
    expect(countdown("2026-10-28T04:23:17.000Z", now)).toBe("04h 23m 17s");
  });

  it("marks expired auctions as ended", () => {
    expect(countdown("2026-10-27T23:59:59.000Z", now)).toBe("Auction ended");
  });
});
