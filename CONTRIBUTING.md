# Contributing to PIXL.LAB

Thanks for wanting to help!

## Running locally

No tooling required. Open `index.html` in a browser, or run `python3 -m http.server` in the project folder.

## Guidelines

- **Keep it dependency-free.** Plain HTML, CSS and JavaScript, no bundler.
- **Append, don't insert.** Material ids are positional in `DEF` — add new materials at the end of the list so existing saves keep working.
- **Mind the hot loop.** `updatePixel` in `js/engine.js` runs for every cell every frame. Avoid allocations, closures and `Map` lookups inside it.
- **Test on a phone.** The layout has separate rules for desktop, tablet landscape and phone portrait.
- One feature or fix per pull request, with a short description of how to reproduce or try it.

## Ideas

New materials, new reactions, balance tweaks, translations, performance work — all welcome. Open an issue first for anything large.
