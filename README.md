# RoadSpace landing page

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

`npm run build` generates the static site in `dist/`. `npm run preview` previews that build.

## Editing

- Landing page: `src/pages/index.astro`
- Shared document and footer: `src/layouts/BaseLayout.astro`
- Navigation: `src/components/Header.astro`
- Article structure: `src/components/Article.astro`
- Dark theme and responsive styles: `src/styles/default.css`

## TODO

- The contact and waitlist links retain the supplied `hello@roadspace.example` placeholder. Replace both before launch. The waitlist currently opens an email draft; it does not collect or store email addresses.