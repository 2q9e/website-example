# Rill

Rill is a responsive landing-page concept for a water bottle. A procedural WebGL model follows the scroll-driven product story, and the color picker saves the selection in the browser. The page runs from a static HTTP server.

The 3D preview targets up to 3840 × 2160 backing pixels, with a lower cap on mobile. Its WebGL shader uses GGX-style highlights and a small procedural studio environment map to create glossy, ray-tracing-inspired reflections. These are real-time environment reflections, not hardware ray tracing. The canvas stops rendering while it is idle, hidden, or outside the viewport.

## Run locally

Serve this directory with any static HTTP server that supports JavaScript modules. No package install or build step is required.

## Project files

- `index.html` — page structure and copy
- `styles.css` — visual system and responsive layout
- `ui.js` — navigation, color choices, and local saved state
- `scene.js` — adaptive-resolution WebGL renderer, studio lighting, and scroll interaction
- `models/bottle-model.js` — procedural bottle geometry source
- `rill-mark.svg` — favicon and brand mark
- `_headers` — Cloudflare Pages security headers

Product specifications, pricing, shipping information, and checkout were not supplied, so the page avoids inventing them. The color picker saves only to the visitor's browser; it does not collect or transmit data.
