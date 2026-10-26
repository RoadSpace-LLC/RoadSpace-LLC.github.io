import { defineConfig } from 'astro/config';

// The Pages workflow supplies these for either a root or a project repository.
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || '/',
});
