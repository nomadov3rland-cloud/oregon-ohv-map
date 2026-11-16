# Oregon OHV Map — design study

What the good offline map apps do, and what this app steals from them.
Researched Nov 15, 2026. Sources read are cited at the bottom; patterns below
are only the ones that matter for one job: a guy on a quad/dirt bike in the
Oregon woods, no cell signal, gloves on, needs to know *whose land am I on,
can I camp here, which trail is this, and how do I get back to the truck.*

## The four reference apps

**OsmAnd** (OSM-based, fully offline). One downloadable file per region holds
vector map + POIs + routing; rendering styles (Default / Touring / Topo) are
swapped on-device because the map is vector, not pictures. Trip Recording
plugin logs GPX in the background and shows distance/speed/elevation live.
Topography (contours, hillshade, slope) is a separate data layer you toggle.
*Steal:* per-region downloads, vector rendering restyled on-device, a record
button that's always one tap away, terrain as a toggleable layer.

**Gaia GPS** (backcountry catalog app). The product is the *layer stack*:
USGS topos, USFS MVUM, land-ownership overlay, all toggled over one base.
Route builder snaps to trails/roads; tracks record offline and sync later.
*Steal:* layer toggles as the central UI idea; ownership as an overlay, not a
separate map; tap-a-trail info.

**onX Offroad** (OHV-specific). Trails are color-coded open/closed, filterable
by vehicle class (ATV / moto / 4x4), land ownership is color-coded the same
way across the whole US, and offline maps are rectangular areas you save
before you go. Tapping a trail gives name, allowed vehicles, season.
*Steal:* vehicle-class thinking in the trail info card, ownership colors as a
constant language, "save this area" pack model, big simple cards.

**Avenza Maps** (official PDF maps, georeferenced). Dead simple: the real
agency map (MVUM, forest visitor map) with your GPS dot on it. No styling
magic — trust comes from it being the official document.
*Steal:* respect for the official data (our trails ARE the MVUM/ODF data, and
the app says so), and zero-learning-curve UI.

## Patterns adopted

1. **Vector tiles rendered on-device (MapLibre GL + PMTiles).** One archive
   per area, read by byte-range — the app never loads a whole file, it pulls
   only the tiles on screen (the same trick OsmAnd's OBF and the PMTiles PWA
   projects use). Vector means labels stay crisp and upright at every zoom,
   and the style can change without re-downloading data.
2. **Region packs, downloaded once on Wi-Fi, stored on the phone.** Statewide
   overview pack + deep packs for home riding country. Pack list shows size
   and coverage in plain words; storage is the app's problem, not the user's.
3. **Layers, not maps.** Land ownership shading, OHV trails, camping/staging,
   contours/hillshade are toggles over one basemap (Gaia pattern). Defaults:
   land + trails ON — that's the core job.
4. **Ownership colors as a fixed language** (onX pattern, same colors as the
   paper kit): green National Forest and tan BLM = dispersed camping
   generally allowed; blue state; purple National Park; lavender other
   federal; orange tribal; no color = private/closed. Legend lives one tap
   away and in plain English.
5. **Follow-me with heading-up.** Big location dot with a direction cone;
   one big button toggles follow + rotate-to-heading; touching the map pauses
   follow (standard in all four apps) with a "re-center" button to resume.
6. **Breadcrumb recording, always one tap.** Big red record button, live
   distance/time readout, stop → named track saved on the phone, GPX export
   via the Android share sheet (OsmAnd/Gaia pattern). Recording must survive
   the screen going dark — positions come from the Geolocation API watch.
7. **Glove-sized targets.** Minimum ~56px buttons, bottom-sheet info cards
   (thumb reach), no tiny X buttons, no hover anything. Text ≥14px, trail
   labels sized for riding zooms (z13–15).
8. **Tap = plain-language card.** Trail tap: name/number, who manages it,
   what vehicles, season/open dates, length. Camp tap: name, type, fee if
   known. No raw GIS codes anywhere.
9. **Honest routing.** No road/trail routing engine in v1 (that's BRouter-
   class machinery). Route = tap waypoints, straight lines, total miles,
   labeled "straight-line — not trail directions." Better honest than fake.
10. **No account, no server, no expiry.** Everything static files + on-device
    storage (the anti-Gaia-subscription pattern). Maps never "expire."

## Stack decisions

- **MapLibre GL JS** (not Leaflet): true vector rendering, rotation/heading,
  hillshade + 3D-capable terrain from a DEM source, smooth zoom — the things
  the reference apps feel like. Leaflet is raster-first and rotation is a
  hack; rejected.
- **PMTiles archives** for basemap (Protomaps daily-build schema, extracted
  from the free planet build with go-pmtiles), DEM (AWS terrain tiles,
  Terrarium encoding — free, no key), and tiled overlays where GeoJSON would
  be too heavy.
- **PWA + OPFS**: app shell cached by a service worker; packs downloaded by
  the app into the Origin Private File System and read through a custom
  PMTiles `Source` (byte-range reads out of the stored file — the pattern
  proven by offline-PMTiles PWA projects). `navigator.storage.persist()` so
  Android doesn't evict the maps.
- **Hosting**: GitHub Pages (shell + packs ≤100MB each). Files over the Pages
  limit would go to GitHub Release assets; sizes are engineered to avoid
  that if possible.

## Sources read

- Offroad Handbook, "15 Best Off-Road Navigation Apps" (onX/Gaia/OsmAnd
  comparison: color-coded trails, vehicle filters, ownership colors, offline
  storage) — offroadhandbook.com/15-best-off-road-navigation-apps/
- OsmAnd deep-dive (OBF region files, rendering styles, Trip Recording,
  Topography plugin) — vectree.io/pdf/c/osmand
- ClunkTap, "Offline GPS app on mobile phone" (vector vs raster, GPX
  record/export expectations) — clunktap.com/offline-gps-app-on-mobile-phone/
- BigIron, "Offline maps for the field" (PMTiles/Planetiler packs,
  per-region clipping discipline) — bigiron.cc/guides/offline-maps-for-the-field
- free-wheel CLAUDE.md (production PWA: MapLibre + PMTiles in OPFS, custom
  Source byte-range reads, dated Protomaps builds expire) —
  github.com/jw148/free-wheel
- runTiyul offline-packages doc (Terrarium DEM handling, PMTiles v3 + MVT) —
  github.com/nachem/runtiyul

## v2 readability pass (Nov 16, 2026)

Travis's direction: "at a glance I want to look and see whether or not an
area is good for camping, and what part of what forest it is, and the
borders — at least the state border."

- **Camping view** — a toggle that restyles the same PAD-US land layer
  into a three-way read instead of six ownership colors: campable
  (USFS + BLM) in one strong green, check-the-rules (state / other
  federal / NPS / local) in amber, no (tribal) flat gray, private
  uncolored. Own 3-line legend swaps in with it. Same data, alternate
  paint — no second land file in the packs.
- **Forest identity** — new `units.geojson` in the Oregon pack (3.2 MB):
  56 named units (46 tier-1, 10 tier-2). PAD-US parcels grouped by unit
  name, dissolved, outlines simplified. Label points are spread on a
  ~12 km grid across each tier-1 unit (1,530 points) so the forest's name
  is on screen at riding zoom wherever you are in it; MapLibre collision
  thins the repeats at regional zooms, the way printed forest maps
  repeat names. Outlines for tier-1 units from zoom 5.5, tier-2 from 9.
  - State forests come from ODF's own managed-lands service (Oregon
    GEOHub), NOT PAD-US: PAD-US lumps all state forest land into one
    627k-acre "Forest Development Fund" blob. Grouped by ODF district:
    Clatsop 136k ac, Tillamook 364k ac (Tillamook + Forest Grove
    districts), Santiam 47k ac, Gilchrist 72k ac / Sun Pass 21k ac
    (Klamath-Lake district split by latitude). All within ~1% of ODF's
    published sizes.
  - **Known gap: Elliott State Forest is not labeled/outlined.** PAD-US
    mislabels its block and ODF's service doesn't carry a clean Elliott
    boundary. Left out rather than drawn wrong.
  - BLM names cleaned for the map ("Vale Malheur (BLM)", "Lakeview
    District (BLM)") — PAD-US raw names are office bookkeeping strings.
- **Borders** — new `bounds.geojson` (0.13 MB) from the U.S. Census
  Bureau TIGERweb REST service (authoritative, $0): Oregon outline
  rendered as a bold cased line at every zoom; county lines dashed and
  subtle from zoom 7.5. Replaces the basemap's own boundary layers.
- **Label bumps** — place/road/water/trail labels enlarged ~20-40% with
  stronger halos for bright-light reading; land fill opacity raised.
- **Pack versioning fixed** — v1 recorded only that a pack's files
  existed, so a changed pack would have stayed silently stale forever.
  v2 records each file's size and compares against packs.json
  (now version 2): a changed file marks the pack "⬆ Updated version
  available" with an **Update** button that re-downloads only the
  changed files, plus a one-time toast when an update is waiting.
  Service worker bumped to ohv-v2 so installed copies pick up the new
  app shell. For this update, existing Oregon-pack installs download
  only units.geojson + bounds.geojson (~3.3 MB).
- Builders: scripts/build-units.py, scripts/build-bounds.py;
  verification: scripts/cdp-test2.mjs (fresh profile → download →
  tamper a file size to prove the update path → Update → go offline →
  reload → screenshots, all assertions logged, zero console errors).

## v3 pass (Nov 16, 2026)

Travis's three asks, plus one real-phone fix:

- **Small roads stay visible when zoomed out.** Diagnosis first: it was
  the TILE DATA, not the style. Decoding Protomaps tiles around Browns
  Camp showed minor roads and forest tracks are entirely absent below
  zoom 12 (planetiler generalization) — no style can draw missing data.
  Fix: a new `lowroads.pmtiles` in the Oregon pack (19.4 MB; pack grows
  164 → 183 MB), built from the Geofabrik Oregon OSM extract
  (scripts/build-lowroads.py + build-lowroads.sh): secondary/tertiary,
  unclassified/residential, and tracks at zooms 8–11, service roads
  excluded (340k driveways = noise), geometry simplified ~24 m,
  sub-90 m stubs dropped, residential held to z10+. At zoom 12 the
  basemap's own tiles start carrying minor roads, so the app hands off
  there (layers maxzoom 11.99). Proof: the z10 tile over Browns Camp
  went from 0 minor/track roads (basemap) to 4,156 (overlay).
- **Labeled buttons.** The right-side stack is now icon + word chips
  (Follow, Record, Route, Packs), inline SVG icons (no external images,
  offline-safe), 66×64px glove targets.
- **North reset relocated.** It used to be a floating button at a fixed
  offset that covered stack buttons in heading-up mode (Travis hit this
  on his Razr). It now lives inside the stack's flow, last, with extra
  clearance — overlap is structurally impossible.
- **Route builder, real elevation.** Route mode already measured
  straight-line miles; v3 adds climb/descent + high point + an elevation
  profile, sampled from the packs' own Terrarium DEM tiles (z12 region
  / z10 statewide, SRTM via AWS Terrain Tiles) decoded in-app — the
  same data that draws the hillshade. ~60 m resampling, light smoothing,
  2 m hysteresis so SRTM noise doesn't inflate totals. No DEM coverage
  (pack not downloaded, offline) = the bar says elevation is
  unavailable; nothing is faked from contours. Routes now persist
  (localStorage): Done keeps the route on the map with a mileage pill
  to resume, and it survives an app restart. Still honestly labeled
  "straight-line, not trail directions"; no snap-to-trail (that would
  pretend to be a routing engine).
- Service worker ohv-v3, packs.json version 3. Existing installs see
  the Oregon pack as "Partly downloaded" and fetch only the new
  19.4 MB lowroads file. Verification: scripts/cdp-test3.mjs.
