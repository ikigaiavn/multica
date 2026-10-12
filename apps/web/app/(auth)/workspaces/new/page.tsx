"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { paths, resolvePostAuthDestination } from "@multica/core/paths";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { CreateWorkspacePage } from "@multica/views/workspace/create-workspace-page";

export default function Page() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const { data: wsList = [] } = useQuery({
    ...workspaceListOptions(),
    enabled: !!user,
  });

  useEffect(() => {
    if (!isLoading && !user) router.replace(paths.login());
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  // Back is only offered when there is a workspace to return to.
  const onCancel =
    wsList.length > 0
      ? () => router.push(resolvePostAuthDestination(wsList))
      : undefined;

  return (
    <CreateWorkspacePage
      onCancel={onCancel}
      onCreated={(ws) => router.push(paths.workspace(ws.slug).issues())}
    />
  );
}
