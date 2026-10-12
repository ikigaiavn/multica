/**
 * Centralized URL path builder. All navigation in shared packages (packages/views)
 * MUST go through this module — no hardcoded string paths.
 *
 * Two kinds of paths:
 *  - workspace-scoped: paths.workspace(slug).xxx() — carry workspace in URL
 *  - global: paths.login(), paths.newWorkspace(), paths.invite(id) — pre-workspace routes
 *
 * Why pure functions + builder pattern:
 *  - Changing a route shape (e.g. adding workspace slug prefix) becomes a single-file edit
 *  - IDs are always URL-encoded here so callers can't forget
 *  - Zero runtime deps means this module is safe in Node (tests) and browsers
 */

const encode = (id: string) => encodeURIComponent(id);

/**
 * `?focus=` token that scrolls the agent's Instructions tab to its
 * conversation-starters editor and flashes it. Lives here because it is URL
 * vocabulary: `agentConversationStarters()` writes it and the tab reads it,
 * and a shared constant is what stops the two from drifting apart.
 */
export const AGENT_FOCUS_CONVERSATION_STARTERS = "conversation_starters";

/**
 * Route segments that live directly under a workspace (`/{slug}/{segment}`).
 * Every one is a reserved slug, so a path whose first segment is in this set
 * can never start with a workspace slug — that is what lets the implicit
 * workspace mode below drop the slug without ambiguity.
 */
export const WORKSPACE_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  "issues",
  "projects",
  "autopilots",
  "agents",
  "members",
  "squads",
  "inbox",
  "chat",
  "my-issues",
  "runtimes",
  "skills",
  "settings",
  "usage",
  "billing",
  "attachments",
]);

let implicitWorkspaceSlug: string | null = null;

/**
 * Single-workspace deployments (web only) set `implicitWorkspaceSlug` so that
 * workspace's URLs carry no slug: `/issues` instead of `/acme/issues`. Other
 * workspaces keep their `/{slug}/...` prefix. Platforms that never call this
 * (desktop) keep the slugged shape.
 */
export function configurePaths(config: { implicitWorkspaceSlug?: string | null }): void {
  const slug = config.implicitWorkspaceSlug?.trim().toLowerCase();
  implicitWorkspaceSlug = slug ? slug : null;
}

export function getImplicitWorkspaceSlug(): string | null {
  return implicitWorkspaceSlug;
}

export interface WorkspacePathParts {
  /** The workspace slug, or the implicit slug (possibly null when unset) for slug-less paths. */
  slug: string | null;
  /** True when the path carries no slug (`/issues/...`). */
  implicit: boolean;
  /** Segments after the slug: `["issues", "MUL-1"]`. */
  rest: string[];
}

/**
 * Split a workspace path or URL into its slug and route segments, accepting
 * both `/{slug}/issues/...` and the slug-less `/issues/...`. Search and hash
 * suffixes are ignored. Callers must still decide whether the path is global.
 */
export function splitWorkspacePath(path: string): WorkspacePathParts {
  const pathname = path.split(/[?#]/)[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (first !== undefined && WORKSPACE_ROUTE_SEGMENTS.has(first)) {
    return { slug: implicitWorkspaceSlug, implicit: true, rest: segments };
  }
  return { slug: first ?? null, implicit: false, rest: segments.slice(1) };
}

function workspaceScoped(slug: string) {
  const ws =
    implicitWorkspaceSlug !== null && slug.toLowerCase() === implicitWorkspaceSlug
      ? ""
      : `/${encode(slug)}`;
  return {
    root: () => `${ws}/issues`,
    usage: () => `${ws}/usage`,
    issues: () => `${ws}/issues`,
    issueDetail: (id: string) => `${ws}/issues/${encode(id)}`,
    projects: () => `${ws}/projects`,
    projectDetail: (id: string) => `${ws}/projects/${encode(id)}`,
    autopilots: () => `${ws}/autopilots`,
    autopilotDetail: (id: string) => `${ws}/autopilots/${encode(id)}`,
    agents: () => `${ws}/agents`,
    newAgent: () => `${ws}/agents/new`,
    // The two creation methods behind the chooser. Each is a real route so a
    // half-filled form survives a refresh and can be linked to directly.
    newAgentManual: () => `${ws}/agents/new/manual`,
    newAgentAi: () => `${ws}/agents/new/ai`,
    // One creation conversation. It is a durable object, not a step of the
    // route above: it survives leaving the studio and is resumed later, so it
    // owns an address instead of being a query param on the "start one" screen.
    newAgentAiSession: (sessionId: string) =>
      `${ws}/agents/new/ai/${encode(sessionId)}`,
    agentDetail: (id: string) => `${ws}/agents/${encode(id)}`,
    // Deep link behind "customize" in a chat's empty state: the agent's
    // Instructions tab, scrolled to the conversation starters that produced
    // the buttons the viewer just looked at.
    agentConversationStarters: (id: string) =>
      `${ws}/agents/${encode(id)}?view=instructions&focus=${AGENT_FOCUS_CONVERSATION_STARTERS}`,
    memberDetail: (id: string) => `${ws}/members/${encode(id)}`,
    squads: () => `${ws}/squads`,
    squadDetail: (id: string) => `${ws}/squads/${encode(id)}`,
    inbox: () => `${ws}/inbox`,
    chat: () => `${ws}/chat`,
    chatWithAgent: (agentId: string) =>
      `${ws}/chat?agent=${encode(agentId)}`,
    chatSession: (sessionId: string) =>
      `${ws}/chat?session=${encode(sessionId)}`,
    myIssues: () => `${ws}/my-issues`,
    runtimes: () => `${ws}/runtimes`,
    runtimeDetail: (id: string) => `${ws}/runtimes/${encode(id)}`,
    runtimeSettings: (machineId: string, runtimeId: string) =>
      `${ws}/runtimes/${encode(machineId)}/runtime/${encode(runtimeId)}`,
    skills: () => `${ws}/skills`,
    skillDetail: (id: string) => `${ws}/skills/${encode(id)}`,
    settings: () => `${ws}/settings`,
    attachmentPreview: (id: string) => `${ws}/attachments/${encode(id)}/preview`,
  };
}

export const paths = {
  workspace: workspaceScoped,

  // Global (pre-workspace) routes
  login: () => "/login",
  newWorkspace: () => "/workspaces/new",
  invite: (id: string) => `/invite/${encode(id)}`,
  invitations: () => "/invitations",
  authCallback: () => "/auth/callback",
  root: () => "/",
};

export type WorkspacePaths = ReturnType<typeof workspaceScoped>;

// Prefixes — not slug names — because we match against full URL paths.
// A path is global if it equals or begins with any of these.
// Note: `/workspaces/` (trailing slash) is the prefix — `workspaces` is reserved,
// so any path starting with `/workspaces/...` is system-owned, not user-owned.
const GLOBAL_PREFIXES = ["/login", "/workspaces/", "/invite/", "/invitations", "/auth/", "/logout", "/signup"];

export function isGlobalPath(path: string): boolean {
  return GLOBAL_PREFIXES.some((p) => path === p || path.startsWith(p));
}
