import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/digest', '/admin'] },
      // Fetched /events every ~12s around the clock, so the Neon compute never scaled to zero
      // (docs/decisions/001-block-reflectionbot.md). It honors robots.txt within about a day.
      { userAgent: 'Reflectionbot', disallow: '/' },
    ],
    sitemap: ['core', 'events', 'venues', 'taxonomy'].map((id) => `${SITE_URL}/sitemap/${id}.xml`),
  };
}
