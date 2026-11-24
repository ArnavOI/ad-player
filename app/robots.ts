import type { MetadataRoute } from "next";

// Crawling is allowed so that crawlers see the noindex header; nothing gets indexed.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
