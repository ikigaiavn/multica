/**
 * Google sign-in handoff. Mobile has no Google OAuth client of its own: it
 * opens the web login page with `platform=mobile` in an auth session, the web
 * app runs the Google round-trip (same client as web/desktop), and then
 * redirects to `multica://auth/callback?token=<JWT>`.
 *
 * The scheme is fixed (`scheme` in app.config.ts) and the web side hardcodes
 * the same URL, so this does not use `Linking.createURL`, which would yield an
 * `exp://` URL inside Expo Go / dev clients.
 */
export const AUTH_CALLBACK_URL = "multica://auth/callback";

export function buildMobileLoginUrl(webUrl: string): string {
  return `${webUrl.replace(/\/+$/, "")}/login?platform=mobile`;
}

/** Matches the callback in any form expo-router or the auth session hands us:
 *  `multica://auth/callback?…`, `/auth/callback?…`, or `auth/callback`. */
export function isAuthCallbackUrl(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/?auth\/callback\/?(?:[?#]|$)/i.test(url);
}

/** Extract the `token` query param. Hand-rolled because React Native's URL
 *  polyfill does not reliably parse custom-scheme URLs. */
export function parseAuthCallbackToken(url: string): string | null {
  if (!isAuthCallbackUrl(url)) return null;
  const queryStart = url.indexOf("?");
  if (queryStart < 0) return null;
  const query = url.slice(queryStart + 1).split("#")[0] ?? "";
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (key !== "token") continue;
    try {
      const value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
      return value.trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}
