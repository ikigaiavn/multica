import { splitWorkspacePath } from "@multica/core/paths";

/**
 * The workspace slug the router is currently on, read from the live pathname.
 *
 * The URL is the source of truth for workspace identity on web, so this is
 * what `app/[workspaceSlug]/layout.tsx` compares its own `params` slug against
 * before it writes the platform workspace singleton. `usePathname()` returns
 * one value shared by every mounted instance, which is what lets a stale
 * layout recognise that it is no longer the routed one.
 *
 * Returns null for the root and for anything without a first segment. Global
 * routes (`/login`, `/workspaces/new`) do return their first segment — the
 * caller is a workspace layout that only ever compares against its own slug,
 * and a reserved slug can never equal one.
 *
 * In the implicit workspace mode a slug-less workspace path (`/issues/...`)
 * belongs to the implicit workspace, so its slug is returned.
 */
export function workspaceSlugFromPathname(
  pathname: string | null | undefined,
): string | null {
  if (!pathname) return null;
  const { slug: segment, implicit } = splitWorkspacePath(pathname);
  if (!segment) return null;
  if (implicit) return segment;
  // Route params arrive decoded while the pathname segment stays encoded, so
  // a slug needing escapes would never compare equal without this. A lone `%`
  // throws rather than decoding, so fall back to the raw segment.
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
