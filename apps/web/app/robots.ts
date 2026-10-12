import type { MetadataRoute } from "next";

// Internal deployment: nothing here is meant for search engines.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
