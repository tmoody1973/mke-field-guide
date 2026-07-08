import type { Metadata } from 'next';
import { db } from '@/db';
import { homeData } from '@/queries/home';
import { Hero, PicksModule, CardModule, StationModule, HoodsModule, NewsletterModule } from '@/app/home-modules';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const data = await homeData(db, new Date());
  return (
    <div>
      <Hero />
      {data.picks.length > 0 && <PicksModule picks={data.picks} />}
      {data.tonight.length > 0 && <CardModule title="Tonight" seeAllHref="/events/tonight" items={data.tonight} live />}
      {data.weekend.length > 0 && <CardModule title="This weekend" seeAllHref="/events/this-weekend" items={data.weekend} />}
      {data.station.length > 0 && <StationModule items={data.station} />}
      <HoodsModule hoods={data.hoods} />
      <NewsletterModule />
    </div>
  );
}
