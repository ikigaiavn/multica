"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@multica/core/types";
import { api } from "@multica/core/api";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { EmojiPicker } from "@multica/ui/components/common/emoji-picker";
import { Button } from "@multica/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import { AvatarCropDialog } from "../../common/avatar-crop-dialog";
import { useT } from "../../i18n";
import { ProjectIcon } from "./project-icon";

type IconTab = "emoji" | "image";

export interface ProjectIconPickerProps {
  value: Pick<Project, "icon"> & Partial<Pick<Project, "avatar_url">>;
  /** Picking an emoji also drops any image, so the emoji is what shows. */
  onEmojiSelected: (emoji: string) => void | Promise<unknown>;
  onImageUploaded: (url: string) => void | Promise<unknown>;
  onImageRemoved: () => void | Promise<unknown>;
  /** Tooltip / accessible name of the trigger. */
  title: string;
  disabled?: boolean;
}

/**
 * Project icon trigger with an Emoji / Image picker. Images go through the
 * same crop + `/api/upload-file` chain as member and agent avatars; the parent
 * persists the returned URL as the project's `avatar_url`.
 */
export function ProjectIconPicker({
  value,
  onEmojiSelected,
  onImageUploaded,
  onImageRemoved,
  title,
  disabled = false,
}: ProjectIconPickerProps) {
  const { t } = useT("projects");
  const { upload } = useFileUpload(api);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasImage = !!value.avatar_url;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<IconTab>(hasImage ? "image" : "emoji");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setTab(hasImage ? "image" : "emoji");
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t(($) => $.icon_picker.select_image));
      return;
    }
    setOpen(false);
    setPickedFile(file);
  };

  const handleCropped = async (cropped: File) => {
    setBusy(true);
    try {
      const result = await upload(cropped);
      if (!result) return;
      await onImageUploaded(result.link);
      setPickedFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.icon_picker.upload_failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled || busy}
              className="relative cursor-pointer rounded-lg p-1 -ml-1 transition-colors hover:bg-accent/60 disabled:cursor-not-allowed"
              title={title}
              aria-label={title}
            >
              <ProjectIcon project={value} size="lg" />
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </span>
              )}
            </button>
          }
        />
        <PopoverContent align="start" className="w-auto gap-0 p-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as IconTab)} className="gap-0">
            <div className="border-b px-2 py-1">
              <TabsList variant="line" aria-label={title}>
                <TabsTrigger value="emoji">{t(($) => $.icon_picker.emoji_tab)}</TabsTrigger>
                <TabsTrigger value="image">{t(($) => $.icon_picker.image_tab)}</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="emoji">
              <EmojiPicker
                onSelect={(emoji) => {
                  setOpen(false);
                  void onEmojiSelected(emoji);
                }}
              />
            </TabsContent>
            <TabsContent value="image" className="flex w-72 flex-col items-center gap-3 p-4">
              {hasImage && <ProjectIcon project={value} size="lg" className="size-16" />}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus />
                {hasImage
                  ? t(($) => $.icon_picker.replace_image)
                  : t(($) => $.icon_picker.upload_image)}
              </Button>
              {hasImage && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setOpen(false);
                    void onImageRemoved();
                  }}
                >
                  <Trash2 />
                  {t(($) => $.icon_picker.remove_image)}
                </Button>
              )}
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={handlePick}
        data-testid="project-icon-file-input"
      />

      <AvatarCropDialog
        file={pickedFile}
        open={!!pickedFile}
        busy={busy}
        onOpenChange={(next) => {
          if (busy) return;
          if (!next) setPickedFile(null);
        }}
        onCropped={handleCropped}
      />
    </>
  );
}
