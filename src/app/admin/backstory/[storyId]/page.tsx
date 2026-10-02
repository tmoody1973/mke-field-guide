import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DoNotUseToggle, SpeakerNameForm } from '@/components/admin/backstory-episode-forms';
import { AnnouncerProvider } from '@/components/admin/backstory-announcer';
import { EpisodeAudioProvider } from '@/components/admin/backstory-episode-audio';
import { ReviewKeyboard } from '@/components/admin/backstory-keyboard';
import { PublishPanel } from '@/components/admin/backstory-publish-panel';
import { ReviewItemCard } from '@/components/admin/backstory-review-item';
import { Badge } from '@/components/ui/badge';
import { backstoryQuery, reviewErrorMessage } from '@/lib/backstory';
import { publishPreview, splitForReview, toReviewItems } from '@/lib/backstory-review';
import { episodeSchema, type Episode } from '@/lib/backstory-types';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';

async function loadEpisode(storyId: string): Promise<{ episode: Episode | null } | { error: string }> {
  try {
    return { episode: await backstoryQuery('review:episode', { storyId }, episodeSchema.nullable()) };
  } catch (error) {
    console.error('backstory episode failed', error);
    return { error: reviewErrorMessage(error) };
  }
}

function Header({ story, storyId }: { story: Episode['story']; storyId: string }) {
  return (
    <header className="grid gap-1">
      <Link href="/admin/backstory" className="text-sm underline">&larr; Queue</Link>
      <h1 className="font-head text-3xl text-ink">{story.title}</h1>
      <p className="text-ink-muted">
        {story.showName} · {chicagoDateLabel(new Date(story.publishedAt))} ·{' '}
        <a href={story.permalink ?? story.audioUrl} target="_blank" rel="noreferrer" className="underline">Listen to the episode</a>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{story.reviewStatus === 'approved' ? 'On Alexa' : 'Not on Alexa yet'}</Badge>
        {story.approvedRunId && story.approvedRunId !== story.latestRunId ? (
          <Badge variant="secondary">Re-processed: the published version stays live until you publish this one</Badge>
        ) : null}
        {story.approvedBy ? <span className="text-sm text-ink-muted">published by {story.approvedBy}</span> : null}
        <DoNotUseToggle storyId={storyId} table="stories" id={storyId} doNotUse={story.doNotUse} />
      </div>
    </header>
  );
}

export default async function BackstoryEpisodePage({ params }: { params: Promise<{ storyId: string }> }) {
  await requireStaff('picks');
  const { storyId } = await params;
  if (!/^[a-z0-9]{1,64}$/.test(storyId)) notFound();
  const result = await loadEpisode(storyId);
  if ('error' in result) return <p role="alert" className="text-rm-red">{result.error}</p>;
  if (!result.episode) {
    return (
      <p className="text-ink-muted">
        No extraction for this episode yet. <Link href="/admin/backstory" className="underline">Back to the queue</Link>
      </p>
    );
  }
  const { story, speakers } = result.episode;
  const items = toReviewItems(result.episode);
  const { needsYou, looksRight } = splitForReview(items);
  const summary = story.summary && story.approvedRunId === story.latestRunId ? story.summary : story.proposedSummary;
  const counts = {
    needsYou: needsYou.length,
    kept: items.filter((i) => i.status === 'approved').length,
    removed: items.filter((i) => i.status === 'rejected').length,
    unchecked: looksRight.filter((i) => i.status === 'pending').length,
  };
  const card = (item: (typeof items)[number]) => <ReviewItemCard key={item.key} storyId={storyId} item={item} />;

  return (
    <EpisodeAudioProvider src={story.audioUrl}>
    <AnnouncerProvider>
    <div className="grid gap-8 pb-48">
      <Header story={story} storyId={storyId} />
      <PublishPanel
        storyId={storyId} runId={story.latestRunId} summary={summary} attribution={story.attribution}
        preview={publishPreview(items)} counts={counts} notReady={story.stage === 'extracted'} alreadyLive={story.reviewStatus === 'approved'}
      />
      <ReviewKeyboard />

      <section aria-labelledby="needs-you" className="grid gap-3">
        <h2 id="needs-you" className="font-head text-2xl text-ink">Needs you ({needsYou.length})</h2>
        {needsYou.length === 0 ? <p className="text-ink-muted">Nothing flagged. Skim the rest, then publish.</p> : needsYou.map(card)}
      </section>

      <details open={needsYou.length === 0} className="grid gap-3">
        <summary className="cursor-pointer font-head text-2xl text-ink">Looks right ({looksRight.length})</summary>
        <p className="text-sm text-ink-muted">Everything here is kept when you publish, unless you remove it.</p>
        <div className="grid gap-3">{looksRight.map(card)}</div>
      </details>

      <details className="grid gap-3">
        <summary className="cursor-pointer font-head text-2xl text-ink">Voices ({speakers.length})</summary>
        <p className="text-sm text-ink-muted">Optional. Names label the transcript archive; Alexa doesn&rsquo;t use them.</p>
        <div className="grid gap-4">
          {speakers.map((s) => (
            <SpeakerNameForm key={s.label} storyId={storyId} label={s.label} name={s.name} sample={s.sample} startMs={s.startMs} endMs={s.endMs} />
          ))}
        </div>
      </details>
    </div>
    </AnnouncerProvider>
    </EpisodeAudioProvider>
  );
}
