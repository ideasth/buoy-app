// Stage 17 — classifyHost() tests
import { describe, it, expect } from "vitest";
import { classifyHost, isRetiredHost } from "../server/hostname-router";

describe("classifyHost", () => {
  it("returns apex for buoy.thinhalo.com", () => {
    expect(classifyHost("buoy.thinhalo.com")).toBe("apex");
  });

  it("returns apex for anchor.thinhalo.com (back-compat)", () => {
    expect(classifyHost("anchor.thinhalo.com")).toBe("apex");
  });

  it("returns null for the retired buoy-family.thinhalo.com, flagged as retired", () => {
    expect(classifyHost("buoy-family.thinhalo.com")).toBeNull();
    expect(isRetiredHost("Buoy-Family.thinhalo.com:443")).toBe(true);
    expect(isRetiredHost("buoy.thinhalo.com")).toBe(false);
  });

  it("returns availability for oliver-availability.thinhalo.com", () => {
    expect(classifyHost("oliver-availability.thinhalo.com")).toBe("availability");
  });

  it("returns apex for localhost (dev fallback)", () => {
    expect(classifyHost("localhost")).toBe("apex");
  });

  it("returns apex for 127.0.0.1 (dev fallback)", () => {
    expect(classifyHost("127.0.0.1")).toBe("apex");
  });

  it("returns apex for *.pplx.app (dev fallback)", () => {
    expect(classifyHost("anchor-jod.pplx.app")).toBe("apex");
  });

  it("returns null for unknown hostname", () => {
    expect(classifyHost("evil.example.com")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(classifyHost(undefined)).toBeNull();
  });

  it("strips port before classifying", () => {
    expect(classifyHost("buoy.thinhalo.com:5000")).toBe("apex");
    expect(classifyHost("oliver-availability.thinhalo.com:443")).toBe("availability");
  });

  it("is case-insensitive", () => {
    expect(classifyHost("BUOY.THINHALO.COM")).toBe("apex");
    expect(classifyHost("Oliver-Availability.thinhalo.com")).toBe("availability");
  });
});
