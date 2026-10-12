import { afterEach, describe, it, expect } from "vitest";
import {
  WORKSPACE_ROUTE_SEGMENTS,
  configurePaths,
  getImplicitWorkspaceSlug,
  isGlobalPath,
  paths,
  splitWorkspacePath,
} from "./paths";
import { isReservedSlug } from "./reserved-slugs";

describe("paths.workspace(slug)", () => {
  const ws = paths.workspace("acme");

  it("builds workspace paths with slug prefix", () => {
    expect(ws.usage()).toBe("/acme/usage");
    expect(ws.issues()).toBe("/acme/issues");
    expect(ws.issueDetail("abc-123")).toBe("/acme/issues/abc-123");
    expect(ws.projects()).toBe("/acme/projects");
    expect(ws.projectDetail("p1")).toBe("/acme/projects/p1");
    expect(ws.autopilots()).toBe("/acme/autopilots");
    expect(ws.autopilotDetail("a1")).toBe("/acme/autopilots/a1");
    expect(ws.agents()).toBe("/acme/agents");
    expect(ws.newAgent()).toBe("/acme/agents/new");
    expect(ws.newAgentAi()).toBe("/acme/agents/new/ai");
    expect(ws.newAgentAiSession("sess_1")).toBe("/acme/agents/new/ai/sess_1");
    expect(ws.memberDetail("u1")).toBe("/acme/members/u1");
    expect(ws.inbox()).toBe("/acme/inbox");
    expect(ws.chatWithAgent("agent one")).toBe(
      "/acme/chat?agent=agent%20one",
    );
    expect(ws.chatSession("session one")).toBe(
      "/acme/chat?session=session%20one",
    );
    expect(ws.myIssues()).toBe("/acme/my-issues");
    expect(ws.runtimes()).toBe("/acme/runtimes");
    expect(ws.runtimeSettings("machine/runtime", "runtime one")).toBe(
      "/acme/runtimes/machine%2Fruntime/runtime/runtime%20one",
    );
    expect(ws.skills()).toBe("/acme/skills");
    expect(ws.skillDetail("skl_123")).toBe("/acme/skills/skl_123");
    expect(ws.squads()).toBe("/acme/squads");
    expect(ws.squadDetail("sq_1")).toBe("/acme/squads/sq_1");
    expect(ws.settings()).toBe("/acme/settings");
    expect(ws.attachmentPreview("att_42")).toBe("/acme/attachments/att_42/preview");
  });

  it("URL-encodes special characters in ids", () => {
    expect(ws.issueDetail("id with space")).toBe("/acme/issues/id%20with%20space");
  });
});

describe("paths (global)", () => {
  it("builds global paths without slug", () => {
    expect(paths.login()).toBe("/login");
    expect(paths.newWorkspace()).toBe("/workspaces/new");
    expect(paths.invite("inv-1")).toBe("/invite/inv-1");
    expect(paths.authCallback()).toBe("/auth/callback");
  });
});

describe("isGlobalPath", () => {
  it("returns true for pre-workspace routes", () => {
    expect(isGlobalPath("/login")).toBe(true);
    expect(isGlobalPath("/workspaces/new")).toBe(true);
    expect(isGlobalPath("/invite/abc")).toBe(true);
    expect(isGlobalPath("/auth/callback")).toBe(true);
  });

  it("returns false for workspace-scoped paths", () => {
    expect(isGlobalPath("/acme/issues")).toBe(false);
    expect(isGlobalPath("/")).toBe(false);
  });
});

describe("implicit workspace mode", () => {
  afterEach(() => configurePaths({ implicitWorkspaceSlug: null }));

  it("keeps the slug prefix when unconfigured", () => {
    expect(paths.workspace("acme").issueDetail("MUL-1")).toBe("/acme/issues/MUL-1");
  });

  it("drops the prefix for the implicit workspace only", () => {
    configurePaths({ implicitWorkspaceSlug: "acme" });
    expect(paths.workspace("acme").issues()).toBe("/issues");
    expect(paths.workspace("acme").issueDetail("MUL-1")).toBe("/issues/MUL-1");
    expect(paths.workspace("acme").chatSession("s1")).toBe("/chat?session=s1");
    expect(paths.workspace("other").issues()).toBe("/other/issues");
  });

  it("normalizes the configured slug", () => {
    configurePaths({ implicitWorkspaceSlug: "  Acme " });
    expect(getImplicitWorkspaceSlug()).toBe("acme");
    configurePaths({ implicitWorkspaceSlug: "" });
    expect(getImplicitWorkspaceSlug()).toBeNull();
  });
});

describe("splitWorkspacePath", () => {
  afterEach(() => configurePaths({ implicitWorkspaceSlug: null }));

  it("splits slugged paths", () => {
    expect(splitWorkspacePath("/acme/issues/MUL-1?x=1#h")).toEqual({
      slug: "acme",
      implicit: false,
      rest: ["issues", "MUL-1"],
    });
  });

  it("treats a route segment first as a slug-less path", () => {
    expect(splitWorkspacePath("/issues/MUL-1")).toEqual({
      slug: null,
      implicit: true,
      rest: ["issues", "MUL-1"],
    });
    configurePaths({ implicitWorkspaceSlug: "acme" });
    expect(splitWorkspacePath("/chat").slug).toBe("acme");
  });

  it("handles the root", () => {
    expect(splitWorkspacePath("/")).toEqual({ slug: null, implicit: false, rest: [] });
  });

  it("covers every reserved workspace route segment", () => {
    for (const segment of WORKSPACE_ROUTE_SEGMENTS) {
      expect(isReservedSlug(segment)).toBe(true);
    }
  });
});
