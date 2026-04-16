# PDF Editor

Browser-based PDF editor built with React, TypeScript, Vite, pdf.js, and pdf-lib.

It loads PDF files directly in the browser, renders form widgets and detected text overlays, and lets you add simple graphic elements such as shapes and images.

## Features

- Open PDF files locally in the browser
- Render PDF pages with pdf.js
- Edit detected PDF form fields
- Click detected text blocks to edit them in the UI
- Add rectangle and ellipse overlays
- Upload and place PNG/JPG images on top of a PDF page
- Move and resize graphic overlays
- Export a modified PDF with form values, shapes, and images applied

## Current limitations

- Free-text overlay edits are currently editable in the UI, but they are not yet written back into the exported PDF file
- Text detection is heuristic-based and may still need tuning for some document layouts
- Shape and image overlays are page-based and do not currently support rotation or layer ordering

## Tech stack

- React 19
- TypeScript
- Vite
- pdfjs-dist
- pdf-lib
- ESLint

## Getting started

### Prerequisites

- Node.js 20+
- npm 10+

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Run lint checks

```bash
npm run lint
```

## Project structure

```text
src/
  components/
    PdfPage.tsx      # Page rendering, overlays, interaction logic
  types/
    graphics.ts      # Shared shape/image overlay types
  App.tsx            # Application state and toolbar actions
  App.css            # App-specific styling
  index.css          # Global styling
```

## GitHub Actions

The repository includes a CI workflow that runs on pushes and pull requests to `main`:

- `npm ci`
- `npm run lint`
- `npm run build`

## Roadmap ideas

- Write free-text overlay edits back into exported PDFs
- Add delete/lock controls for text overlays
- Add rotation and layer ordering for graphics
- Improve text segmentation for more PDF layouts

## License

No license file is currently included in this repository.
