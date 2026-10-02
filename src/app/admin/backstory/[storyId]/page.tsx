import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BackstoryItemDecision } from '@/components/admin/backstory-item-decision';
import { ApproveEpisodeForm, DoNotUseToggle, LocationForm, NeighborhoodForm, SpeakerNameForm } from '@/components/admin/backstory-episode-forms';
import { Badge } from '@/components/ui/badge';
import { backstoryQuery, reviewErrorMessage } from '@/lib/backstory';
import { episodeSchema, type Episode } from '@/lib/backstory-types';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function Quote({ quote, startMs }: { quote: string; startMs: number }) {
  return (
    <blockquote className="border-l-[3px] border-ink pl-3 text-sm text-ink-muted">
      &ldquo;{quote}&rdquo; <span className="whitespace-nowrap">({clock(startMs)})</span>
    </blockquote>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-head text-2xl text-ink">{title}</h2>
      {children}
    </section>
  );
}

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
        <a href={story.permalink ?? story.audioUrl} target="_blank" rel="noreferrer" className="underline">Listen</a>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{story.reviewStatus}</Badge>
        {story.approvedRunId && story.approvedRunId !== story.latestRunId ? (
          <Badge variant="secondary">a newer run is waiting; the approved one stays live</Badge>
        ) : null}
        {story.approvedBy ? <span className="text-sm text-ink-muted">approved by {story.approvedBy}</span> : null}
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
  if ('error' in result) return <p role="status" className="text-rm-red">{result.error}</p>;
  if (!result.episode) {
    return (
      <p className="text-ink-muted">
        No extraction for this episode yet. <Link href="/admin/backstory" className="underline">Back to the queue</Link>
      </p>
    );
  }
  const { story, speakers, mentions, places, topics, actions } = result.episode;
  const summary = story.summary && story.approvedRunId === story.latestRunId ? story.summary : story.proposedSummary;
  return (
    <div className="grid gap-8">
      <Header story={story} storyId={storyId} />

      <Section title="Speakers">
        {speakers.map((s) => <SpeakerNameForm key={s.label} storyId={storyId} label={s.label} name={s.name} sample={s.sample} audioUrl={story.audioUrl} startMs={s.startMs} endMs={s.endMs} />)}
      </Section>

      <Section title="People, organizations and dishes">
        {mentions.length === 0 ? <p className="text-ink-muted">None.</p> : mentions.map((m) => (
          <div key={m.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink">
              <strong>{m.name}</strong> · {m.entityType}
              {m.subjectConfidence !== null && m.subjectConfidence < 0.5 ? ' · possibly a passing mention' : ''}
            </p>
            <Quote quote={m.quote} startMs={m.startMs} />
            <div className="flex flex-wrap gap-2">
              <BackstoryItemDecision storyId={storyId} table="mentions" id={m.id} status={m.reviewStatus} />
              <DoNotUseToggle storyId={storyId} table="mentions" id={m.id} doNotUse={m.doNotUse} />
            </div>
            {m.entityType === 'organization' || m.entityType === 'event' ? (
              <LocationForm storyId={storyId} mentionId={m.id} category="venue" hasPin={places.some((p) => p.mentionId === m.id)} />
            ) : null}
          </div>
        ))}
      </Section>

      <Section title="Places (uncertain map pins first)">
        {places.length === 0 ? <p className="text-ink-muted">None.</p> : places.map((p) => (
          <div key={p.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink">
              <strong>{p.officialName ?? p.name}</strong> · {p.category}
              {p.geocodeConfidence === null ? ' · no map pin' : ` · pin confidence ${Math.round(p.geocodeConfidence * 100)}%`}
            </p>
            {p.geocodeLabel ? <p className="text-sm text-ink-muted">Matched: {p.geocodeLabel}</p> : null}
            <Quote quote={p.quote} startMs={p.startMs} />
            <div className="flex flex-wrap gap-2">
              <BackstoryItemDecision storyId={storyId} table="places" id={p.id} status={p.reviewStatus} />
              <NeighborhoodForm storyId={storyId} placeId={p.id} neighborhood={p.neighborhood} />
            </div>
            <LocationForm storyId={storyId} mentionId={p.mentionId} category={p.category} hasPin={p.geocodeLabel !== null} />
          </div>
        ))}
      </Section>

      <Section title="Topics">
        {topics.map((t) => (
          <div key={t.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink"><strong>{t.topic}</strong> · {Math.round(t.confidence * 100)}%</p>
            <Quote quote={t.quote} startMs={t.startMs} />
            <BackstoryItemDecision storyId={storyId} table="storyTopics" id={t.id} status={t.reviewStatus} />
          </div>
        ))}
      </Section>

      <Section title="Actions">
        {actions.map((a) => (
          <div key={a.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink"><strong>{a.label}</strong> · {a.kind}{a.place ? ` · ${a.place}` : ''}</p>
            <Quote quote={a.quote} startMs={a.startMs} />
            <BackstoryItemDecision storyId={storyId} table="storyActions" id={a.id} status={a.reviewStatus} />
          </div>
        ))}
      </Section>

      <Section title="Summary and approval">
        <ApproveEpisodeForm storyId={storyId} runId={story.latestRunId} defaultSummary={summary} alreadyLive={story.reviewStatus === 'approved'} notReady={story.stage === 'extracted'} />
      </Section>
    </div>
  );
}
