# GeoGi Logo Migration Map

## GeoGi-MiniProgram

Replace / retire:
- `assets/brand/geogi_logo_mark_dark_*`
- `assets/brand/geogi_logo_dark_*`
- `assets/brand/geogi_logo_core_*`
- `assets/brand/geogi_mark_transparent_*`

Install:
- `assets/brand/geogi-app-icon-*.png`
- `assets/brand/geogi-mark-*.png`
- `assets/brand/geogi-logo-horizontal-navy-1024.png`
- `assets/brand/geogi-logo-horizontal-white-1024.png`
- canonical SVG masters if the consuming surface supports SVG

Update `config/assets.js`:
- `brand.appIcon` -> `/assets/brand/geogi-app-icon-512.png`
- `brand.mark` -> `/assets/brand/geogi-mark-512.png`
- `brand.logo` -> `/assets/brand/geogi-logo-horizontal-navy-1024.png`
- add `brand.logoInverse` -> `/assets/brand/geogi-logo-horizontal-white-1024.png`

PDF:
- dark cover -> horizontal white
- light inner pages -> horizontal navy
- remove manually drawn white logo cards and legacy Chinese/alternate wordmarks

## Official Website

- header / navigation: horizontal navy on light; horizontal white on dark
- favicon / PWA / social avatar: app icon
- footer: appropriate horizontal lockup
- remove old approximate/legacy marks from HTML/CSS/assets

## GeoGi OS

- shell header/sidebar: horizontal navy; inverse on dark shell
- app icon/favicon: app icon
- report templates: same PDF rules
- docs/screenshots/examples: replace legacy logos
- add this package under `assets/brand/` and treat `manifest.json` as authoritative.
