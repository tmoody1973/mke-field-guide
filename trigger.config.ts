// trigger.config.ts
import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
  project: 'proj_huidipgowadfhdfioztw',
  dirs: ['./src/trigger'],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 30_000,
      maxTimeoutInMs: 600_000,
      factor: 3,
      randomize: true,
    },
  },
  maxDuration: 600,
});
