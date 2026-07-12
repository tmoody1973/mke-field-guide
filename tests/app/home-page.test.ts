import { describe, expect, it, vi } from 'vitest';
import { Suspense, type ReactElement, type ReactNode } from 'react';
import { Hero } from '@/app/home-modules';

// No RTL in this repo (vitest environment is 'node', no jsdom/testing-library
// dependency). `src/app/page.tsx` statically imports `@/db`, which throws at
// module load if DATABASE_URL isn't set — so we stub it rather than pull in a
// real connection. Because JSX only builds a plain element-tree object
// (`React.createElement`), calling the now-sync `HomePage()` never invokes
// the async `HomeModules` body, so this stays a structural/render-shape test:
// it pins the shell shape (Hero outside Suspense, one boundary, async child)
// without touching a database. Full data-level behavior stays covered by
// `tests/queries/home.test.ts`; render-level streaming verification is a
// `npm run build` + e2e concern (see task report).
vi.mock('@/db', () => ({ db: {} }));

type ShellElement = ReactElement<{ children: ReactElement[] }>;

describe('HomePage streaming shell', () => {
  it('is a sync component (does not await data before returning JSX)', async () => {
    const { default: HomePage } = await import('@/app/page');
    expect(HomePage.constructor.name).not.toBe('AsyncFunction');
  });

  it('renders Hero directly in the shell, outside any Suspense boundary', async () => {
    const { default: HomePage } = await import('@/app/page');
    const shell = HomePage() as ShellElement;
    const children = shell.props.children;

    const heroElement = children.find((child) => child.type === Hero);
    expect(heroElement).toBeDefined();
  });

  it('wraps exactly one Suspense boundary around an async HomeModules component', async () => {
    const { default: HomePage } = await import('@/app/page');
    const shell = HomePage() as ShellElement;
    const children = shell.props.children;

    const suspenseElements = children.filter((child) => child.type === Suspense);
    expect(suspenseElements).toHaveLength(1);

    const suspenseElement = suspenseElements[0] as ReactElement<{
      children: ReactElement;
      fallback: ReactNode;
    }>;
    const dataChild = suspenseElement.props.children;
    expect(typeof dataChild.type).toBe('function');
    expect((dataChild.type as { constructor: { name: string } }).constructor.name).toBe('AsyncFunction');
  });

  it('renders a CLS-safe fallback: no visible content, no duplicate h1', async () => {
    const { default: HomePage } = await import('@/app/page');
    const shell = HomePage() as ShellElement;
    const children = shell.props.children;
    const suspenseElement = children.find((child) => child.type === Suspense) as ReactElement<{
      fallback: ReactNode;
    }>;

    // Reserve-nothing-visible: the fallback must not render any element
    // (an h1 in the fallback path would duplicate/shift the hero's h1).
    expect(suspenseElement.props.fallback).toBeFalsy();
  });
});
