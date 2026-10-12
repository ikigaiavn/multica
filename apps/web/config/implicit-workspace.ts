// Single-workspace (internal) deployments drop the workspace slug from web
// URLs: `/issues` instead of `/acme/issues`. The server already puts every
// user into DEFAULT_WORKSPACE_SLUG, so the same variable switches the web app
// into that mode. It is read at runtime (proxy + root layout), so one image
// serves any deployment without a rebuild.

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveImplicitWorkspaceSlug(
  env: Record<string, string | undefined>,
): string | null {
  const slug = env.DEFAULT_WORKSPACE_SLUG?.trim().toLowerCase();
  return slug && SLUG_PATTERN.test(slug) ? slug : null;
}
