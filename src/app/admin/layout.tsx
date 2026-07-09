import type { Metadata } from 'next';
import Link from 'next/link';
import { ClerkProvider, Show, UserButton } from '@clerk/nextjs';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: `${SITE_NAME} — Admin`,
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <div className="min-h-screen bg-cream">
        <header className="flex items-center justify-between border-b-[3px] border-ink px-4 py-3">
          <Link href="/admin" className="font-head text-xl text-ink">
            {SITE_NAME} — Admin
          </Link>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </div>
    </ClerkProvider>
  );
}
