import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../locales/en/common.json";
import enAuth from "../locales/en/auth.json";
import enSettings from "../locales/en/settings.json";

const TEST_RESOURCES = {
  en: { common: enCommon, auth: enAuth, settings: enSettings },
};

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

function renderWithI18n(ui: ReactElement) {
  return render(ui, { wrapper: I18nWrapper });
}

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockApiSetToken = vi.hoisted(() => vi.fn());
const mockApiGetMe = vi.hoisted(() => vi.fn());
const mockApiIssueCliToken = vi.hoisted(() => vi.fn());
// Mutable slice of auth state the component subscribes to.
const mockAuthState = vi.hoisted(() => ({ expired: false }));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: Object.assign(
    // Zustand hook form — component may call useAuthStore(selector)
    (selector?: (s: unknown) => unknown) => {
      const state = { expired: mockAuthState.expired };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({ expired: mockAuthState.expired }),
    },
  ),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    setToken: mockApiSetToken,
    getMe: mockApiGetMe,
    issueCliToken: mockApiIssueCliToken,
  },
}));

vi.mock("@multica/core/types", () => ({}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { LoginPage, validateCliCallback } from "./login-page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockAuthState.expired = false;
    // Default: no existing session (getMe rejects when no auth)
    mockApiGetMe.mockRejectedValue(new Error("unauthorized"));
    localStorage.clear();
    // Reset window.location for tests that change it
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "http://localhost:3000" },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Sign-in step
  // -------------------------------------------------------------------------

  const google = { clientId: "goog-123", redirectUri: "http://localhost/cb" };

  it("says the session expired when that is why the user is here", () => {
    mockAuthState.expired = true;
    renderWithI18n(<LoginPage google={google} />);
    expect(screen.getByText(/your session expired/i)).toBeInTheDocument();
  });

  it("stays quiet on an ordinary visit to the login page", () => {
    renderWithI18n(<LoginPage google={google} />);
    expect(screen.queryByText(/your session expired/i)).not.toBeInTheDocument();
  });

  it("offers Google as the only way to sign in", () => {
    renderWithI18n(<LoginPage google={google} />);
    expect(screen.getByText(/sign in to multica/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("sends the browser to Google with the configured client and state", async () => {
    renderWithI18n(<LoginPage google={{ ...google, state: "platform:mobile" }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    const target = new URL(window.location.href);
    expect(target.origin + target.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(target.searchParams.get("client_id")).toBe("goog-123");
    expect(target.searchParams.get("redirect_uri")).toBe("http://localhost/cb");
    expect(target.searchParams.get("state")).toBe("platform:mobile");
  });

  it("lets the platform take over the Google button", async () => {
    const onGoogleLogin = vi.fn();
    renderWithI18n(<LoginPage onGoogleLogin={onGoogleLogin} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(onGoogleLogin).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("http://localhost:3000");
  });

  it("tells the operator when Google is not configured", () => {
    renderWithI18n(<LoginPage googleUnavailable />);
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/GOOGLE_CLIENT_ID/)).toBeInTheDocument();
  });

  it("shows no notice while the server config is still loading", () => {
    renderWithI18n(<LoginPage />);
    expect(screen.queryByText(/GOOGLE_CLIENT_ID/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // CLI callback — existing session
  // -------------------------------------------------------------------------

  it("shows cli_confirm step when existing session + cliCallback", async () => {
    localStorage.setItem("multica_token", "existing-jwt");
    // Cookie attempt fails first, then localStorage fallback succeeds
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });

    renderWithI18n(
      <LoginPage
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/authorize cli/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /authorize/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use a different account/i }),
    ).toBeInTheDocument();
  });

  it("still finds the stored token after the cookie probe's 401 clears it", async () => {
    localStorage.setItem("multica_token", "existing-jwt");
    // The cookie probe 401s, and a 401 ends the session — which wipes the very
    // key the localStorage fallback is about to look for. The component has to
    // have read it before probing, or token-mode users can never authorize a
    // CLI (they land on the email step instead).
    mockApiGetMe
      .mockImplementationOnce(() => {
        localStorage.removeItem("multica_token");
        return Promise.reject(new Error("no cookie"));
      })
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });

    renderWithI18n(
      <LoginPage
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/authorize cli/i)).toBeInTheDocument();
    });
    expect(mockApiSetToken).toHaveBeenCalledWith("existing-jwt");
    expect(localStorage.getItem("multica_token")).toBe("existing-jwt");
  });

  it("CLI authorize button redirects to callback URL", async () => {
    localStorage.setItem("multica_token", "existing-jwt");
    // Cookie attempt fails, localStorage fallback succeeds
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });
    const onTokenObtained = vi.fn();

    renderWithI18n(
      <LoginPage
        onTokenObtained={onTokenObtained}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/authorize cli/i),
      ).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^authorize$/i }));

    expect(onTokenObtained).toHaveBeenCalled();
    expect(window.location.href).toContain(
      "http://localhost:9876/callback?token=existing-jwt&state=abc",
    );
  });

  it("'Use a different account' returns to the sign-in step", async () => {
    localStorage.setItem("multica_token", "existing-jwt");
    // Cookie attempt fails, localStorage fallback succeeds
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });

    renderWithI18n(
      <LoginPage
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/authorize cli/i),
      ).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /use a different account/i }),
    );

    expect(
      screen.getByText(/sign in to multica/i),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // CLI callback — cookie-based session (no localStorage token)
  // -------------------------------------------------------------------------

  it("detects cookie-based session and shows cli_confirm when no localStorage token", async () => {
    // No localStorage token — getMe succeeds via HttpOnly cookie
    mockApiGetMe.mockResolvedValueOnce({
      id: "u-1",
      email: "cookie@example.com",
      name: "Cookie User",
    });

    renderWithI18n(
      <LoginPage
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/authorize cli/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/cookie@example.com/)).toBeInTheDocument();
  });

  it("CLI authorize with cookie session calls issueCliToken and redirects", async () => {
    // No localStorage token — getMe succeeds via cookie
    mockApiGetMe.mockResolvedValueOnce({
      id: "u-1",
      email: "cookie@example.com",
      name: "Cookie User",
    });
    mockApiIssueCliToken.mockResolvedValueOnce({ token: "fresh-jwt" });
    const onTokenObtained = vi.fn();

    renderWithI18n(
      <LoginPage
        onTokenObtained={onTokenObtained}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/authorize cli/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^authorize$/i }));

    await waitFor(() => {
      expect(mockApiIssueCliToken).toHaveBeenCalled();
      expect(onTokenObtained).toHaveBeenCalled();
      expect(window.location.href).toContain(
        "http://localhost:9876/callback?token=fresh-jwt&state=abc",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Logo prop
  // -------------------------------------------------------------------------

  it("renders logo when provided", () => {
    renderWithI18n(
      <LoginPage
        logo={<div data-testid="custom-logo">Logo</div>}
      />,
    );
    expect(screen.getByTestId("custom-logo")).toBeInTheDocument();
  });

});

describe("validateCliCallback", () => {
  it("accepts http://localhost", () => {
    expect(validateCliCallback("http://localhost:9876/callback")).toBe(true);
  });

  it("accepts http://127.0.0.1", () => {
    expect(validateCliCallback("http://127.0.0.1:8080/cb")).toBe(true);
  });

  it("accepts 10.x.x.x private IPs", () => {
    expect(validateCliCallback("http://10.0.0.5:9876/callback")).toBe(true);
    expect(validateCliCallback("http://10.255.255.255:1234/cb")).toBe(true);
  });

  it("accepts 172.16-31.x.x private IPs", () => {
    expect(validateCliCallback("http://172.16.0.1:9876/callback")).toBe(true);
    expect(validateCliCallback("http://172.31.255.255:1234/cb")).toBe(true);
  });

  it("rejects 172.x outside 16-31 range", () => {
    expect(validateCliCallback("http://172.15.0.1:9876/callback")).toBe(false);
    expect(validateCliCallback("http://172.32.0.1:9876/callback")).toBe(false);
  });

  it("accepts 192.168.x.x private IPs", () => {
    expect(validateCliCallback("http://192.168.1.131:41117/callback")).toBe(true);
    expect(validateCliCallback("http://192.168.0.1:8080/cb")).toBe(true);
  });

  it("rejects https:// URLs", () => {
    expect(validateCliCallback("https://localhost:9876/callback")).toBe(false);
  });

  it("rejects public IPs and domains", () => {
    expect(validateCliCallback("http://evil.com:9876/callback")).toBe(false);
    expect(validateCliCallback("http://8.8.8.8:9876/callback")).toBe(false);
    expect(validateCliCallback("http://192.169.1.1:9876/callback")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(validateCliCallback("not-a-url")).toBe(false);
  });
});
