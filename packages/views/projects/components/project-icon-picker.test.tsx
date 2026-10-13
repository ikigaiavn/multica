// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/i18n";

const uploadMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@multica/core/api", () => ({
  api: { getBaseUrl: () => "https://api.test" },
}));

vi.mock("@multica/core/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ upload: uploadMock }),
}));

vi.mock("@multica/ui/components/common/emoji-picker", () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button type="button" onClick={() => onSelect("🎯")}>
      pick emoji
    </button>
  ),
}));

// The cropper needs a real canvas; its behavior is covered by avatar-crop.test.ts.
vi.mock("../../common/avatar-crop-dialog", () => ({
  AvatarCropDialog: ({ open, onCropped }: { open: boolean; onCropped: (file: File) => void }) =>
    open ? (
      <button type="button" onClick={() => onCropped(new File(["x"], "icon.png", { type: "image/png" }))}>
        crop
      </button>
    ) : null,
}));

import { ProjectIcon } from "./project-icon";
import { ProjectIconPicker } from "./project-icon-picker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPicker(value: { icon: string | null; avatar_url?: string | null }) {
  const handlers = {
    onEmojiSelected: vi.fn(),
    onImageUploaded: vi.fn(),
    onImageRemoved: vi.fn(),
  };
  const utils = renderWithI18n(<ProjectIconPicker value={value} title="Change icon" {...handlers} />);
  return { ...utils, ...handlers };
}

describe("ProjectIcon", () => {
  it("prefers the uploaded image over the emoji", () => {
    const { container } = renderWithI18n(
      <ProjectIcon project={{ icon: "🚀", avatar_url: "https://cdn.test/logo.png" }} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/logo.png");
    expect(container.textContent).not.toContain("🚀");
  });

  it("falls back to the emoji when the image fails to load", () => {
    const { container } = renderWithI18n(
      <ProjectIcon project={{ icon: "🚀", avatar_url: "https://cdn.test/broken.png" }} />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("🚀");
  });

  it("resolves a relative upload path against the API origin", () => {
    const { container } = renderWithI18n(
      <ProjectIcon project={{ icon: null, avatar_url: "/api/avatars/sig/workspaces/w/a.png" }} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://api.test/api/avatars/sig/workspaces/w/a.png",
    );
  });

  it("shows the folder when there is neither image nor emoji", () => {
    const { container } = renderWithI18n(<ProjectIcon project={{ icon: null }} />);
    expect(container.textContent).toBe("📁");
  });
});

describe("ProjectIconPicker", () => {
  it("uploads a cropped image and hands back its URL", async () => {
    uploadMock.mockResolvedValue({ link: "https://cdn.test/new.png" });
    const { container, onImageUploaded } = renderPicker({ icon: "🚀" });

    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    expect(screen.getByRole("button", { name: "Upload image" })).toBeTruthy();

    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["x"], "logo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "crop" }));

    await waitFor(() => expect(onImageUploaded).toHaveBeenCalledWith("https://cdn.test/new.png"));
  });

  it("picks an emoji from the emoji tab", () => {
    const { onEmojiSelected } = renderPicker({ icon: null, avatar_url: "https://cdn.test/logo.png" });

    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    fireEvent.click(screen.getByRole("button", { name: "pick emoji" }));

    expect(onEmojiSelected).toHaveBeenCalledWith("🎯");
  });

  it("removes an existing image", () => {
    const { onImageRemoved } = renderPicker({ icon: "🚀", avatar_url: "https://cdn.test/logo.png" });

    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    expect(screen.getByRole("button", { name: "Replace image" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    expect(onImageRemoved).toHaveBeenCalled();
  });
});
