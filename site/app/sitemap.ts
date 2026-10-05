import type { MetadataRoute } from "next";
import { patterns } from "@/lib/patterns";
import { reports } from "@/lib/reports";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://inclusive-ai.vercel.app";

  const staticPages = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 1.0 },
    { url: `${baseUrl}/patterns`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.9 },
    { url: `${baseUrl}/checklist`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.8 },
    { url: `${baseUrl}/registry`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.7 },
    { url: `${baseUrl}/research`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.9 },
    { url: `${baseUrl}/tools`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.8 },
    { url: `${baseUrl}/lab`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.8 },
  ];

  const patternPages = patterns.map((p) => ({
    url: `${baseUrl}/patterns/${p.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const reportPages = reports.map((r) => ({
    url: `${baseUrl}/research/${r.slug}`,
    lastModified: new Date(r.date),
    changeFrequency: "yearly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...patternPages, ...reportPages];
}
