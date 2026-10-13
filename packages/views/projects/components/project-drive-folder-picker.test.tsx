// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/projects/mutations", () => ({
  useUpdateProject: () => ({ mutateAsync, isPending: false }),
}));

import { ProjectDriveFolderPicker } from "./project-drive-folder-picker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function project(overrides: Partial<Project> = {}): Project {
  return { id: "project-1", drive_folder_id: null, drive_folder_url: null, ...overrides } as Project;
}

describe("ProjectDriveFolderPicker", () => {
  it("saves a pasted folder link", async () => {
    mutateAsync.mockResolvedValue({});
    renderWithI18n(<ProjectDriveFolderPicker project={project()} />);
    fireEvent.click(screen.getByRole("button", { name: "Link folder" }));
    fireEvent.change(screen.getByLabelText("Google Drive folder link"), {
      target: { value: "https://drive.google.com/drive/folders/1Blum" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: "project-1",
        drive_folder: "https://drive.google.com/drive/folders/1Blum",
      }),
    );
  });

  it("shows why the server rejected the folder", async () => {
    mutateAsync.mockRejectedValue(new Error("The Drive account bot@ikigaia.vn can't access this folder."));
    renderWithI18n(<ProjectDriveFolderPicker project={project()} />);
    fireEvent.click(screen.getByRole("button", { name: "Link folder" }));
    fireEvent.change(screen.getByLabelText("Google Drive folder link"), { target: { value: "1Blum0000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The Drive account bot@ikigaia.vn can't access this folder.")).toBeTruthy();
  });

  it("links to and can unlink a linked folder", async () => {
    mutateAsync.mockResolvedValue({});
    renderWithI18n(
      <ProjectDriveFolderPicker
        project={project({ drive_folder_id: "1Blum", drive_folder_url: "https://drive.google.com/drive/folders/1Blum" })}
      />,
    );
    expect(screen.getByRole("link", { name: "Open in Google Drive" }).getAttribute("href")).toBe(
      "https://drive.google.com/drive/folders/1Blum",
    );
    fireEvent.click(screen.getByRole("button", { name: "Google Drive" }));
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: "project-1", drive_folder: null }));
  });
});
