# Oregon OHV Map

A free, offline-first trail map for Oregon OHV riding. Installs on your
phone as a web app (PWA). No account, no subscription, no expiry.

**What it does**
- Offline vector basemap of all Oregon (roads, towns, rivers, labels)
- Public-land ownership shading (National Forest, BLM, state, tribal,
  local) with plain-language dispersed-camping rules
- 4,863 motorized trail segments: USFS MVUM (the legal map), USFS trail
  inventory, and Oregon Dept. of Forestry state-forest OHV trails
- Tap a trail → its ENTIRE route lights up, with vehicle class + season
- 753 campgrounds, staging areas and designated dispersed-camping areas
- Hillshade + contour lines (topo feel), GPS follow-me with heading-up,
  breadcrumb track recording with GPX export, straight-line route measuring

**Offline design**
The app shell is tiny. Map data ships as downloadable region packs
(PMTiles archives) the app fetches once on Wi-Fi and stores on the phone
(OPFS, persistent storage): All of Oregon (161 MB) + North Coast Range
(128 MB) + Mt. Hood (19 MB) + Central Oregon (64 MB) = 372 MB total.

**Stack**: MapLibre GL JS + PMTiles, both vendored (no CDN, no API keys).
Basemap from the Protomaps daily OSM build; elevation from AWS Terrain
Tiles (Terrarium); trails/land from USFS, ODF and USGS PAD-US public data.

Build/design notes and pack-regeneration scripts live in the project
workspace (`~/workspace/ohv-map-app/` — DESIGN-NOTES.md, scripts/).
