# Drop the Glitch font here

Put the font file (`.ttf` or `.woff2`) from the FontSpace "Glitch" download
in this folder. Two names work, whichever is easier:

- `Glitch.ttf` (or `Glitch.woff2`)
- `Glitch Demo.ttf` (or `Glitch Demo.woff2`)

The `@font-face` in `src/index.css` already checks all four paths — no code
changes needed. On the next page load, the SOL-ZK wordmark and the h1–h3
headings render in Glitch; until then they fall back to Space Grotesk.

How to get the file from Font Book (macOS):

1. Open Font Book, right-click **Glitch Demo** → **Show in Finder**.
2. Copy the `.ttf` into this folder (rename to `Glitch.ttf` if you like).

License note: Glitch is freeware for personal use. For a commercial launch,
buy the commercial license from the designer (Roman Polishchuk) or keep the
Space Grotesk fallback.
