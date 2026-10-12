// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  setApiToken: vi.fn(),
  setToken: vi.fn(async () => {}),
  invalidateSessionEpoch: vi.fn(),
}));

vi.mock("./api", () => ({
  api: { getMe: mocks.getMe, setToken: mocks.setApiToken },
  ApiError: class ApiError extends Error {},
}));
vi.mock("./secure-storage", () => ({
  getToken: vi.fn(async () => null),
  setToken: mocks.setToken,
  clearToken: vi.fn(async () => {}),
}));
vi.mock("./session-epoch", () => ({
  invalidateSessionEpoch: mocks.invalidateSessionEpoch,
}));
vi.mock("./workspace-store", () => ({
  useWorkspaceStore: { getState: () => ({ restoreSlug: async () => {} }) },
}));

import { useAuthStore } from "./auth-store";

const user = { id: "u1", email: "a@example.com" };

describe("loginWithToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("persists the token only after /api/me accepts it", async () => {
    mocks.getMe.mockResolvedValueOnce(user);

    await expect(useAuthStore.getState().loginWithToken("jwt")).resolves.toBe(user);

    expect(mocks.invalidateSessionEpoch).toHaveBeenCalledOnce();
    expect(mocks.setApiToken).toHaveBeenCalledWith("jwt");
    expect(mocks.setToken).toHaveBeenCalledWith("jwt");
    expect(useAuthStore.getState().user).toBe(user);
  });

  it("drops the token and rethrows when /api/me rejects it", async () => {
    const err = new Error("unauthorized");
    mocks.getMe.mockRejectedValueOnce(err);

    await expect(useAuthStore.getState().loginWithToken("bad")).rejects.toBe(err);

    expect(mocks.setApiToken).toHaveBeenLastCalledWith(null);
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
