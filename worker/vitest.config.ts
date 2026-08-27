import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        kvNamespaces: ['JOURNAL'],
        bindings: {
          ALLOWED_ORIGIN: 'http://localhost:5173',
          JOURNAL_TOKENS: JSON.stringify({
            'marina-token-aaaaaaaaaaaaaaaaaaaaaaaa': 'marina-actress',
            'test-token-bb': 'test',
          }),
        },
      },
    }),
  ],
});
