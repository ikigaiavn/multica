"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { paths, resolvePostAuthDestination } from "@multica/core/paths";
import type { Workspace } from "@multica/core/types";

/**
 * There is no public site: `/` only routes into the app. proxy.ts already
 * redirects logged-out visitors and visitors with a last-workspace cookie, so
 * this page covers the rest — a session without that cookie, or a client-side
 * navigation to `/`.
 */
export default function RootPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(paths.login());
      return;
    }
    // Fetch rather than read the cache: on a fresh load it is cold, and an
    // empty read would misroute a user who has workspaces to /workspaces/new.
    void qc
      .ensureQueryData(workspaceListOptions())
      .catch(() => [] as Workspace[])
      .then((list) => router.replace(resolvePostAuthDestination(list)));
  }, [isLoading, user, router, qc]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
