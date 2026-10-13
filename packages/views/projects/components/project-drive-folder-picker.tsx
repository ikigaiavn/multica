"use client";

import { useState } from "react";
import { ExternalLink, FolderOpen } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover";
import { useUpdateProject } from "@multica/core/projects/mutations";
import type { Project } from "@multica/core/types";
import { useT } from "../../i18n";

/**
 * Links a project to its Google Drive folder (for example 04-Projects/02-Blum).
 * Issue folders are later created under that folder's "Resources" child.
 */
export function ProjectDriveFolderPicker({ project }: { project: Project }) {
  const { t } = useT("projects");
  const updateProject = useUpdateProject();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const linked = project.drive_folder_url;

  const save = async (driveFolder: string | null) => {
    setError(null);
    try {
      await updateProject.mutateAsync({ id: project.id, drive_folder: driveFolder });
      setOpen(false);
      setValue("");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t(($) => $.drive_folder.save_failed));
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 text-caption hover:text-foreground transition-colors"
            >
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <span className={linked ? "truncate" : "truncate text-muted-foreground"}>
                {linked ? t(($) => $.drive_folder.linked) : t(($) => $.drive_folder.link)}
              </span>
            </button>
          }
        />
        <PopoverContent align="start" className="w-80 space-y-2 p-3">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) void save(value.trim());
            }}
          >
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t(($) => $.drive_folder.placeholder)}
              aria-label={t(($) => $.drive_folder.input_label)}
              aria-invalid={error ? true : undefined}
            />
            {error && <p className="text-caption text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              {linked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={updateProject.isPending}
                  onClick={() => void save(null)}
                >
                  {t(($) => $.drive_folder.unlink)}
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!value.trim() || updateProject.isPending}>
                {t(($) => $.drive_folder.save)}
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      {linked && (
        <a
          href={linked}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t(($) => $.drive_folder.open)}
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}
