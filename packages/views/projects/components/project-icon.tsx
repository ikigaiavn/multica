import { useState } from "react";
import type { Project } from "@multica/core/types";
import { resolvePublicFileUrl } from "@multica/core/workspace/avatar-url";
import { cn } from "@multica/ui/lib/utils";

export type ProjectIconSize = "sm" | "md" | "lg";

export interface ProjectIconProps {
  project?: (Pick<Project, "icon"> & Partial<Pick<Project, "avatar_url">>) | null;
  size?: ProjectIconSize;
  className?: string;
}

const SIZE_CLASS: Record<ProjectIconSize, string> = {
  sm: "size-3.5 text-caption leading-none",
  md: "size-4 text-body leading-none",
  lg: "size-6 text-display-sm leading-none",
};

const IMAGE_RADIUS: Record<ProjectIconSize, string> = {
  sm: "rounded-[3px]",
  md: "rounded-sm",
  lg: "rounded-md",
};

/** An uploaded image wins over the emoji; the emoji (or 📁) is the fallback. */
export function ProjectIcon({ project, size = "sm", className }: ProjectIconProps) {
  // Only touch the API origin when there is an image to resolve.
  const src = project?.avatar_url ? resolvePublicFileUrl(project.avatar_url) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        SIZE_CLASS[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          className={cn("size-full object-cover", IMAGE_RADIUS[size])}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        project?.icon || "📁"
      )}
    </span>
  );
}
