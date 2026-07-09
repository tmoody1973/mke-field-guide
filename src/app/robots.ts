import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/digest', '/admin'] }],
    sitemap: ['core', 'events', 'venues', 'taxonomy'].map((id) => `${SITE_URL}/sitemap/${id}.xml`),
  };
}
