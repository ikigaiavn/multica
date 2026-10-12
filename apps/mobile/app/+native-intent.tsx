import { isAuthCallbackUrl } from "@/lib/google-auth";

/**
 * The Google sign-in handoff ends at `multica://auth/callback?token=…`. The
 * login screen's auth session consumes that URL (lib/google-auth.ts), but on
 * Android it can also reach the router as an ordinary deep link. Returning
 * null keeps the app on the current screen instead of an unmatched route, and
 * keeps the token out of navigation state.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (isAuthCallbackUrl(path)) return null;
  } catch {
    // Never throw from here: a failure would crash link handling.
  }
  return path;
}
