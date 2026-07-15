# MCPixel brand mark — design

**Date:** 2026-07-14  
**Status:** Approved for implementation planning

## Problem

The topbar brand renders as `MCPIXEL` in Pixelify Sans. The pixel `C` is nearly closed, so the word reads as **MOPIXEL**. The intended reading is **MCP** (Model Context Protocol) + **ixel**.

## Goal

Make the brand unmistakably **MCPixel** (MCP + ixel) without renaming the product or changing the rest of the UI.

## Approach

Custom inline SVG wordmark in the topbar (replacing plain `.brand` text).

### Wordmark composition

- **`MCP`** — uppercase blocky pixel letterforms
- **`ixel`** — lowercase, same pixel style, visually secondary to `MCP`
- The **`C`** must have a clear open gap on the right (not a closed ring)

### Visual constraints

- Fit the existing topbar: same approximate size as current `.brand` (~0.95rem visual height)
- Color: current brand accent (`var(--accent)` / light ink on dark)
- No purple; keep the ink-only palette
- Keep the tagline “Local pixel suite” unchanged beside the mark
- Document `<title>` stays `MCPixel` (no change required)

### Implementation notes

- Markup: replace `<span class="brand">MCPixel</span>` with an accessible SVG (or SVG + visually hidden text) so screen readers still get “MCPixel”
- Style: scoped CSS under `.brand` / `.brand-mark` in `components.css`; no global font swap for other headings
- Prefer a single small SVG wordmark over per-letter spans unless spans are clearer to maintain

## Out of scope

- Renaming the product or package
- Changing Pixelify Sans usage for other headings
- Restyling the yellow CTA, tabs, or tagline
- Favicon / app icon (unless already tied to the same mark; not required here)

## Success criteria

1. At a glance, the first three letters read as **MCP**, not **MOP**
2. Lowercase **ixel** makes the MCP + pixel portmanteau obvious
3. Topbar layout and tagline remain intact
