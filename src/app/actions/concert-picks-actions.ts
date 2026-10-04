'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { fetchLatestConcertPicks } from '@/lib/concert-picks-cds';
import { currentStaffRole } from '@/lib/staff-guard';
import { importConcertPicks, type ImportResult } from '@/queries/concert-picks-import';

export interface ConcertPicksState {
  ok: boolean;
  message: string;
  title?: string;
  result?: ImportResult;
  imported?: boolean;
}

/** Preview (dry run, writes nothing) or import this week's MKE Concert Picks from CDS. */
async function run(dryRun: boolean): Promise<ConcertPicksState> {
  if (!(await currentStaffRole())) return { ok: false, message: 'Not authorized.' };
  const token = process.env.NPR_CDS_TOKEN;
  if (!token) return { ok: false, message: 'The CDS key is not set up yet (NPR_CDS_TOKEN).' };
  try {
    const article = await fetchLatestConcertPicks(fetch, token);
    if (!article) return { ok: true, message: 'No recent MKE Concert Picks article in CDS.' };
    const result = await importConcertPicks(db, article, { dryRun });
    if (!dryRun) revalidatePath('/admin/picks');
    return {
      ok: true, title: article.title, result, imported: !dryRun,
      message: dryRun
        ? `${result.matched.length} shows match the event guide; ${result.unmatched.length} don't. Nothing written yet.`
        : `Imported ${result.written} new picks (${result.matched.length} matched).`,
    };
  } catch (error) {
    console.error('concert picks import failed', error);
    return { ok: false, message: "Couldn't read Concert Picks from CDS right now. Try again in a minute." };
  }
}

export async function previewConcertPicksAction(): Promise<ConcertPicksState> {
  return run(true);
}

export async function importConcertPicksAction(): Promise<ConcertPicksState> {
  return run(false);
}
