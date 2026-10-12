import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import Svg, { Path } from "react-native-svg";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { useAuthStore } from "@/data/auth-store";
import { useT } from "@/lib/i18n";
import {
  AUTH_CALLBACK_URL,
  buildMobileLoginUrl,
  parseAuthCallbackToken,
} from "@/lib/google-auth";

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim();

function GoogleMark() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </Svg>
  );
}

export default function Login() {
  const { t } = useT("auth");
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (message: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setError(message);
  };

  const onGoogle = async () => {
    if (submitting) return;
    if (!WEB_URL) {
      fail(t("login.web_url_missing"));
      return;
    }
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        buildMobileLoginUrl(WEB_URL),
        AUTH_CALLBACK_URL,
      );
      // Closing the browser is a normal way to back out, not an error.
      if (result.type !== "success") return;
      const token = parseAuthCallbackToken(result.url);
      if (!token) {
        fail(t("login.google_failed"));
        return;
      }
      await loginWithToken(token);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch {
      fail(t("login.google_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center px-6 gap-6">
        <View className="items-center gap-3">
          <MulticaLogo size={32} />
          <View className="gap-1 items-center">
            <Text className="text-2xl font-semibold text-foreground">
              {t("login.title")}
            </Text>
            <Text className="text-sm text-muted-foreground text-center">
              {t("login.subtitle")}
            </Text>
          </View>
        </View>

        <View className="gap-3">
          <Button size="lg" variant="outline" disabled={submitting} onPress={onGoogle}>
            <GoogleMark />
            <Text>{submitting ? t("login.google_pending") : t("login.google")}</Text>
          </Button>
          {error ? (
            <Text className="text-sm text-destructive text-center">{error}</Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
