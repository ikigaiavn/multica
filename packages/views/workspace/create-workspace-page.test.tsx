import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import { configStore } from "@multica/core/config";
import enCommon from "../locales/en/common.json";
import enWorkspace from "../locales/en/workspace.json";

const { createWorkspace, logout } = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({ api: { createWorkspace } }));
vi.mock("../auth", () => ({ useLogout: () => logout }));
vi.mock("../platform", () => ({ DragStrip: () => null }));

import { CreateWorkspacePage } from "./create-workspace-page";

const RESOURCES = { en: { common: enCommon, workspace: enWorkspace } };

function renderPage(props: { onCancel?: () => void } = {}) {
  const onCreated = vi.fn();
  render(
    <I18nProvider locale="en" resources={RESOURCES}>
      <QueryClientProvider client={new QueryClient()}>
        <CreateWorkspacePage onCreated={onCreated} onCancel={props.onCancel} />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { onCreated };
}

describe("CreateWorkspacePage", () => {
  beforeEach(() => {
    createWorkspace.mockReset();
    logout.mockReset();
    configStore.setState({ workspaceCreationDisabled: false });
  });

  it("derives the URL from the name and hands the created workspace back", async () => {
    const ws = { id: "ws-1", slug: "acme-labs", name: "Acme Labs" };
    createWorkspace.mockResolvedValue(ws);
    const { onCreated } = renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Workspace Name"), "Acme Labs");
    expect(screen.getByLabelText("Workspace URL")).toHaveValue("acme-labs");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createWorkspace).toHaveBeenCalledWith({ name: "Acme Labs", slug: "acme-labs" });
    expect(onCreated.mock.calls[0]?.[0]).toEqual(ws);
  });

  it("offers Log out instead of Back when there is nowhere to return to", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the operator notice when workspace creation is disabled", () => {
    configStore.setState({ workspaceCreationDisabled: true });
    renderPage({ onCancel: vi.fn() });
    expect(screen.getByText("Workspace creation is disabled")).toBeInTheDocument();
    expect(screen.queryByLabelText("Workspace Name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
