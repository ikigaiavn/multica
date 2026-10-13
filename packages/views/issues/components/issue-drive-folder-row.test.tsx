// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue, Project } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";

const state = vi.hoisted(() => ({
  driveEnabled: true,
  project: undefined as Partial<Project> | undefined,
  mutate: vi.fn(),
  isPending: false,
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.project }),
}));
vi.mock("@multica/core/config", () => ({
  useConfigStore: Object.assign(
    (selector: (s: { googleDriveEnabled: boolean }) => unknown) => selector({ googleDriveEnabled: state.driveEnabled }),
    { getState: () => ({ googleDriveEnabled: state.driveEnabled }) },
  ),
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/projects/queries", () => ({
  projectDetailOptions: (wsId: string, id: string) => ({ queryKey: ["projects", wsId, id] }),
}));
vi.mock("@multica/core/issues/mutations", () => ({
  useCreateIssueDriveFolder: () => ({ mutate: state.mutate, isPending: state.isPending }),
}));

import { IssueDriveFolderRow } from "./issue-drive-folder-row";

function issue(overrides: Partial<Issue> = {}): Issue {
  return { id: "issue-1", project_id: "project-1", ...overrides } as Issue;
}

function renderRow(i: Issue) {
  return renderWithI18n(
    <div className="grid grid-cols-[auto_1fr]">
      <IssueDriveFolderRow issue={i} />
    </div>,
  );
}

beforeEach(() => {
  state.driveEnabled = true;
  state.project = { id: "project-1", drive_folder_id: "1ProjectFolder" };
  state.isPending = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IssueDriveFolderRow", () => {
  it("links to the folder once the issue has one", () => {
    renderRow(issue({ drive_folder_url: "https://drive.google.com/drive/folders/1Issue" }));
    const link = screen.getByRole("link", { name: "Open folder" });
    expect(link.getAttribute("href")).toBe("https://drive.google.com/drive/folders/1Issue");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: "Create folder" })).toBeNull();
  });

  it("creates the folder and opens it", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    state.mutate.mockImplementation((_id: string, opts: { onSuccess: (f: { drive_folder_url: string }) => void }) =>
      opts.onSuccess({ drive_folder_url: "https://drive.google.com/drive/folders/1New" }),
    );
    renderRow(issue());
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(state.mutate).toHaveBeenCalledWith("issue-1", expect.any(Object));
    expect(open).toHaveBeenCalledWith("https://drive.google.com/drive/folders/1New", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("shows the server's message when creation fails", () => {
    state.mutate.mockImplementation((_id: string, opts: { onError: (e: Error) => void }) =>
      opts.onError(new Error("Link a Google Drive folder in the project settings first.")),
    );
    renderRow(issue());
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(toastError).toHaveBeenCalledWith("Link a Google Drive folder in the project settings first.");
  });

  it("disables the button while the folder is being created", () => {
    state.isPending = true;
    renderRow(issue());
    expect((screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ["the integration is off", () => { state.driveEnabled = false; }, issue()],
    ["the issue has no project", () => {}, issue({ project_id: null })],
    ["the project has no folder", () => { state.project = { id: "project-1", drive_folder_id: null }; }, issue()],
  ])("renders nothing when %s", (_name, arrange, i) => {
    arrange();
    const { container } = renderRow(i);
    expect(container.textContent).toBe("");
  });
});
