import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CATEGORIES } from '@/lib/design';
import EventsPage from '../../events/page';

export const dynamic = 'force-dynamic';

function categoryBySlug(slug: string) {
  return CATEGORIES.find((candidate) => candidate.slug === slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const category = categoryBySlug((await params).slug);
  if (!category) return { title: 'Category not found' };
  return {
    title: `${category.label} events in Milwaukee`,
    description: `Every upcoming ${category.label.toLowerCase()} event in Milwaukee, updated daily.`,
    alternates: { canonical: `/categories/${category.slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!categoryBySlug(slug)) notFound();
  return EventsPage({ searchParams: Promise.resolve({ cat: slug }) });
}
