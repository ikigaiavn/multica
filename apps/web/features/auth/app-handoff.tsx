"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@multica/ui/components/ui/card";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "@multica/views/i18n";
import { Loader2 } from "lucide-react";

/** Native clients that sign in through the web and receive the token back. */
export type AppPlatform = "desktop" | "mobile";

export function parseAppPlatform(value: string | null | undefined): AppPlatform | null {
  return value === "desktop" || value === "mobile" ? value : null;
}

// Desktop (Electron) and mobile (Expo) both register the `multica` scheme.
export function appCallbackUrl(token: string): string {
  return `multica://auth/callback?token=${encodeURIComponent(token)}`;
}

export function AppHandoffCard({
  platform,
  token,
}: {
  platform: AppPlatform;
  /** Null while the token is still being prepared. */
  token: string | null;
}) {
  const { t } = useT("auth");
  const isMobile = platform === "mobile";
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-display-sm">
            {t(($) => $.web.desktop_handoff.opening_title)}
          </CardTitle>
          <CardDescription>
            {token
              ? isMobile
                ? t(($) => $.web.mobile_handoff.opening_description)
                : t(($) => $.web.desktop_handoff.opening_description)
              : isMobile
                ? t(($) => $.web.mobile_handoff.preparing)
                : t(($) => $.web.desktop_handoff.preparing)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          {token ? (
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = appCallbackUrl(token);
              }}
            >
              {isMobile
                ? t(($) => $.web.mobile_handoff.open_button)
                : t(($) => $.web.desktop_handoff.open_button)}
            </Button>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
