"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FolderPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfigStore } from "@multica/core/config";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCreateIssueDriveFolder } from "@multica/core/issues/mutations";
import { projectDetailOptions } from "@multica/core/projects/queries";
import type { Issue } from "@multica/core/types";
import { PropRow } from "../../common/prop-row";
import { useT } from "../../i18n";

const triggerClass =
  "inline-flex min-w-0 items-center gap-1.5 text-caption hover:text-foreground transition-colors disabled:opacity-60";

/**
 * "Drive Folder" row in the issue sidebar. Shows a link once the issue has a
 * folder, a create button when the issue's project links a Drive folder, and
 * nothing otherwise, so workspaces without the integration see no change.
 */
export function IssueDriveFolderRow({ issue }: { issue: Issue }) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const driveEnabled = useConfigStore((s) => s.googleDriveEnabled);
  const createFolder = useCreateIssueDriveFolder();
  const { data: project } = useQuery({
    ...projectDetailOptions(wsId, issue.project_id ?? ""),
    enabled: driveEnabled && !!issue.project_id && !issue.drive_folder_url,
  });

  const label = t(($) => $.detail.prop_drive_folder);

  if (issue.drive_folder_url) {
    return (
      <PropRow label={label}>
        <a
          href={issue.drive_folder_url}
          target="_blank"
          rel="noopener noreferrer"
          className={triggerClass}
        >
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{t(($) => $.detail.drive_folder_open)}</span>
        </a>
      </PropRow>
    );
  }

  if (!driveEnabled || !issue.project_id || !project?.drive_folder_id) return null;

  const handleCreate = () => {
    createFolder.mutate(issue.id, {
      onSuccess: (folder) => {
        window.open(folder.drive_folder_url, "_blank", "noopener,noreferrer");
      },
      onError: (err) => {
        toast.error(err instanceof Error && err.message ? err.message : t(($) => $.detail.drive_folder_failed));
      },
    });
  };

  return (
    <PropRow label={label}>
      <button
        type="button"
        className={triggerClass}
        onClick={handleCreate}
        disabled={createFolder.isPending}
      >
        {createFolder.isPending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">
          {createFolder.isPending
            ? t(($) => $.detail.drive_folder_creating)
            : t(($) => $.detail.drive_folder_create)}
        </span>
      </button>
    </PropRow>
  );
}
