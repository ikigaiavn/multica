import type { Workspace } from "../types";
import { paths } from "./paths";

/**
 * Where a signed-in user lands when no explicit destination is given:
 *   workspace[0] → /<first.slug>/issues
 *   no workspace → /workspaces/new
 *
 * There is no onboarding: the server adds every user to the company
 * workspace on sign-in, so the empty case is an edge (e.g. the default
 * workspace is not configured).
 */
export function resolvePostAuthDestination(workspaces: Workspace[]): string {
  const first = workspaces[0];
  if (first) {
    return paths.workspace(first.slug).issues();
  }
  return paths.newWorkspace();
}
