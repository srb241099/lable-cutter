# SRB Label Cutter PWA

Standalone Meesho label cropper/sorter.

## Features
- Multiple Meesho PDFs in one batch
- Per-page invoice boundary detection using PDF text positions
- Group/sort by Product (SKU), Courier, COD/Prepaid, or preserve original order
- Before/after packing switch visualization
- Output: 4×6 thermal, A4 two labels, A4 four labels, or crop-only
- Optional "Keep tax invoice"
- Fallback crop-height control for unusual PDFs
- Client-side PDF handling; no upload endpoint
- Installable PWA with service-worker caching

## Hosting
Upload every file in this folder to a GitHub repository root, then enable:
Settings → Pages → Deploy from branch → main → /(root).

## Offline note
The app shell is local. PDF.js and pdf-lib are loaded from public CDNs on the first online visit and are cached by the service worker. After they have loaded once successfully, the installed PWA can reuse those cached libraries offline.

## Print
Use 100% / Actual Size rather than Fit to Page.


## v2 fix
- A4 4-up labels auto-rotate 90° so each label fills its quarter page.
- Invoice-boundary detection no longer uses broad GSTIN/HSN matches that can occur inside a shipping label.
