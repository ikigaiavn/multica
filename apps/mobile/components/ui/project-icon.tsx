/**
 * Mobile ProjectIcon — RN port of
 * `packages/views/projects/components/project-icon.tsx`. An uploaded image
 * (`avatar_url`) wins; otherwise the project's emoji icon with a 📁 fallback.
 * Image URLs go through resolveAttachmentUrl like WorkspaceAvatar does.
 *
 * Why a square View wrapper + explicit lineHeight:
 *   Emoji glyphs do not respect the latin-text baseline metrics — on iOS
 *   they render with a visual extent ~10-15% larger than `fontSize`,
 *   centered on the baseline. `<Text>` clips content to `lineHeight`, so a
 *   `lineHeight: font-size` (the previous `leading-none` form) trimmed the
 *   top and bottom of the emoji. Setting `lineHeight = fontSize * 1.2`
 *   gives the glyph enough vertical room; the surrounding View pins a
 *   stable square footprint so flex parents using `items-center` /
 *   `items-start` align siblings against a predictable box instead of the
 *   emoji's drifting baseline.
 */
import { useState } from "react";
import { View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Text } from "@/components/ui/text";
import { resolveAttachmentUrl } from "@/lib/attachment-url";

export type ProjectIconSize = "sm" | "md" | "lg";

const SIZE: Record<ProjectIconSize, { box: number; font: number }> = {
  sm: { box: 18, font: 14 },
  md: { box: 22, font: 16 },
  lg: { box: 28, font: 22 },
};

interface Props {
  icon?: string | null;
  avatarUrl?: string | null;
  size?: ProjectIconSize;
}

export function ProjectIcon({ icon, avatarUrl, size = "sm" }: Props) {
  const { box, font } = SIZE[size];
  const resolved = avatarUrl ? resolveAttachmentUrl(avatarUrl) : null;
  const [failed, setFailed] = useState<string | null>(null);
  if (resolved && failed !== resolved) {
    return (
      <View style={{ width: box, height: box, borderRadius: Math.round(box / 4), overflow: "hidden" }}>
        <ExpoImage
          source={{ uri: resolved }}
          contentFit="cover"
          onError={() => setFailed(resolved)}
          style={{ width: "100%", height: "100%" }}
        />
      </View>
    );
  }
  return (
    <View
      style={{
        width: box,
        height: box,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: font, lineHeight: Math.round(font * 1.2) }}>
        {icon || "📁"}
      </Text>
    </View>
  );
}
