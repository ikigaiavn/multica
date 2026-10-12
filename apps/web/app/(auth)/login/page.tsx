"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { sanitizeNextUrl, useAuthStore } from "@multica/core/auth";
import { useConfigStore } from "@multica/core/config";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { resolvePostAuthDestination } from "@multica/core/paths";
import { api } from "@multica/core/api";
import type { Workspace } from "@multica/core/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@multica/ui/components/ui/card";
import { setLoggedInCookie } from "@/features/auth/auth-cookie";
import {
  AppHandoffCard,
  appCallbackUrl,
  parseAppPlatform,
} from "@/features/auth/app-handoff";
import { LoginPage, validateCliCallback } from "@multica/views/auth";
import { useT } from "@multica/views/i18n";

function LoginPageContent() {
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useT("auth");
  const googleClientId = useConfigStore((state) => state.googleClientId);
  const authConfigLoaded = useConfigStore((state) => state.authConfigLoaded);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const searchParams = useSearchParams();

  const cliCallbackRaw = searchParams.get("cli_callback");
  const cliState = searchParams.get("cli_state") || "";
  const platform = searchParams.get("platform");
  // Native apps (Electron desktop, Expo mobile) open this page in a browser
  // and receive the token back through the `multica://auth/callback` deep link.
  const appPlatform = parseAppPlatform(platform);
  const appHandoff = cliCallbackRaw ? null : appPlatform;
  // `next` carries a protected URL the user was originally headed to
  // (e.g. /invite/{id}). With URL-driven workspaces there is no legacy
  // "/issues" default — if `next` is absent we decide after login based on
  // the user's workspace list. Sanitize first so a crafted `?next=https://evil`
  // cannot bounce the user off-origin after a successful login.
  const nextUrl = sanitizeNextUrl(searchParams.get("next"));

  const [appToken, setAppToken] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState("");

  // Latched once auth has been observed settled as logged-out on this page.
  // Any `user` that appears afterwards came from the login form in this
  // session — not from an existing session found on arrival.
  const settledLoggedOutRef = useRef(false);

  // Already authenticated ON ARRIVAL — honor ?next= or fall back to first
  // workspace (or /workspaces/new if the user has none). Skip this entire path
  // when the user arrived to authorize the CLI.
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      settledLoggedOutRef.current = true;
      return;
    }
    if (cliCallbackRaw) return;
    if (appHandoff) {
      // A native app opened the browser for login but the web session is already
      // authenticated — mint a bearer token from the cookie session and hand
      // it off via deep link instead of silently redirecting to the workspace.
      api
        .issueCliToken()
        .then(({ token }) => {
          setAppToken(token);
          window.location.href = appCallbackUrl(token);
        })
        .catch((err) => {
          setHandoffError(
            err instanceof Error
              ? err.message
              : appHandoff === "mobile"
                ? t(($) => $.web.mobile_handoff.prepare_failed)
                : t(($) => $.web.desktop_handoff.prepare_failed),
          );
        });
      return;
    }
    // This effect only serves visitors who arrived already authenticated; a
    // sign-in started here finishes on /auth/callback, which owns its own
    // post-login navigation.
    if (settledLoggedOutRef.current) return;
    if (nextUrl) {
      router.replace(nextUrl);
      return;
    }
    // Fetch instead of reading the cache: on a fresh page load the cache is
    // cold, and `getQueryData() ?? []` would misroute a user who does have
    // workspaces to /workspaces/new. On fetch failure fall back to [] —
    // same destination the cold-cache read produced, rather than trapping
    // the user on the login page.
    void qc
      .ensureQueryData(workspaceListOptions())
      .catch(() => [] as Workspace[])
      .then((list) => router.replace(resolvePostAuthDestination(list)));
  }, [isLoading, user, router, nextUrl, cliCallbackRaw, appHandoff, qc]);

  // Build Google OAuth state: encode platform, next URL, and CLI callback
  // params so the callback can redirect to the right place after login.
  // CLI callback/state must survive the Google OAuth round-trip so the
  // post-login callback page can redirect the JWT back to the CLI's local
  // HTTP listener (critical for headless / WSL2 environments).
  const googleState = [
    appPlatform ? `platform:${appPlatform}` : "",
    nextUrl ? `next:${nextUrl}` : "",
    cliCallbackRaw && validateCliCallback(cliCallbackRaw)
      ? `cli_callback:${encodeURIComponent(cliCallbackRaw)}`
      : "",
    cliState ? `cli_state:${encodeURIComponent(cliState)}` : "",
  ]
    .filter(Boolean)
    .join(",") || undefined;

  // While the app handoff is in progress (or has produced a token/error),
  // render a dedicated screen instead of flashing the login form or redirecting
  // away to a workspace page.
  if (appHandoff && user) {
    if (handoffError) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-display-sm">
                {t(($) => $.web.desktop_handoff.failed_title)}
              </CardTitle>
              <CardDescription>{handoffError}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }
    return <AppHandoffCard platform={appHandoff} token={appToken} />;
  }

  return (
    <LoginPage
      google={
        googleClientId
          ? {
              clientId: googleClientId,
              redirectUri: `${window.location.origin}/auth/callback`,
              state: googleState,
            }
          : undefined
      }
      cliCallback={
        cliCallbackRaw && validateCliCallback(cliCallbackRaw)
          ? { url: cliCallbackRaw, state: cliState }
          : undefined
      }
      googleUnavailable={authConfigLoaded && !googleClientId}
      onTokenObtained={setLoggedInCookie}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
