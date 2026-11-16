"use strict";
/* Oregon OHV Map — offline-first PWA.
   Basemap/terrain/overlay data lives in PMTiles archives, either streamed
   from this site (online) or stored on-device in OPFS after download. */

const $ = (id) => document.getElementById(id);
const REGIONS = ["northcoast", "mthood", "central"];
const OREGON_BBOX = [-124.8, 41.9, -116.4, 46.4];

let PACKS = null;               // packs.json content
let localFiles = {};            // fileId -> {size, at} persisted in localStorage
try { localFiles = JSON.parse(localStorage.getItem("ohv.localFiles") || "{}"); } catch (e) { localFiles = {}; }

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ---------------- OPFS ---------------- */
async function packsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("packs", { create: true });
}
async function opfsFile(fileName) {
  try {
    const dir = await packsDir();
    const fh = await dir.getFileHandle(fileName);
    return await fh.getFile();
  } catch (e) { return null; }
}
async function opfsDelete(fileName) {
  try {
    const dir = await packsDir();
    await dir.removeEntry(fileName);
  } catch (e) { /* already gone */ }
}

/* ---------------- pack model ---------------- */
function allFiles() {
  const out = [];
  for (const b of PACKS.bundles) for (const f of b.files) out.push({ bundle: b, file: f });
  return out;
}
function fileById(id) { return allFiles().find((x) => x.file.id === id); }
function isLocal(file) { return !!localFiles[file.id]; }

async function sourceFor(file) {
  // Returns {url, pmtiles} — registers the archive with the protocol.
  if (isLocal(file)) {
    const blob = await opfsFile(file.file);
    if (blob) {
      const p = new pmtiles.PMTiles(new pmtiles.FileSource(blob));
      protocol.add(p);
      return "pmtiles://" + file.file;
    }
  }
  const url = new URL("packs/" + file.file, document.baseURI).href;
  const p = new pmtiles.PMTiles(url);
  protocol.add(p);
  return "pmtiles://" + url;
}

async function campingData() {
  const f = fileById("camping").file;
  if (isLocal(f)) {
    const blob = await opfsFile(f.file);
    if (blob) return JSON.parse(await blob.text());
  }
  const res = await fetch("packs/" + f.file);
  return res.json();
}

let _trailNamesCache = null;
async function trailNamesData() {
  if (_trailNamesCache) return _trailNamesCache;
  const entry = fileById("trailnames");
  if (!entry) return { type: "FeatureCollection", features: [] };
  const f = entry.file;
  if (isLocal(f)) {
    const blob = await opfsFile(f.file);
    if (blob) { _trailNamesCache = JSON.parse(await blob.text()); return _trailNamesCache; }
  }
  const res = await fetch("packs/" + f.file);
  _trailNamesCache = await res.json();
  return _trailNamesCache;
}
function routeTotals(src, grp) {
  if (!_trailNamesCache || !grp) return null;
  let miles = 0, n = 0;
  for (const ft of _trailNamesCache.features) {
    if (ft.properties.src === src && ft.properties.grp === grp) { miles += +ft.properties.miles || 0; n++; }
  }
  return n ? { miles, n } : null;
}

/* ---------------- style builder ---------------- */
const FONT_MED = ["Noto Sans Medium"];
const FONT_REG = ["Noto Sans Regular"];

async function buildStyle() {
  const sources = {};
  const bm = {};   // bundleId -> sourceId for basemaps
  for (const { bundle, file } of allFiles()) {
    if (file.role === "basemap") {
      const sid = "bm-" + bundle.id;
      sources[sid] = { type: "vector", url: await sourceFor(file) };
      bm[bundle.id] = sid;
    } else if (file.role === "dem") {
      sources["dem-" + bundle.id] = {
        type: "raster-dem", url: await sourceFor(file),
        encoding: "terrarium", tileSize: 256, maxzoom: file.maxzoom || 12,
      };
    } else if (file.role === "contours") {
      sources["ct-" + bundle.id] = { type: "vector", url: await sourceFor(file) };
    } else if (file.role === "land") {
      sources.land = { type: "vector", url: await sourceFor(file) };
    } else if (file.role === "trails") {
      sources.trails = { type: "vector", url: await sourceFor(file) };
    }
  }
  sources.camping = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  sources.me = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  sources.track = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  sources.route = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  sources.trailnames = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

  const L = [];
  const push = (l) => L.push(l);
  const state = bm.oregon;

  push({ id: "bg", type: "background", paint: { "background-color": "#ecefe3" } });
  push({ id: "earth", type: "fill", source: state, "source-layer": "earth",
         paint: { "fill-color": "#e9ecdb" } });
  // landcover
  push({ id: "landcover", type: "fill", source: state, "source-layer": "landcover",
         paint: { "fill-color": ["match", ["get", "kind"],
           ["forest", "wood"], "#cfe0b8",
           ["grassland", "meadow"], "#e3e9c4",
           ["scrub", "tundra"], "#dfe3c2",
           "cropland", "#efe8c6",
           "urban_area", "#eae4da",
           ["glacier", "ice"], "#ffffff",
           "wetland", "#cfe0d8",
           ["desert", "bare"], "#e7dcc4",
           "rgba(0,0,0,0)"] } });
  push({ id: "landuse", type: "fill", source: state, "source-layer": "landuse",
         paint: { "fill-color": ["match", ["get", "kind"],
           ["forest", "nature_reserve"], "rgba(160,195,125,0.45)",
           "park", "rgba(170,205,135,0.5)",
           "meadow", "rgba(210,220,170,0.4)",
           "cemetery", "rgba(190,215,165,0.45)",
           "rgba(0,0,0,0)"] } });

  // hillshade: statewide under z12.5, regional detail above
  if (sources["dem-oregon"]) push({ id: "hill-oregon", type: "hillshade", source: "dem-oregon",
    maxzoom: 12.49, paint: { "hillshade-shadow-color": "#4a3f30", "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#5a6e46", "hillshade-exaggeration": 0.32 } });
  for (const r of REGIONS) {
    if (sources["dem-" + r]) push({ id: "hill-" + r, type: "hillshade", source: "dem-" + r,
      minzoom: 12.5, paint: { "hillshade-shadow-color": "#4a3f30", "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#5a6e46", "hillshade-exaggeration": 0.32 } });
  }

  // land ownership shading
  if (sources.land) {
    push({ id: "land-fill", type: "fill", source: "land", "source-layer": "land", minzoom: 5,
      layout: { visibility: layerOn("land") ? "visible" : "none" },
      paint: { "fill-color": ["match", ["get", "cat"],
        "usfs", "rgba(96,176,96,0.34)", "blm", "rgba(240,205,80,0.38)",
        "nps", "rgba(171,127,188,0.34)", "fed", "rgba(158,152,190,0.32)",
        "state", "rgba(100,170,240,0.34)", "tribal", "rgba(245,166,80,0.36)",
        "local", "rgba(178,190,197,0.34)", "rgba(0,0,0,0)"] } });
    push({ id: "land-line", type: "line", source: "land", "source-layer": "land", minzoom: 7,
      layout: { visibility: layerOn("land") ? "visible" : "none" },
      paint: { "line-color": ["match", ["get", "cat"],
        "usfs", "rgba(52,120,52,0.75)", "blm", "rgba(170,135,20,0.75)",
        "nps", "rgba(120,80,140,0.75)", "fed", "rgba(105,98,140,0.7)",
        "state", "rgba(50,110,180,0.75)", "tribal", "rgba(190,115,30,0.75)",
        "local", "rgba(120,130,135,0.7)", "rgba(0,0,0,0)"],
        "line-width": 0.8 } });
  }

  // contours
  const contourPaint = (idx) => idx
    ? { "line-color": "rgba(150,118,70,0.85)", "line-width": 1.1 }
    : { "line-color": "rgba(170,145,100,0.5)", "line-width": 0.6 };
  const addContours = (srcId, idp, minz, maxz) => {
    push({ id: idp + "-minor", type: "line", source: srcId, "source-layer": "contours",
      minzoom: minz, ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["==", ["get", "level"], "minor"],
      layout: { visibility: layerOn("contours") ? "visible" : "none" },
      paint: contourPaint(false) });
    push({ id: idp + "-index", type: "line", source: srcId, "source-layer": "contours",
      minzoom: minz, ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["==", ["get", "level"], "index"],
      layout: { visibility: layerOn("contours") ? "visible" : "none" },
      paint: contourPaint(true) });
    push({ id: idp + "-label", type: "symbol", source: srcId, "source-layer": "contours",
      minzoom: Math.max(minz + 1, 11), ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["==", ["get", "level"], "index"],
      layout: { "symbol-placement": "line", "text-field": ["concat", ["to-string", ["get", "ele"]], " m"],
        "text-font": FONT_REG, "text-size": 10.5, visibility: layerOn("contours") ? "visible" : "none" },
      paint: { "text-color": "#7d6435", "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.2 } });
  };
  if (sources["ct-oregon"]) addContours("ct-oregon", "ct-oregon", 9, 12.49);
  for (const r of REGIONS) if (sources["ct-" + r]) addContours("ct-" + r, "ct-" + r, 12.5, null);

  // water
  push({ id: "water-fill", type: "fill", source: state, "source-layer": "water",
         filter: ["==", ["geometry-type"], "Polygon"],
         paint: { "fill-color": "#a9cde8" } });
  push({ id: "water-line", type: "line", source: state, "source-layer": "water",
         filter: ["==", ["geometry-type"], "LineString"],
         paint: { "line-color": "#8fb8dd",
           "line-width": ["match", ["get", "kind"], "river", 1.8, "canal", 1.1, 0.9] } });

  // boundaries
  push({ id: "bound-county", type: "line", source: state, "source-layer": "boundaries", minzoom: 8,
         filter: ["==", ["get", "kind"], "county"],
         paint: { "line-color": "rgba(110,105,90,0.45)", "line-width": 0.7, "line-dasharray": [3, 2] } });
  push({ id: "bound-state", type: "line", source: state, "source-layer": "boundaries",
         filter: ["==", ["get", "kind"], "state"],
         paint: { "line-color": "rgba(90,85,70,0.7)", "line-width": 1.1, "line-dasharray": [5, 2] } });

  // roads — generated per basemap source
  const roadPaint = {
    motorway: "#e0822a", trunk: "#e8a34c", primary: "#f0bc66",
    secondary: "#f5d189", tertiary: "#f7e3ae",
  };
  function addRoads(srcId, idp, minz, maxz, labelMaxz) {
    const opt = { ...(minz ? { minzoom: minz } : {}), ...(maxz ? { maxzoom: maxz } : {}) };
    // casing
    push({ id: idp + "-rd-case", type: "line", source: srcId, "source-layer": "roads", ...opt,
      filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road", "medium_road", "minor_road"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"],
          6, ["match", ["get", "kind"], "highway", 1.6, "major_road", 1.2, 0.7],
          12, ["match", ["get", "kind"], "highway", 4.4, "major_road", 3.4, "medium_road", 2.6, 1.8],
          16, ["match", ["get", "kind"], "highway", 9, "major_road", 7, "medium_road", 5.5, 4]] } });
    // paved fills by class
    for (const [idSuffix, details, color] of [
      ["hwy", ["motorway", "trunk"], null], ["pri", ["primary"], roadPaint.primary],
      ["sec", ["secondary", "tertiary"], roadPaint.secondary],
    ]) {
      push({ id: idp + "-rd-" + idSuffix, type: "line", source: srcId, "source-layer": "roads", ...opt,
        filter: ["in", ["get", "kind_detail"], ["literal", details]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color || ["match", ["get", "kind_detail"], "motorway", roadPaint.motorway, roadPaint.trunk],
          "line-width": ["interpolate", ["linear"], ["zoom"],
            6, 0.8, 12, idSuffix === "hwy" ? 3.2 : 2.2, 16, idSuffix === "hwy" ? 7 : 4.5] } });
    }
    push({ id: idp + "-rd-minor", type: "line", source: srcId, "source-layer": "roads", ...opt,
      filter: ["==", ["get", "kind"], "minor_road"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.8, 16, 3.6] } });
    push({ id: idp + "-rd-service", type: "line", source: srcId, "source-layer": "roads",
      minzoom: Math.max(minz || 0, 13), ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["==", ["get", "kind_detail"], "service"],
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16, 2.4] } });
    push({ id: idp + "-rd-track", type: "line", source: srcId, "source-layer": "roads",
      minzoom: Math.max(minz || 0, 10.5), ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["==", ["get", "kind_detail"], "track"],
      layout: { "line-join": "round" },
      paint: { "line-color": "#a98a68", "line-width": 1.4, "line-dasharray": [4, 2] } });
    push({ id: idp + "-rd-path", type: "line", source: srcId, "source-layer": "roads",
      minzoom: Math.max(minz || 0, 11.5), ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["==", ["get", "kind"], "path"],
      paint: { "line-color": "#9a8a76", "line-width": 1.1, "line-dasharray": [2.5, 2] } });
    // road labels
    push({ id: idp + "-rd-label", type: "symbol", source: srcId, "source-layer": "roads", ...opt,
      ...(labelMaxz ? { maxzoom: labelMaxz } : {}),
      minzoom: Math.max(minz || 0, 9),
      filter: ["any", ["has", "name"], ["has", "ref"]],
      layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name"], ["get", "ref"]],
        "text-font": FONT_REG, "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10.5, 14, 12.5],
        "text-max-angle": 30 },
      paint: { "text-color": "#5a5148", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.4 } });
  }
  addRoads(state, "st", 0, null, 12.99);
  for (const r of REGIONS) if (bm[r]) addRoads(bm[r], r, 12.5, null, null);

  // buildings (regions only — statewide archive tops out at z12)
  for (const r of REGIONS) if (bm[r]) {
    push({ id: r + "-bldg", type: "fill", source: bm[r], "source-layer": "buildings", minzoom: 14.5,
      paint: { "fill-color": "#ddd3c4", "fill-outline-color": "#c4b69e" } });
  }

  // OHV trails
  if (sources.trails) {
    const vis = layerOn("trails") ? "visible" : "none";
    push({ id: "trails-case", type: "line", source: "trails", "source-layer": "trails", minzoom: 10,
      layout: { "line-cap": "round", "line-join": "round", visibility: vis },
      paint: { "line-color": "rgba(255,255,255,0.9)", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 14, 5] } });
    push({ id: "trails-mvum", type: "line", source: "trails", "source-layer": "trails", minzoom: 10,
      filter: ["==", ["get", "src"], "mvum"],
      layout: { "line-cap": "round", "line-join": "round", visibility: vis },
      paint: { "line-color": "#ef6c1a", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 14, 3.2] } });
    push({ id: "trails-odf", type: "line", source: "trails", "source-layer": "trails", minzoom: 10,
      filter: ["==", ["get", "src"], "odf"],
      layout: { "line-cap": "round", "line-join": "round", visibility: vis },
      paint: { "line-color": "#1e8449", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 14, 3.2] } });
    push({ id: "trails-usfs", type: "line", source: "trails", "source-layer": "trails", minzoom: 10,
      filter: ["==", ["get", "src"], "usfs"],
      layout: { "line-join": "round", visibility: vis },
      paint: { "line-color": "#8e44ad", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.4, 14, 2.8], "line-dasharray": [3, 1.8] } });
    push({ id: "trails-label", type: "symbol", source: "trails", "source-layer": "trails", minzoom: 13.5,
      filter: ["has", "name"],
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT_REG,
        "text-size": 11, visibility: vis },
      paint: { "text-color": "#7a3c10", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.3 } });
  }

  // selected-trail highlight: exact geometry from vector tiles at riding zooms,
  // simplified named-trail lines when zoomed out (so the whole route shows at a glance)
  const HL_OFF = ["==", ["get", "sid"], "__none__"];
  push({ id: "tn-hl-case", type: "line", source: "trailnames", maxzoom: 9.99, filter: HL_OFF,
    layout: { "line-cap": "round", "line-join": "round", visibility: layerOn("trails") ? "visible" : "none" },
    paint: { "line-color": "#ffeb3b", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 5, 10, 11] } });
  push({ id: "tn-hl", type: "line", source: "trailnames", maxzoom: 9.99, filter: HL_OFF,
    layout: { "line-cap": "round", "line-join": "round", visibility: layerOn("trails") ? "visible" : "none" },
    paint: { "line-color": "#ff6d00", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.6, 10, 6] } });
  if (sources.trails) {
    push({ id: "trails-hl-case", type: "line", source: "trails", "source-layer": "trails", minzoom: 10, filter: HL_OFF,
      layout: { "line-cap": "round", "line-join": "round", visibility: layerOn("trails") ? "visible" : "none" },
      paint: { "line-color": "#ffeb3b", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 9, 15, 15] } });
    push({ id: "trails-hl", type: "line", source: "trails", "source-layer": "trails", minzoom: 10, filter: HL_OFF,
      layout: { "line-cap": "round", "line-join": "round", visibility: layerOn("trails") ? "visible" : "none" },
      paint: { "line-color": "#ff6d00", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 8.5] } });
  }

  // camping / staging points
  {
    const vis = layerOn("camping") ? "visible" : "none";
    push({ id: "camp-ring", type: "circle", source: "camping", minzoom: 9,
      layout: { visibility: vis },
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 9],
        "circle-color": "#ffffff", "circle-opacity": 0.95 } });
    push({ id: "camp-dot", type: "circle", source: "camping", minzoom: 9,
      layout: { visibility: vis },
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.4, 14, 6.2],
        "circle-color": "#ff8c1a" } });
    push({ id: "camp-label", type: "symbol", source: "camping", minzoom: 12,
      layout: { "text-field": ["get", "name"], "text-font": FONT_REG, "text-size": 11.5,
        "text-offset": [0, 1.1], "text-anchor": "top", visibility: vis },
      paint: { "text-color": "#6b4210", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.3 } });
  }

  // water + place labels (statewide to z13, regions above)
  const addLabels = (srcId, idp, minz, maxz) => {
    const opt = { ...(minz ? { minzoom: minz } : {}), ...(maxz ? { maxzoom: maxz } : {}) };
    push({ id: idp + "-water-label", type: "symbol", source: srcId, "source-layer": "water",
      minzoom: Math.max(minz || 0, 10), ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["has", "name"]],
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT_REG,
        "text-size": 11 },
      paint: { "text-color": "#4a7ca8", "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.2 } });
    const placeLayer = (suffix, kinds, minZoom, size, font) => push({
      id: idp + "-pl-" + suffix, type: "symbol", source: srcId, "source-layer": "places",
      minzoom: Math.max(minz || 0, minZoom), ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["in", ["get", "kind"], ["literal", kinds]],
      layout: { "text-field": ["get", "name"], "text-font": font || FONT_MED,
        "text-size": size, "text-max-width": 8 },
      paint: { "text-color": "#3d3830", "text-halo-color": "rgba(255,255,255,0.92)", "text-halo-width": 1.6 } });
    placeLayer("city", ["city"], 4, ["interpolate", ["linear"], ["zoom"], 4, 13, 10, 19]);
    placeLayer("town", ["town"], 7, ["interpolate", ["linear"], ["zoom"], 7, 11.5, 12, 15.5]);
    placeLayer("village", ["village"], 9.5, 12);
    placeLayer("hamlet", ["hamlet", "neighbourhood", "suburb", "quarter"], 11.5, 11, FONT_REG);
    push({ id: idp + "-peak", type: "symbol", source: srcId, "source-layer": "pois",
      minzoom: Math.max(minz || 0, 10), ...(maxz ? { maxzoom: maxz } : {}),
      filter: ["==", ["get", "kind"], "peak"],
      layout: { "text-field": ["concat", "▲ ", ["get", "name"], "\n", ["to-string", ["get", "elevation"]], " m"],
        "text-font": FONT_REG, "text-size": 10.5, "text-anchor": "top", "text-offset": [0, 0.2] },
      paint: { "text-color": "#6e6252", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.3 } });
  };
  addLabels(state, "st", 0, 12.99);
  for (const r of REGIONS) if (bm[r]) addLabels(bm[r], r, 13, null);

  // route / track / me (always on top)
  push({ id: "route-line", type: "line", source: "route",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#1457d9", "line-width": 4, "line-dasharray": [1.6, 1.2] } });
  push({ id: "route-pt", type: "circle", source: "route",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 7, "circle-color": "#1457d9", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
  push({ id: "track-view", type: "line", source: "track",
    filter: ["==", ["get", "kind"], "view"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#1457d9", "line-width": 4.5 } });
  push({ id: "track-live", type: "line", source: "track",
    filter: ["==", ["get", "kind"], "live"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#e0331f", "line-width": 4.5 } });
  push({ id: "me-acc", type: "fill", source: "me",
    filter: ["==", ["get", "kind"], "acc"],
    paint: { "fill-color": "rgba(26,115,232,0.15)" } });
  push({ id: "me-cone", type: "fill", source: "me",
    filter: ["==", ["get", "kind"], "cone"],
    paint: { "fill-color": "rgba(26,115,232,0.35)" } });
  push({ id: "me-dot-ring", type: "circle", source: "me",
    filter: ["==", ["get", "kind"], "dot"],
    paint: { "circle-radius": 11, "circle-color": "#ffffff" } });
  push({ id: "me-dot", type: "circle", source: "me",
    filter: ["==", ["get", "kind"], "dot"],
    paint: { "circle-radius": 8, "circle-color": "#1a73e8" } });

  return {
    version: 8,
    name: "Oregon OHV Map",
    glyphs: new URL("glyphs/{fontstack}/{range}.pbf", document.baseURI).href.replace(/%7B/gi, "{").replace(/%7D/gi, "}"),
    sources, layers: L,
  };
}

/* ---------------- layer toggles ---------------- */
const layerState = { land: true, trails: true, camping: true, terrain: true, contours: true };
try { Object.assign(layerState, JSON.parse(localStorage.getItem("ohv.layers") || "{}")); } catch (e) {}
function layerOn(k) { return layerState[k] !== false; }
function applyLayerVisibility() {
  if (!window._map) return;
  const m = window._map;
  const set = (ids, on) => ids.forEach((id) => { if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none"); });
  set(["land-fill", "land-line"], layerOn("land"));
  set(["trails-case", "trails-mvum", "trails-odf", "trails-usfs", "trails-label",
       "trails-hl-case", "trails-hl", "tn-hl-case", "tn-hl"], layerOn("trails"));
  set(["camp-ring", "camp-dot", "camp-label"], layerOn("camping"));
  set(["hill-oregon", ...REGIONS.map((r) => "hill-" + r)], layerOn("terrain"));
  set(["ct-oregon-minor", "ct-oregon-index", "ct-oregon-label",
       ...REGIONS.flatMap((r) => ["ct-" + r + "-minor", "ct-" + r + "-index", "ct-" + r + "-label"])], layerOn("contours"));
}

/* ---------------- geo helpers ---------------- */
const R_EARTH = 6371000;
function haversine(a, b) {
  const dLat = (b[1] - a[1]) * Math.PI / 180, dLng = (b[0] - a[0]) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}
function circlePoly(center, radiusM, n = 48) {
  const pts = [];
  const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos(center[1] * Math.PI / 180));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([center[0] + Math.cos(a) * dLng, center[1] + Math.sin(a) * dLat]);
  }
  return pts;
}
function conePoly(center, headingDeg, radiusM = 55, spreadDeg = 30) {
  const pts = [center];
  for (let i = 0; i <= 10; i++) {
    const a = (headingDeg - spreadDeg + (2 * spreadDeg * i) / 10) * Math.PI / 180;
    pts.push([center[0] + Math.sin(a) * radiusM / (111320 * Math.cos(center[1] * Math.PI / 180)),
              center[1] + Math.cos(a) * radiusM / 111320]);
  }
  pts.push(center);
  return pts;
}
const fmtMi = (m) => (m / 1609.344).toFixed(m < 160 ? 2 : 1) + " mi";
const fmtAcres = (a) => a >= 1000 ? Math.round(a).toLocaleString() + " acres" : Math.round(a) + " acres";

/* ---------------- map ---------------- */
let map = null;
let savedView = null;
try { savedView = JSON.parse(localStorage.getItem("ohv.view") || "null"); } catch (e) {}

async function initMap() {
  const style = await buildStyle();
  map = new maplibregl.Map({
    container: "map",
    style,
    center: savedView ? savedView.center : [-120.6, 43.9],
    zoom: savedView ? savedView.zoom : 6.4,
    bearing: 0,
    pitch: 0,
    attributionControl: { compact: true },
    maxBounds: [[-130, 38], [-111, 50]],
  });
  window._map = map;
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "imperial" }), "bottom-left");
  map.on("moveend", () => {
    try { localStorage.setItem("ohv.view", JSON.stringify({ center: map.getCenter().toArray(), zoom: map.getZoom() })); } catch (e) {}
  });
  map.on("rotate", () => {
    $("btn-north").classList.toggle("hidden", Math.abs(map.getBearing()) < 1);
  });
  map.on("dragstart", () => { if (followMode) setFollow(0); });
  map.on("click", onMapClick);
  // NOTE: keyed on style.load, NOT map load — the "load" event waits for every
  // source, and sources for packs that aren't downloaded never settle offline,
  // which would starve the camping/trail-name data feed. style.load always fires.
  map.on("style.load", () => { onStyleReady(); });
  map.on("error", (e) => { /* tile errors offline are expected for un-downloaded packs */ });
  startGPS();
}

async function onStyleReady() {
  if (!map) return;
  applyLayerVisibility();
  try {
    const data = await campingData();
    const src = map.getSource("camping");
    if (src) src.setData(data);
  } catch (e) { /* camping loads when the Oregon pack is available */ }
  try {
    const tn = await trailNamesData();
    const tsrc = map.getSource("trailnames");
    if (tsrc) tsrc.setData(tn);
  } catch (e) { /* trail names load with the Oregon pack */ }
  if (selectedTrail) setTrailHighlight(selectedTrail);
  applyDynamic();
  refreshPacksBadge();
  maybeRunTestHook();
}

/* dynamic (non-style) sources data */
let mePos = null;           // {lng, lat, acc, heading, speed, t}
let viewTrack = null;        // saved track currently displayed
function applyDynamic() {
  if (!map) return;
  const meSrc = map.getSource("me");
  if (meSrc && mePos) {
    const feats = [{ type: "Feature", properties: { kind: "dot" }, geometry: { type: "Point", coordinates: [mePos.lng, mePos.lat] } }];
    if (mePos.acc) feats.push({ type: "Feature", properties: { kind: "acc" }, geometry: { type: "Polygon", coordinates: [circlePoly([mePos.lng, mePos.lat], mePos.acc)] } });
    if (mePos.heading != null) feats.push({ type: "Feature", properties: { kind: "cone" }, geometry: { type: "Polygon", coordinates: [conePoly([mePos.lng, mePos.lat], mePos.heading)] } });
    meSrc.setData({ type: "FeatureCollection", features: feats });
  }
  const tSrc = map.getSource("track");
  if (tSrc) {
    const feats = [];
    if (rec.points.length > 1) feats.push({ type: "Feature", properties: { kind: "live" }, geometry: { type: "LineString", coordinates: rec.points.map((p) => [p[0], p[1]]) } });
    if (viewTrack && viewTrack.points.length > 1) feats.push({ type: "Feature", properties: { kind: "view" }, geometry: { type: "LineString", coordinates: viewTrack.points.map((p) => [p[0], p[1]]) } });
    tSrc.setData({ type: "FeatureCollection", features: feats });
  }
  const rSrc = map.getSource("route");
  if (rSrc) {
    const feats = routePts.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }));
    if (routePts.length > 1) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePts } });
    rSrc.setData({ type: "FeatureCollection", features: feats });
  }
}

/* ---------------- GPS / follow ---------------- */
let followMode = 0; // 0 off, 1 follow, 2 follow + heading-up
let gpsWatch = null, firstFixDone = false;
function setFollow(mode) {
  followMode = mode;
  $("btn-follow").classList.toggle("active", mode > 0);
  if (mode === 1) toast("Following you — tap 🎯 again to turn with your direction");
  if (mode === 2) toast("Heading-up — map turns with you. Tap 🎯 to stop following");
  if (mode === 0) toast("Follow off");
  if (mode > 0 && mePos) centerOnMe(true);
}
function centerOnMe(rotate) {
  if (!mePos || !map) return;
  const opts = { center: [mePos.lng, mePos.lat], duration: 650 };
  if (rotate && followMode === 2 && mePos.heading != null) opts.bearing = mePos.heading;
  map.easeTo(opts);
}
function startGPS() {
  if (!("geolocation" in navigator)) { $("gps-status").textContent = "GPS: not available"; return; }
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      mePos = { lng: c.longitude, lat: c.latitude, acc: c.accuracy, heading: c.heading, speed: c.speed, alt: c.altitude, t: pos.timestamp };
      const gs = $("gps-status");
      gs.textContent = "GPS: ±" + Math.round(c.accuracy) + " m";
      gs.className = c.accuracy <= 60 ? "gps-on" : "gps-off";
      if (!firstFixDone) {
        firstFixDone = true;
        if (!savedView && c.longitude > OREGON_BBOX[0] && c.longitude < OREGON_BBOX[2] && c.latitude > OREGON_BBOX[1] && c.latitude < OREGON_BBOX[3]) {
          map.flyTo({ center: [c.longitude, c.latitude], zoom: 12.5, duration: 1200 });
        }
      }
      if (followMode) centerOnMe(true);
      onPositionForRecord();
      applyDynamic();
    },
    (err) => {
      const gs = $("gps-status");
      gs.textContent = err.code === 1 ? "GPS: permission denied" : "GPS: looking…";
      gs.className = "gps-off";
    },
    { enableHighAccuracy: true, maximumAge: 1500, timeout: 25000 }
  );
}

/* ---------------- track recording ---------------- */
const rec = { on: false, points: [], dist: 0, start: 0, timer: null };
function loadTracks() { try { return JSON.parse(localStorage.getItem("ohv.tracks") || "[]"); } catch (e) { return []; } }
function saveTracks(t) { try { localStorage.setItem("ohv.tracks", JSON.stringify(t)); } catch (e) { toast("Phone storage is full — track not saved"); } }
function onPositionForRecord() {
  if (!rec.on || !mePos) return;
  const p = [mePos.lng, mePos.lat, mePos.alt || 0, Date.now()];
  const last = rec.points[rec.points.length - 1];
  if (!last || haversine(last, p) >= 8) {
    if (last) rec.dist += haversine(last, p);
    rec.points.push(p);
    applyDynamic();
  }
  updateRecPill();
}
function updateRecPill() {
  if (!rec.on) return;
  const secs = Math.floor((Date.now() - rec.start) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
  $("pill").textContent = "⏺ Recording — " + fmtMi(rec.dist) + " · " + mm + ":" + ss;
}
function toggleRecord() {
  if (!rec.on) {
    if (!mePos) { toast("Waiting for GPS — give it a few seconds, then try again"); return; }
    rec.on = true; rec.points = [[mePos.lng, mePos.lat, mePos.alt || 0, Date.now()]]; rec.dist = 0; rec.start = Date.now();
    $("btn-record").classList.add("recording");
    $("pill").classList.remove("hidden");
    rec.timer = setInterval(updateRecPill, 1000);
    updateRecPill();
    toast("Recording your track");
  } else {
    rec.on = false;
    clearInterval(rec.timer);
    $("btn-record").classList.remove("recording");
    $("pill").classList.add("hidden");
    if (rec.points.length > 2) {
      const name = "Ride " + new Date(rec.start).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " + new Date(rec.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const tracks = loadTracks();
      tracks.unshift({ id: "t" + rec.start, name, start: rec.start, dist: rec.dist, points: rec.points });
      saveTracks(tracks);
      renderTracks();
      toast("Track saved: " + fmtMi(rec.dist) + " — find it in the ☰ menu");
    } else {
      toast("Track too short to save");
    }
    rec.points = []; rec.dist = 0;
    applyDynamic();
  }
}
function trackToGPX(t) {
  const pts = t.points.map((p) => `    <trkpt lat="${p[1]}" lon="${p[0]}">${p[2] ? `<ele>${p[2]}</ele>` : ""}<time>${new Date(p[3]).toISOString()}</time></trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Oregon OHV Map" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${t.name}</name><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>`;
}
async function shareTrack(t) {
  const gpx = trackToGPX(t);
  const fname = t.name.replace(/[^a-z0-9]+/gi, "-") + ".gpx";
  try {
    const file = new File([gpx], fname, { type: "application/gpx+xml" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    throw new Error("no share");
  } catch (e) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
}
function renderTracks() {
  const list = $("tracks-list");
  const tracks = loadTracks();
  if (!tracks.length) return;
  list.innerHTML = "";
  for (const t of tracks) {
    const row = document.createElement("div");
    row.className = "track-item";
    row.innerHTML = `<div class="tinfo"><div class="tname"></div><div class="tmeta">${fmtMi(t.dist)} · ${new Date(t.start).toLocaleDateString()}</div></div>`;
    row.querySelector(".tname").textContent = t.name;
    const view = document.createElement("button"); view.textContent = "Show";
    view.onclick = () => {
      viewTrack = (viewTrack && viewTrack.id === t.id) ? null : t;
      view.textContent = viewTrack ? "Hide" : "Show";
      applyDynamic();
      if (viewTrack && t.points.length) {
        const mid = t.points[Math.floor(t.points.length / 2)];
        map.flyTo({ center: [mid[0], mid[1]], zoom: 13 });
        $("panel").classList.add("hidden");
      }
    };
    const share = document.createElement("button"); share.textContent = "GPX";
    share.onclick = () => shareTrack(t);
    const del = document.createElement("button"); del.textContent = "🗑";
    del.onclick = () => { saveTracks(loadTracks().filter((x) => x.id !== t.id)); if (viewTrack && viewTrack.id === t.id) { viewTrack = null; applyDynamic(); } renderTracks(); };
    row.append(view, share, del);
    list.appendChild(row);
  }
}

/* ---------------- route planner ---------------- */
let routeMode = false, routePts = [];
function routeDistance() {
  let d = 0;
  for (let i = 1; i < routePts.length; i++) d += haversine(routePts[i - 1], routePts[i]);
  return d;
}
function updateRouteBar() {
  $("route-info").textContent = routePts.length < 2
    ? "Tap the map to drop points (" + routePts.length + " dropped)"
    : "Route: " + fmtMi(routeDistance()) + " — straight-line, not trail directions";
}
function setRouteMode(on) {
  routeMode = on;
  $("btn-route").classList.toggle("active", on);
  $("route-bar").classList.toggle("hidden", !on);
  if (!on) { routePts = []; applyDynamic(); }
  else { updateRouteBar(); toast("Route mode: tap the map to drop points"); }
}

/* ---------------- info cards ---------------- */
function openCard(html) { $("card-body").innerHTML = html; $("card").classList.remove("hidden"); }
function closeCard() { $("card").classList.add("hidden"); clearTrailHighlight(); }

/* selected trail: light up the ENTIRE route (every segment with the same name) */
let selectedTrail = null;
function setTrailHighlight(sel) {
  selectedTrail = sel;
  if (!map) return;
  const OFF = ["==", ["get", "sid"], "__none__"];
  const vecFilter = !sel ? OFF : sel.grp
    ? ["all", ["==", ["get", "src"], sel.src], ["==", ["get", "grp"], sel.grp]]
    : ["==", ["get", "sid"], sel.sid];
  const geoFilter = sel && sel.grp
    ? ["all", ["==", ["get", "src"], sel.src], ["==", ["get", "grp"], sel.grp]] : OFF;
  for (const id of ["trails-hl-case", "trails-hl"]) if (map.getLayer(id)) map.setFilter(id, vecFilter);
  for (const id of ["tn-hl-case", "tn-hl"]) if (map.getLayer(id)) map.setFilter(id, geoFilter);
}
function clearTrailHighlight() { if (selectedTrail) setTrailHighlight(null); }
function row(k, v) { return v ? `<div class="card-row"><b>${k}</b><span>${v}</span></div>` : ""; }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function onMapClick(e) {
  if (routeMode) {
    routePts.push([e.lngLat.lng, e.lngLat.lat]);
    applyDynamic(); updateRouteBar();
    return;
  }
  if (!map) return;
  const box = [[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]];
  const candidates = ["camp-dot", "trails-mvum", "trails-odf", "trails-usfs", "land-fill"]
    .filter((id) => map.getLayer(id));
  const feats = map.queryRenderedFeatures(box, { layers: candidates });
  if (!feats.length) { closeCard(); return; }
  const f = feats[0], p = f.properties || {};
  if (f.layer.id === "camp-dot") {
    clearTrailHighlight();
    openCard(`<div class="card-kind">🏕 ${esc(p.type || "Camp / staging")}</div><h2>${esc(p.name)}</h2>
      ${row("Managed by", esc(p.manager))}${p.detail ? `<p>${esc(p.detail)}</p>` : ""}`);
  } else if (f.layer.id === "land-fill") {
    clearTrailHighlight();
    openCard(`<div class="card-kind">🗺 Public land</div><h2>${esc(p.name)}</h2>
      ${row("Owner", esc(p.label))}${row("Camping", esc(p.rule))}${row("Size", p.acres ? fmtAcres(+p.acres) : "")}
      <p>Colors show who owns the land. Green (National Forest) and tan (BLM) are where dispersed camping is generally allowed — the MVUM is still the legal word for motorized use.</p>`);
  } else {
    const grp = p.grp || "";
    setTrailHighlight({ src: p.src, grp, sid: p.sid });
    const totals = routeTotals(p.src, grp);
    const kindLabel = p.src === "mvum" ? "OHV trail — MVUM (the legal one)" : p.src === "odf" ? "OHV trail — state forest" : "Trail — FS inventory";
    openCard(`<div class="card-kind">🏍 ${kindLabel}</div><h2>${esc(p.name)}</h2>
      ${totals ? row("Full route", totals.miles.toFixed(1) + " mi · " + totals.n + " segments — all lit up yellow") : ""}
      ${row("Open to", esc(p.vehicles))}${row("Season", esc(p.season))}
      ${row("Length", p.miles ? (+p.miles).toFixed(1) + " mi (this segment)" : "")}
      ${row("Managed by", esc(p.manager))}${p.detail ? `<p>${esc(p.detail)}</p>` : ""}`);
  }
}

/* ---------------- packs UI + download ---------------- */
const fmtMB = (b) => (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + " MB";
function bundleStatus(b) {
  const have = b.files.filter((f) => isLocal(f)).length;
  return have === 0 ? "none" : have === b.files.length ? "full" : "partial";
}
function bundleBytes(b) { return b.files.reduce((s, f) => s + (f.size || 0), 0); }
function refreshPacksBadge() {
  const oregon = PACKS.bundles.find((b) => b.id === "oregon");
  $("packs-badge").classList.toggle("hidden", bundleStatus(oregon) === "full");
}
async function refreshStorageLine() {
  try {
    const est = await navigator.storage.estimate();
    const used = Object.values(localFiles).reduce((s, f) => s + (f.size || 0), 0);
    $("packs-storage").textContent = "Map data on this phone: " + fmtMB(used) +
      ". Phone storage free: about " + fmtMB((est.quota || 0) - (est.usage || 0)) + ".";
    $("storage-line").textContent = "Offline map data stored: " + fmtMB(used) + ".";
  } catch (e) {}
}
function renderPacks() {
  const list = $("packs-list");
  list.innerHTML = "";
  for (const b of PACKS.bundles) {
    const st = bundleStatus(b);
    const card = document.createElement("div");
    card.className = "pack-card";
    card.innerHTML = `<h4></h4><p class="pack-desc"></p>
      <div class="pack-meta">${st === "full" ? "✓ On this phone" : st === "partial" ? "Partly downloaded" : "Not downloaded"} · ${fmtMB(bundleBytes(b))}</div>
      <div class="pack-progress hidden"><div></div></div>`;
    card.querySelector("h4").textContent = b.name;
    card.querySelector(".pack-desc").textContent = b.desc;
    const btn = document.createElement("button");
    btn.className = "pack-btn" + (st === "full" ? " secondary" : "");
    btn.textContent = st === "full" ? "Remove from phone" : st === "partial" ? "Finish downloading" : "Download";
    btn.onclick = () => (st === "full" ? removeBundle(b, card) : downloadBundle(b, card));
    card.appendChild(btn);
    list.appendChild(card);
  }
  refreshStorageLine();
}
async function downloadFile(file, onProgress) {
  const url = new URL("packs/" + file.file, document.baseURI).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error("download failed (" + res.status + ")");
  const total = +res.headers.get("Content-Length") || file.size || 0;
  const dir = await packsDir();
  const fh = await dir.getFileHandle(file.file, { create: true });
  const writable = await fh.createWritable();
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await writable.write(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  await writable.close();
  if (file.size && got !== file.size) { await opfsDelete(file.file); throw new Error("incomplete download"); }
  localFiles[file.id] = { size: got, at: Date.now() };
  localStorage.setItem("ohv.localFiles", JSON.stringify(localFiles));
}
async function downloadBundle(b, card) {
  const btn = card.querySelector(".pack-btn");
  const bar = card.querySelector(".pack-progress");
  const fill = bar.querySelector("div");
  btn.disabled = true; bar.classList.remove("hidden");
  const todo = b.files.filter((f) => !isLocal(f));
  const totalBytes = todo.reduce((s, f) => s + (f.size || 0), 0) || 1;
  let doneBytes = 0;
  try {
    for (const f of todo) {
      btn.textContent = "Downloading " + b.name + "…";
      await downloadFile(f, (frac) => { fill.style.width = ((doneBytes + frac * (f.size || 0)) / totalBytes * 100).toFixed(1) + "%"; });
      doneBytes += f.size || 0;
    }
    toast(b.name + " saved on your phone — works offline now");
  } catch (e) {
    toast("Download stopped — check Wi-Fi and try again");
  }
  btn.disabled = false;
  renderPacks();
  refreshPacksBadge();
  await rebuildMap();
}
async function removeBundle(b, card) {
  for (const f of b.files) {
    await opfsDelete(f.file);
    delete localFiles[f.id];
  }
  localStorage.setItem("ohv.localFiles", JSON.stringify(localFiles));
  renderPacks();
  refreshPacksBadge();
  await rebuildMap();
  toast(b.name + " removed from phone");
}
let rebuilding = false;
async function rebuildMap() {
  if (!map || rebuilding) return;
  rebuilding = true;
  try {
    const style = await buildStyle();
    map.setStyle(style);
    // the style.load listener (onStyleReady) reapplies visibility + geojson data
    await new Promise((res) => map.once("style.load", res));
    await new Promise((res) => setTimeout(res, 350));
  } finally { rebuilding = false; }
}

/* Test hook (used by the offline verification harness only):
   index.html#test&lng=..&lat=..&z=..  -> jump there and fire a real map click. */
function maybeRunTestHook() {
  if (!location.hash.startsWith("#test")) return;
  const q = new URLSearchParams(location.hash.slice(1));
  window.__ohvTest = { map, version: "1" };
  const lng = parseFloat(q.get("lng")), lat = parseFloat(q.get("lat")), z = parseFloat(q.get("z") || "13");
  if (isNaN(lng) || isNaN(lat)) return;
  map.jumpTo({ center: [lng, lat], zoom: z });
  // wait until trail features are actually rendered here, then click
  const t0 = Date.now();
  const poll = setInterval(() => {
    let n = 0;
    try { n = map.queryRenderedFeatures({ layers: ["trails-odf", "trails-mvum", "trails-usfs"].filter((id) => map.getLayer(id)) }).length; } catch (e) {}
    if (n > 0 || Date.now() - t0 > 25000) {
      clearInterval(poll);
      setTimeout(() => {
        const pt = map.project([lng, lat]);
        map.fire("click", { point: pt, lngLat: new maplibregl.LngLat(lng, lat), originalEvent: {} });
        document.title = "TEST_CLICKED";
      }, 400);
    }
  }, 700);
}

/* ---------------- wiring ---------------- */
function wireUI() {
  $("btn-menu").onclick = () => { $("panel").classList.toggle("hidden"); renderTracks(); refreshStorageLine(); };
  $("panel-close").onclick = () => $("panel").classList.add("hidden");
  $("btn-packs").onclick = () => { renderPacks(); $("packs-sheet").classList.remove("hidden"); };
  $("packs-close").onclick = () => $("packs-sheet").classList.add("hidden");
  $("btn-follow").onclick = () => setFollow((followMode + 1) % 3);
  $("btn-record").onclick = toggleRecord;
  $("btn-route").onclick = () => setRouteMode(!routeMode);
  $("route-undo").onclick = () => { routePts.pop(); applyDynamic(); updateRouteBar(); };
  $("route-clear").onclick = () => { routePts = []; applyDynamic(); updateRouteBar(); };
  $("route-done").onclick = () => setRouteMode(false);
  $("card-close").onclick = closeCard;
  $("btn-north").onclick = () => { map.easeTo({ bearing: 0 }); if (followMode === 2) setFollow(1); };
  const bind = (id, key) => {
    const el = $(id);
    el.checked = layerOn(key);
    el.onchange = () => {
      layerState[key] = el.checked;
      localStorage.setItem("ohv.layers", JSON.stringify(layerState));
      applyLayerVisibility();
    };
  };
  bind("lyr-land", "land"); bind("lyr-trails", "trails"); bind("lyr-camping", "camping");
  bind("lyr-terrain", "terrain"); bind("lyr-contours", "contours");
}

/* ---------------- boot ---------------- */
(async function boot() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch (e) {}
  }
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) {}
  }
  try {
    const res = await fetch("packs.json");
    PACKS = await res.json();
  } catch (e) {
    toast("Could not load the map list — check your connection", 6000);
    return;
  }
  // verify local files still exist (storage may have been cleared)
  for (const { file } of allFiles()) {
    if (isLocal(file)) {
      const blob = await opfsFile(file.file);
      if (!blob || blob.size !== (localFiles[file.id].size || blob.size)) {
        if (!blob) delete localFiles[file.id];
      }
    }
  }
  localStorage.setItem("ohv.localFiles", JSON.stringify(localFiles));
  wireUI();
  await initMap();
})();
