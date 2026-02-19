/* =========================================================
   Agentic Twins — Global Air Demo (drop-in script.js)
   Changes implemented:
   1) Global cities: DXB, FRA, ROM, LON, NYC, CHI + HKG + TYO
   2) Add Paris
   3) Add Vienna
   4) Hub: Dubai
   5) Multiple Disruption scenarios (cycle)
   6) Corrections mapped to scenarios
========================================================= */

// ------------------------ Map setup ------------------------
const map = new maplibregl.Map({
  container: "map",
  style: "./style.json",
  center: [20, 25],   // world-ish center
  zoom: 1.6,
  pitch: 0,
  bearing: 0
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");

// Canvas overlay for planes
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

// ------------------------ UI helpers ------------------------
const logEl = document.getElementById("log");
const inputEl = document.getElementById("chatInput");

function log(msg) {
  const div = document.createElement("div");
  div.textContent = msg;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.pitch = 1.0;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {
    // ignore
  }
}

function fitToVisibleNetwork(extraPadding = 60) {
  const coords = Object.values(capitals).map(c => c.lngLat);
  if (!coords.length) return;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: extraPadding, duration: 900 });
}

// ------------------------ City set ------------------------
/**
 * City codes are arbitrary; keep short and consistent.
 * We keep HKG and TYO, remove ASEAN set, add global cities.
 */
let capitals = {
  HKG: { name: "Hong Kong", lngLat: [114.1694, 22.3193] },
  TYO: { name: "Tokyo",     lngLat: [139.6917, 35.6895] },

  DXB: { name: "Dubai",     lngLat: [55.2708, 25.2048] },
  FRA: { name: "Frankfurt", lngLat: [8.6821, 50.1109] },
  ROM: { name: "Rome",      lngLat: [12.4964, 41.9028] },
  LON: { name: "London",    lngLat: [-0.1276, 51.5072] },
  NYC: { name: "New York",  lngLat: [-74.0060, 40.7128] },
  CHI: { name: "Chicago",   lngLat: [-87.6298, 41.8781] }
};

// “Add” targets
const ADD_PARIS = { code: "PAR", name: "Paris",  lngLat: [2.3522, 48.8566] };
const ADD_VIENNA= { code: "VIE", name: "Vienna", lngLat: [16.3738, 48.2082] };

// ------------------------ Routes / network state ------------------------
/**
 * We represent each route as a GeoJSON LineString with properties:
 * - id, from, to, kind: "base" | "reroute" | "hub"
 * Planes reference a route id to move along its polyline points.
 */

let routes = [];                 // active route objects
let planes = [];                 // moving objects
let pausedRouteIds = new Set();  // routes paused by disruption
let activeScenarioIndex = -1;    // cycles through scenarios

// Sprite for planes
const planeImg = new Image();
planeImg.src = "./airplane_topview.png";
let planeImgReady = false;
planeImg.onload = () => (planeImgReady = true);

// ------------------------ Scenario definitions ------------------------
/**
 * Disruption scenarios are defined on DIRECT pairs (from,to).
 * Correction is defined as a reroute path (sequence of legs).
 *
 * For each scenario:
 *  - disruptPairs: [ ["A","B"], ... ]  (pause flights on those base routes)
 *  - correctionPaths: [ ["A","X","B"], ["C","Y","Z","D"], ... ] (create reroutes)
 */
const SCENARIOS = [
  {
    name: "Middle East airspace constraint (DXB ↔ LON, DXB ↔ FRA)",
    disruptPairs: [
      ["DXB", "LON"],
      ["DXB", "FRA"]
    ],
    correctionPaths: [
      ["DXB", "ROM", "LON"],
      ["DXB", "ROM", "FRA"]
    ],
    narrationDisrupt:
      "Disruption detected. Dubai corridor capacity is constrained. Flights between Dubai and London, and Dubai and Frankfurt are paused.",
    narrationCorrect:
      "Correction applied. Rerouting via Rome to restore flow while avoiding constrained corridors."
  },
  {
    name: "Transatlantic congestion (LON ↔ NYC, FRA ↔ NYC)",
    disruptPairs: [
      ["LON", "NYC"],
      ["FRA", "NYC"]
    ],
    correctionPaths: [
      ["LON", "CHI", "NYC"],
      ["FRA", "LON", "CHI", "NYC"]
    ],
    narrationDisrupt:
      "Disruption detected. Transatlantic congestion is rising. Pausing London to New York and Frankfurt to New York corridors.",
    narrationCorrect:
      "Correction applied. Rerouting via Chicago to smooth congestion and restore New York connectivity."
  },
  {
    name: "East Asia constraint (HKG ↔ TYO, HKG ↔ DXB)",
    disruptPairs: [
      ["HKG", "TYO"],
      ["HKG", "DXB"]
    ],
    correctionPaths: [
      ["HKG", "TYO", "DXB"],
      ["HKG", "TYO", "FRA", "DXB"]
    ],
    narrationDisrupt:
      "Disruption detected. East Asia constraints active. Pausing Hong Kong to Tokyo and Hong Kong to Dubai corridors.",
    narrationCorrect:
      "Correction applied. Rerouting through Tokyo to preserve Hong Kong connectivity."
  }
];

// ------------------------ Geo helpers ------------------------
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function dist2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx*dx + dy*dy;
}

/**
 * Creates a curved line between two lng/lat points by interpolating in lng/lat.
 * (Simple + stable; avoids great-circle edge weirdness near antimeridian.)
 */
function makeArc(fromLngLat, toLngLat, steps = 80, curve = 0.18) {
  const [x1, y1] = fromLngLat;
  const [x2, y2] = toLngLat;

  // midpoint
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // perpendicular offset for "curvature"
  const dx = x2 - x1;
  const dy = y2 - y1;
  const px = -dy;
  const py = dx;

  // scale curvature by distance
  const d = Math.sqrt(dx*dx + dy*dy) || 1;
  const ox = (px / d) * (d * curve);
  const oy = (py / d) * (d * curve);

  const cx = mx + ox;
  const cy = my + oy;

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Quadratic Bezier: (1-t)^2 P0 + 2(1-t)t C + t^2 P1
    const xt = (1-t)*(1-t)*x1 + 2*(1-t)*t*cx + t*t*x2;
    const yt = (1-t)*(1-t)*y1 + 2*(1-t)*t*cy + t*t*y2;
    pts.push([xt, yt]);
  }
  return pts;
}

function upsertRouteSource() {
  const fc = {
    type: "FeatureCollection",
    features: routes.map(r => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: r.coords },
      properties: { id: r.id, from: r.from, to: r.to, kind: r.kind }
    }))
  };

  if (map.getSource("routes")) {
    map.getSource("routes").setData(fc);
  } else {
    map.addSource("routes", { type: "geojson", data: fc });

    // Base routes
    map.addLayer({
      id: "routes-base",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "kind"], "base"],
      paint: {
        "line-width": 2.2,
        "line-opacity": 0.75
      }
    });

    // Hub routes
    map.addLayer({
      id: "routes-hub",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "kind"], "hub"],
      paint: {
        "line-width": 2.6,
        "line-opacity": 0.85
      }
    });

    // Reroutes (corrections)
    map.addLayer({
      id: "routes-reroute",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "kind"], "reroute"],
      paint: {
        "line-width": 3.2,
        "line-opacity": 0.95
      }
    });

    // Disrupted routes highlight (we draw separately as a layer filter by ids)
    map.addLayer({
      id: "routes-disrupted",
      type: "line",
      source: "routes",
      filter: ["in", ["get", "id"], ["literal", []]],
      paint: {
        "line-width": 4.2,
        "line-opacity": 0.95
      }
    });
  }
}

function setDisruptedRouteLayer(routeIds) {
  const layerId = "routes-disrupted";
  if (!map.getLayer(layerId)) return;
  map.setFilter(layerId, ["in", ["get", "id"], ["literal", routeIds]]);
}

function upsertCapitals() {
  const fc = {
    type: "FeatureCollection",
    features: Object.entries(capitals).map(([code, c]) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: c.lngLat },
      properties: { code, name: c.name }
    }))
  };

  if (map.getSource("capitals")) {
    map.getSource("capitals").setData(fc);
  } else {
    map.addSource("capitals", { type: "geojson", data: fc });
    map.addLayer({
      id: "capitals",
      type: "circle",
      source: "capitals",
      paint: {
        "circle-radius": 5.5,
        "circle-opacity": 0.92
      }
    });
    map.addLayer({
      id: "capitals-label",
      type: "symbol",
      source: "capitals",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.2],
        "text-anchor": "top"
      },
      paint: {
        "text-opacity": 0.92
      }
    });
  }
}

// ------------------------ Build networks ------------------------
function routeId(from, to, kind) {
  return `${kind}:${from}-${to}`;
}

function buildAllToAllBaseRoutes() {
  const codes = Object.keys(capitals);
  const out = [];

  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const a = codes[i], b = codes[j];
      const A = capitals[a].lngLat;
      const B = capitals[b].lngLat;

      const coordsAB = makeArc(A, B, 90, 0.14);
      const coordsBA = makeArc(B, A, 90, 0.14);

      out.push({ id: routeId(a, b, "base"), from: a, to: b, kind: "base", coords: coordsAB });
      out.push({ id: routeId(b, a, "base"), from: b, to: a, kind: "base", coords: coordsBA });
    }
  }
  return out;
}

function buildHubNetwork(hubCode) {
  const codes = Object.keys(capitals).filter(c => c !== hubCode);
  const out = [];

  for (const c of codes) {
    const A = capitals[c].lngLat;
    const H = capitals[hubCode].lngLat;
    out.push({
      id: routeId(c, hubCode, "hub"),
      from: c, to: hubCode, kind: "hub",
      coords: makeArc(A, H, 90, 0.12)
    });
    out.push({
      id: routeId(hubCode, c, "hub"),
      from: hubCode, to: c, kind: "hub",
      coords: makeArc(H, A, 90, 0.12)
    });
  }
  return out;
}

function addReroutesFromPaths(paths) {
  const out = [];
  for (const path of paths) {
    // path is like ["DXB","ROM","LON"], create legs: DXB->ROM and ROM->LON (both directions for plane reroute? we create directed legs only)
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i], to = path[i + 1];
      if (!capitals[from] || !capitals[to]) continue;

      const A = capitals[from].lngLat;
      const B = capitals[to].lngLat;

      out.push({
        id: routeId(from, to, "reroute"),
        from, to, kind: "reroute",
        coords: makeArc(A, B, 90, 0.10)
      });
    }
  }
  return out;
}

// ------------------------ Planes ------------------------
function makePlane(route) {
  return {
    id: `plane:${Math.random().toString(16).slice(2)}`,
    routeId: route.id,
    t: Math.random(),                  // progress 0..1
    speed: 0.0009 + Math.random()*0.0012  // per frame-ish
  };
}

function rebuildPlanesForRoutes(maxPlanes = 26) {
  planes = [];
  const flyable = routes.filter(r => r.kind !== "reroute"); // planes originate on base/hub; reroutes used when corrected
  if (!flyable.length) return;

  const n = Math.min(maxPlanes, flyable.length);
  for (let i = 0; i < n; i++) {
    const r = flyable[i % flyable.length];
    planes.push(makePlane(r));
  }
}

function getRouteById(id) {
  return routes.find(r => r.id === id);
}

function pointAlong(coords, t) {
  const n = coords.length;
  if (n === 0) return null;
  const idx = clamp01(t) * (n - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(n - 1, i0 + 1);
  const frac = idx - i0;

  const p0 = coords[i0];
  const p1 = coords[i1];
  return [lerp(p0[0], p1[0], frac), lerp(p0[1], p1[1], frac)];
}

function headingAlong(coords, t) {
  const n = coords.length;
  if (n < 2) return 0;
  const idx = clamp01(t) * (n - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(n - 1, i0 + 1);
  const p0 = coords[i0];
  const p1 = coords[i1];
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  return Math.atan2(dy, dx);
}

function resizeOverlay() {
  const rect = map.getCanvas().getBoundingClientRect();
  overlay.width = Math.round(rect.width * devicePixelRatio);
  overlay.height = Math.round(rect.height * devicePixelRatio);
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function drawPlanes() {
  const w = overlay.clientWidth;
  const h = overlay.clientHeight;
  ctx.clearRect(0, 0, w, h);

  for (const p of planes) {
    const r = getRouteById(p.routeId);
    if (!r) continue;

    const paused = pausedRouteIds.has(p.routeId);
    if (!paused) {
      p.t += p.speed;
      if (p.t > 1) p.t = 0;
    }

    const lngLat = pointAlong(r.coords, p.t);
    if (!lngLat) continue;

    const pt = map.project(lngLat);
    const ang = headingAlong(r.coords, p.t);

    // draw sprite
    if (planeImgReady) {
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(ang);
      const s = 18;
      ctx.drawImage(planeImg, -s/2, -s/2, s, s);
      ctx.restore();
    } else {
      // fallback dot
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI*2);
      ctx.fill();
    }
  }
}

// ------------------------ Dashboard (simple predictive view) ------------------------
const dashBody = document.getElementById("dashBody");
const dashNote = document.getElementById("dashNote");

function computeDashboard() {
  const totalPlanes = planes.length;
  let pausedPlanes = 0;
  for (const p of planes) if (pausedRouteIds.has(p.routeId)) pausedPlanes++;

  const activeRoutes = routes.filter(r => r.kind !== "reroute").length;
  const reroutes = routes.filter(r => r.kind === "reroute").length;

  // simple heuristics: “delay index” scales with paused
  const delayIndex = totalPlanes ? Math.round((pausedPlanes / totalPlanes) * 100) : 0;
  const flowIndex = Math.max(0, 100 - delayIndex);

  return [
    ["Flights (active)", `${totalPlanes - pausedPlanes}/${totalPlanes}`],
    ["Paused flights", `${pausedPlanes}`],
    ["Routes (base/hub)", `${activeRoutes}`],
    ["Corrections (reroutes)", `${reroutes}`],
    ["Flow index", `${flowIndex}`],
    ["Delay index", `${delayIndex}`]
  ];
}

function renderDashboard() {
  dashBody.innerHTML = "";
  const rows = computeDashboard();
  for (const [k, v] of rows) {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    td1.textContent = k;
    td2.textContent = v;
    tr.appendChild(td1);
    tr.appendChild(td2);
    dashBody.appendChild(tr);
  }

  const scenario = (activeScenarioIndex >= 0) ? SCENARIOS[activeScenarioIndex] : null;
  dashNote.textContent = scenario
    ? `Scenario: ${scenario.name}`
    : "Scenario: Normal operations";
}

// ------------------------ Actions ------------------------
function setNormal() {
  pausedRouteIds.clear();
  setDisruptedRouteLayer([]);
  activeScenarioIndex = -1;

  routes = buildAllToAllBaseRoutes();
  upsertRouteSource();
  rebuildPlanesForRoutes();
  renderDashboard();

  log("✅ Normal: global all-to-all network active.");
  speak("Normal operations. Global network is active.");
  fitToVisibleNetwork(80);
}

function setHubDubai() {
  pausedRouteIds.clear();
  setDisruptedRouteLayer([]);
  activeScenarioIndex = -1;

  if (!capitals.DXB) {
    log("❌ Dubai not present; cannot hub.");
    return;
  }

  routes = buildHubNetwork("DXB");
  upsertRouteSource();
  rebuildPlanesForRoutes();
  renderDashboard();

  log("🛫 Hub Dubai: star network via Dubai.");
  speak("Hub mode enabled. Dubai is the central hub.");
  fitToVisibleNetwork(90);
}

function nextDisrupt() {
  // move to next scenario
  activeScenarioIndex = (activeScenarioIndex + 1) % SCENARIOS.length;
  const sc = SCENARIOS[activeScenarioIndex];

  // Only disrupt base/hub routes that exist
  pausedRouteIds.clear();
  const disruptedIds = [];

  for (const [a, b] of sc.disruptPairs) {
    // pause both directions if present
    const ids = [
      routeId(a, b, "base"), routeId(b, a, "base"),
      routeId(a, b, "hub"),  routeId(b, a, "hub")
    ];

    for (const id of ids) {
      const exists = routes.some(r => r.id === id);
      if (exists) {
        pausedRouteIds.add(id);
        disruptedIds.push(id);
      }
    }
  }

  setDisruptedRouteLayer(disruptedIds);

  log(`⚠️ Disrupt (Scenario ${activeScenarioIndex + 1}/${SCENARIOS.length}): ${sc.name}`);
  speak(sc.narrationDisrupt);
  renderDashboard();
}

function correctScenario() {
  if (activeScenarioIndex < 0) {
    log("ℹ️ No active disruption. Use Disrupt first.");
    speak("No disruption is active. Trigger a disruption first.");
    return;
  }

  const sc = SCENARIOS[activeScenarioIndex];

  // remove old reroutes
  routes = routes.filter(r => r.kind !== "reroute");

  // add reroutes for this scenario
  const newReroutes = addReroutesFromPaths(sc.correctionPaths);
  routes.push(...newReroutes);

  // Move any paused planes onto first available reroute that starts at their route.from
  // fallback: just unpause them.
  const rerouteStarts = new Map(); // fromCode -> [routeIds...]
  for (const r of newReroutes) {
    if (!rerouteStarts.has(r.from)) rerouteStarts.set(r.from, []);
    rerouteStarts.get(r.from).push(r.id);
  }

  for (const p of planes) {
    if (!pausedRouteIds.has(p.routeId)) continue;
    const currentRoute = getRouteById(p.routeId);
    if (!currentRoute) continue;

    const candidates = rerouteStarts.get(currentRoute.from) || [];
    if (candidates.length) {
      p.routeId = candidates[Math.floor(Math.random() * candidates.length)];
      p.t = 0; // start reroute
    }
  }

  // now unpause disrupted routes (corridor restored by correction)
  pausedRouteIds.clear();
  setDisruptedRouteLayer([]);

  upsertRouteSource();
  renderDashboard();

  log(`✅ Correct: applied correction for "${sc.name}"`);
  speak(sc.narrationCorrect);
}

// ------------------------ Add cities ------------------------
function addCity(city) {
  if (capitals[city.code]) {
    log(`ℹ️ ${city.name} already exists.`);
    return;
  }
  capitals[city.code] = { name: city.name, lngLat: city.lngLat };

  upsertCapitals();

  // rebuild base network if we are in normal mode (all-to-all), else keep current topology and just refit
  // For simplicity: if we're in hub mode, rebuild hub; if normal, rebuild all-to-all.
  const inHub = routes.some(r => r.kind === "hub");
  const hubCode = "DXB";

  routes = inHub ? buildHubNetwork(hubCode) : buildAllToAllBaseRoutes();
  upsertRouteSource();
  rebuildPlanesForRoutes();
  renderDashboard();

  log(`➕ Added city: ${city.name}`);
  speak(`${city.name} added to the network.`);
  fitToVisibleNetwork(90);
}

// ------------------------ Chat parsing ------------------------
function handleCommand(raw) {
  const cmd = raw.trim().toLowerCase();

  if (!cmd) return;

  if (cmd === "normal") return setNormal();
  if (cmd === "disrupt") return nextDisrupt();
  if (cmd === "correct") return correctScenario();

  if (cmd === "add paris" || cmd === "paris") return addCity(ADD_PARIS);
  if (cmd === "add vienna" || cmd === "vienna") return addCity(ADD_VIENNA);

  if (cmd === "hub dubai" || cmd === "dubai hub" || cmd === "hub dxb") return setHubDubai();

  log(`❓ Unknown command: "${raw}". Try: Disrupt, Correct, Normal, Add Paris, Add Vienna, Hub Dubai`);
  speak("Command not recognized.");
}

// ------------------------ Wire up UI ------------------------
document.getElementById("btnNormal").addEventListener("click", setNormal);
document.getElementById("btnDisrupt").addEventListener("click", nextDisrupt);
document.getElementById("btnCorrect").addEventListener("click", correctScenario);

document.getElementById("btnAddParis").addEventListener("click", () => addCity(ADD_PARIS));
document.getElementById("btnAddVienna").addEventListener("click", () => addCity(ADD_VIENNA));
document.getElementById("btnHubDubai").addEventListener("click", setHubDubai);

document.getElementById("btnSend").addEventListener("click", () => {
  const v = inputEl.value;
  inputEl.value = "";
  log(`> ${v}`);
  handleCommand(v);
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = inputEl.value;
    inputEl.value = "";
    log(`> ${v}`);
    handleCommand(v);
  }
});

// ------------------------ Render loop ------------------------
function frame() {
  drawPlanes();
  renderDashboard();
  requestAnimationFrame(frame);
}

// ------------------------ Initialize ------------------------
map.on("load", () => {
  upsertCapitals();

  // start in normal mode (all-to-all global)
  routes = buildAllToAllBaseRoutes();
  upsertRouteSource();

  rebuildPlanesForRoutes();
  renderDashboard();

  resizeOverlay();
  window.addEventListener("resize", resizeOverlay);
  map.on("resize", resizeOverlay);

  log("🟢 Loaded. Commands: Disrupt, Correct, Normal, Add Paris, Add Vienna, Hub Dubai");
  fitToVisibleNetwork(90);
  frame();
});

