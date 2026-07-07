import { z } from 'zod';
import { eventbriteAdapter } from './eventbrite';
import { htmlAdapter } from './html';
import { icalAdapter } from './ical';
import { ticketmasterAdapter } from './ticketmaster';
import type { SourceAdapter } from './types';

const apiConfigSchema = z.object({ adapter: z.enum(['ticketmaster', 'eventbrite']) });

const apiAdapters: Record<string, SourceAdapter> = {
  ticketmaster: ticketmasterAdapter,
  eventbrite: eventbriteAdapter,
};

export function resolveAdapter(source: {
  adapterType: string;
  config: unknown;
}): SourceAdapter {
  if (source.adapterType === 'ical') return icalAdapter;
  if (source.adapterType === 'html') return htmlAdapter;
  if (source.adapterType === 'api') {
    const { adapter } = apiConfigSchema.parse(source.config);
    return apiAdapters[adapter];
  }
  throw new Error(`No adapter registered for type: ${source.adapterType}`);
}
