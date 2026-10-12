// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildMobileLoginUrl,
  isAuthCallbackUrl,
  parseAuthCallbackToken,
} from "./google-auth";

describe("buildMobileLoginUrl", () => {
  it("targets the web login page in mobile handoff mode", () => {
    expect(buildMobileLoginUrl("https://multica.ai")).toBe(
      "https://multica.ai/login?platform=mobile",
    );
    expect(buildMobileLoginUrl("https://multica.ai//")).toBe(
      "https://multica.ai/login?platform=mobile",
    );
  });
});

describe("isAuthCallbackUrl", () => {
  it.each([
    "multica://auth/callback?token=abc",
    "multica://auth/callback",
    "/auth/callback?token=abc",
    "auth/callback",
  ])("matches %s", (url) => {
    expect(isAuthCallbackUrl(url)).toBe(true);
  });

  it.each([
    "multica://auth/callbacks",
    "/acme/inbox",
    "multica://acme/auth/callback",
    "https://multica.ai/auth/callback-x",
  ])("ignores %s", (url) => {
    expect(isAuthCallbackUrl(url)).toBe(false);
  });
});

describe("parseAuthCallbackToken", () => {
  it("returns the decoded token", () => {
    expect(
      parseAuthCallbackToken("multica://auth/callback?token=a.b%2Bc&x=1"),
    ).toBe("a.b+c");
    expect(parseAuthCallbackToken("multica://auth/callback?x=1&token=t#frag")).toBe("t");
  });

  it("returns null when the token is missing, empty, or malformed", () => {
    expect(parseAuthCallbackToken("multica://auth/callback")).toBeNull();
    expect(parseAuthCallbackToken("multica://auth/callback?token=")).toBeNull();
    expect(parseAuthCallbackToken("multica://auth/callback?tokens=x")).toBeNull();
    expect(parseAuthCallbackToken("multica://auth/callback?token=%E0%A4%A")).toBeNull();
  });

  it("ignores tokens on other URLs", () => {
    expect(parseAuthCallbackToken("multica://acme/inbox?token=x")).toBeNull();
  });
});
