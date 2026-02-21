/* =========================
REPLACE ENTIRE script.js WITH THIS
Adds:
- Tehran (THR) + Caracas (CCS)
- FRA<->LON and DEL<->HKG corridors
- Two disruptions:
  1) Disrupt Routes (existing corridor scenarios)
  2) Disrupt Countries (bypass an airport completely while preserving connectivity)
- Brand logos handled in index.html CSS/HTML

========================= */

const STYLE_URL = "style.json";

/* ---------- Map init (global view) ---------- */
const MAP_INIT = { center:[35, 25], zoom: 2.2, minZoom: 1.5, maxZoom: 6.5 };

/* ---------- Assets ---------- */
const PLANE_IMG_SRC = "airplane_topview.png";
const PLANE_SIZE_MULT = 1.05;

/* ---------- Ops assumptions ---------- */
const AIRCRAFT_CAPACITY_TONS = 18;
const AIRSPEED_KMPH = 870;
const FUEL_BURN_KG_PER_KM = 3.1;

/* ---------- Master Nodes (all airports we may reference) ---------- */
const NODES_MASTER = {
  DXB: { name:"Dubai",       lon:55.2708,  lat:25.2048 },
  FRA: { name:"Frankfurt",   lon:8.6821,   lat:50.1109 },
  LON: { name:"London",      lon:-0.1276,  lat:51.5072 },
  ROM: { name:"Rome",        lon:12.4964,  lat:41.9028 },
  NYC: { name:"New York",    lon:-74.0060, lat:40.7128 },
  CHI: { name:"Chicago",     lon:-87.6298, lat:41.8781 },
  HKG: { name:"Hong Kong",   lon:114.1694, lat:22.3193 },
  TYO: { name:"Tokyo",       lon:139.6917, lat:35.6895 },

  // Baseline cities you added earlier
  MOW: { name:"Moscow",      lon:37.6173,  lat:55.7558 },
  KBL: { name:"Kabul",       lon:69.2075,  lat:34.5553 },
  DEL: { name:"New Delhi",   lon:77.2090,  lat:28.6139 },

  // NEW: Tehran + Caracas
  THR: { name:"Tehran",      lon:51.3890,  lat:35.6892 },
  CCS: { name:"Caracas",     lon:-66.9036, lat:10.4806 }
};

/* ---------- Base Nodes (always present) ---------- */
const BASE_NODES = {
  DXB: NODES_MASTER.DXB,
  FRA: NODES_MASTER.FRA,
  LON: NODES_MASTER.LON,
  ROM: NODES_MASTER.ROM,
  NYC: NODES_MASTER.NYC,
  CHI: NODES_MASTER.CHI,
  HKG: NODES_MASTER.HKG,
  TYO: NODES_MASTER.TYO,
  MOW: NODES_MASTER.MOW,
  KBL: NODES_MASTER.KBL,
  DEL: NODES_MASTER.DEL,

  // NEW airports included in baseline (always visible + used)
  THR: NODES_MASTER.THR,
  CCS: NODES_MASTER.CCS
};

/* ---------- Optional Cities (only via buttons) ---------- */
const OPTIONAL_CITIES = {
  PAR: { name:"Paris",  lon:2.3522,  lat:48.8566 },
  VIE: { name:"Vienna", lon:16.3738, lat:48.2082 }
};

const HUB = "DXB";

/* Normal mode: curated corridors WITHOUT hub-and-spoke */
const SIGNATURE_CORRIDORS_NORMAL = [
  ["LON","NYC"],
  ["FRA","ROM"],
  ["HKG","TYO"],
  ["NYC","CHI"],

  // regional richness
  ["FRA","MOW"],
  ["DEL","KBL"],
  ["DEL","DXB"],
  ["ROM","DXB"],

  // NEW requested links
  ["FRA","LON"],
  ["DEL","HKG"],

  // NEW Tehran + Caracas trajectories (active corridors)
  ["MOW","THR"],
  ["THR","KBL"],
  ["THR","DEL"],
  ["CCS","NYC"],
  ["CCS","ROM"]
];

/* Hub mode: hub-and-spoke + a few signature showpiece links */
const SIGNATURE_CORRIDORS_HUB = [
  ["LON","NYC"],
  ["FRA","ROM"],
  ["HKG","TYO"],
  ["NYC","CHI"],

  // NEW requested links still visible in hub mode
  ["FRA","LON"],
  ["DEL","HKG"],

  // Ensure new airports appear even in hub view
  ["THR","DEL"],
  ["CCS","NYC"]
];

/* ---------- Utilities ---------- */
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function keyPair(A,B){ return [A,B].sort().join("-"); }
function getNode(code){
  return currentNodes[code] || NODES_MASTER[code] || null;
}

/* ---------- Map ---------- */
const map = new maplibregl.Map({
  container: "map",
  style: STYLE_URL,
  center: MAP_INIT.center,
  zoom: MAP_INIT.zoom,
  minZoom: MAP_INIT.minZoom,
  maxZoom: MAP_INIT.maxZoom,
  attributionControl: true
});
map.addControl(new maplibregl.NavigationControl({visualizePitch:false}),"top-left");

/* ---------- UI refs ---------- */
const scenarioPill = document.getElementById('scenarioPill');
const statsEl = document.getElementById('stats');
const toastEl = document.getElementById('toast');

/* ---------- Toast ---------- */
let toastTimer = null;
const BASE_TOAST_HTML = `Use the top buttons to drive the simulation:
<b>Hub Dubai</b>, <b>Disrupt Routes</b>, <b>Disrupt Countries</b>, <b>Correct</b>, <b>Normal</b>.
<small>Tip: click anywhere once to enable narration (browser policy). Then press “Narration”.</small>`;

function toast(msg, holdMs = 2600){
  if (!toastEl) return;
  toastEl.innerHTML = `${escapeHTML(msg)}<small>Flow: Hub Dubai → Disrupt → Correct → Normal</small>`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> { toastEl.innerHTML = BASE_TOAST_HTML; }, holdMs);
}

/* ---------- Speech (reliable) ---------- */
const synth = window.speechSynthesis;
let MUTED = true;                 // start muted
let VOICE = null;
let NARRATION_UNLOCKED = false;
let PENDING_SPEAK = null;

function unlockNarrationOnce(){
  if (NARRATION_UNLOCKED) return;
  NARRATION_UNLOCKED = true;
  try { synth.getVoices(); } catch(_) {}
}
function chooseVoice(){
  const voices = (synth && synth.getVoices) ? synth.getVoices() : [];
  if (!voices || !voices.length) return null;
  return voices.find(v => /en-|English/i.test(v.lang)) || voices[0];
}
if (synth) {
  synth.onvoiceschanged = () => {
    if (!VOICE) VOICE = chooseVoice();
    if (PENDING_SPEAK) {
      const line = PENDING_SPEAK;
      PENDING_SPEAK = null;
      speak(line);
    }
  };
}
function speak(line){
  if (!synth) return;
  if (!NARRATION_UNLOCKED) { PENDING_SPEAK = line; return; }
  if (MUTED) return;

  try { synth.cancel(); } catch(_) {}
  if (!VOICE) VOICE = chooseVoice();
  if (!VOICE) { PENDING_SPEAK = line; return; }

  const u = new SpeechSynthesisUtterance(String(line));
  u.voice = VOICE;
  u.rate = 0.95;
  u.pitch = 1.0;
  try { synth.speak(u); } catch(_) {}
}
document.addEventListener("pointerdown", unlockNarrationOnce, { once:true });

/* Narration toggle */
const btnMute = document.getElementById("btnMute");
function renderNarrationBtn(){
  if (!btnMute) return;
  btnMute.textContent = MUTED ? "🔇 Narration" : "🔊 Narration";
}
btnMute?.addEventListener("click", ()=>{
  unlockNarrationOnce();
  MUTED = !MUTED;
  renderNarrationBtn();
  if (MUTED) { try { synth.cancel(); } catch(_){}; toast("Narration muted."); }
  else { toast("Narration enabled."); speak("Narration enabled."); }
});
renderNarrationBtn();

/* ---------- Stats toggle ---------- */
document.getElementById("btnToggleStats")?.addEventListener("click", ()=>{
  const collapsed = statsEl.classList.toggle("collapsed");
  toast(collapsed ? "Dashboard collapsed." : "Dashboard expanded.");
});

/* ---------- Great-circle routes ---------- */
function greatCircle(a,b,n=160){
  const line = turf.greatCircle([a.lon,a.lat],[b.lon,b.lat],{npoints:n});
  return line.geometry.coordinates;
}

/* ---------- State ---------- */
let currentNodes = { ...BASE_NODES };
let ROUTES = [];
let ROUTE_MAP = new Map();
let PLANES = [];

let overlay=null, ctx=null, PLANE_IMG=null, PLANE_READY=false;

/* Modes */
let MODE = "normal";   // "normal" | "hub"

/* Route-disruption state (existing) */
let DISRUPTED_ROUTES = false;
let scenarioIndex = -1;

/* Country-disruption state (new) */
let DISRUPTED_COUNTRY = false;
let countryScenarioIndex = -1;
let ACTIVE_COUNTRY_BLOCK = null; // airport code

function setScenarioPill(text){
  if (scenarioPill) scenarioPill.textContent = text;
}

/* ---------- Canvas overlay ---------- */
function ensureCanvas(){
  overlay = document.getElementById("planesCanvas");
  if(!overlay){
    overlay = document.createElement("canvas");
    overlay.id = "planesCanvas";
    overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;";
    map.getContainer().appendChild(overlay);
  }
  ctx = overlay.getContext("2d");
  resizeCanvas();
}
function resizeCanvas(){
  if(!overlay) return;
  const base = map.getCanvas(), dpr = window.devicePixelRatio||1;
  overlay.width  = base.clientWidth * dpr;
  overlay.height = base.clientHeight * dpr;
  overlay.style.width  = base.clientWidth + "px";
  overlay.style.height = base.clientHeight + "px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", resizeCanvas);

/* ---------- Route cache ---------- */
function getArcCoords(A,B){
  const cached = ROUTE_MAP.get(`${A}-${B}`);
  if (cached) return cached;

  const a = getNode(A), b = getNode(B);
  if (!a || !b) return [];

  const coords = greatCircle(a,b,160);
  ROUTE_MAP.set(`${A}-${B}`, coords);
  ROUTE_MAP.set(`${B}-${A}`, [...coords].reverse());
  return coords;
}

/* ---------- Pair builders ---------- */
function buildPairsHubPlusSignature(){
  const pairs = [];
  const keys = Object.keys(currentNodes).filter(k=>k!==HUB);

  // hub spokes
  for (const K of keys) pairs.push([K, HUB]);

  // showpiece corridors
  for (const [A,B] of SIGNATURE_CORRIDORS_HUB){
    if (getNode(A) && getNode(B)) pairs.push([A,B]);
  }

  const seen = new Set();
  const out = [];
  for (const [A,B] of pairs){
    const k = keyPair(A,B);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([A,B]);
  }
  return out;
}

/* ---------- Build GeoJSON routes ---------- */
function rebuildRoutesFromPairs(pairs){
  ROUTES = [];
  ROUTE_MAP.clear();

  for (const [A,B] of pairs){
    const coords = getArcCoords(A,B);
    if (!coords || coords.length < 2) continue;

    ROUTES.push({
      type:"Feature",
      properties:{ id:`${A}-${B}`, A, B },
      geometry:{ type:"LineString", coordinates: coords }
    });
  }
}

/* ---------- Map layers ---------- */
function ensureRouteLayers(){
  const baseFC = { type:"FeatureCollection", features: ROUTES };

  if(!map.getSource("routes")) map.addSource("routes",{type:"geojson", data: baseFC});
  else map.getSource("routes").setData(baseFC);

  if(!map.getLayer("routes-glow")){
    map.addLayer({
      id: "routes-glow",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#4dd7ff",
        "line-opacity": 0.18,
        "line-width": 2.2,
        "line-blur": 1.2
      }
    });
  }

  if(!map.getLayer("routes-base")){
    map.addLayer({
      id: "routes-base",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.55,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          1.5, 0.35,
          2.5, 0.7,
          4.0, 1.1,
          6.0, 1.4
        ]
      }
    }, "routes-glow");
  }

  if(!map.getSource("alert")) map.addSource("alert",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
  if(!map.getLayer("alert-red")){
    map.addLayer({
      id:"alert-red", type:"line", source:"alert",
      layout:{ "line-cap":"round","line-join":"round" },
      paint:{ "line-color":"#ff5a6a","line-opacity":0.95,"line-width":4.6 }
    });
  }

  if(!map.getSource("fix")) map.addSource("fix",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
  if(!map.getLayer("fix-green")){
    map.addLayer({
      id:"fix-green", type:"line", source:"fix",
      layout:{ "line-cap":"round","line-join":"round" },
      paint:{ "line-color":"#00d08a","line-opacity":0.95,"line-width":5.2 }
    });
  }

  try { map.moveLayer("fix-green"); } catch(_) {}
}

function setAlertByPairs(pairs){
  const feats = [];
  for (const [A,B] of pairs){
    const coords = getArcCoords(A,B);
    if (!coords || coords.length < 2) continue;
    feats.push({ type:"Feature", properties:{ id:`${A}-${B}` }, geometry:{ type:"LineString", coordinates: coords } });
  }
  map.getSource("alert")?.setData({type:"FeatureCollection", features: feats});
}
function clearAlert(){ map.getSource("alert")?.setData({type:"FeatureCollection",features:[]}); }

function setFixFromPaths(paths){
  const feats = [];
  for (const path of paths){
    for (let i=0;i<path.length-1;i++){
      const from = path[i], to = path[i+1];
      const coords = getArcCoords(from,to);
      if (!coords || coords.length < 2) continue;
      feats.push({ type:"Feature", properties:{ id:`${from}-${to}` }, geometry:{ type:"LineString", coordinates: coords } });
    }
  }
  map.getSource("fix")?.setData({type:"FeatureCollection", features: feats});
}
function clearFix(){ map.getSource("fix")?.setData({type:"FeatureCollection",features:[]}); }

/* ---------- Capitals layer ---------- */
function upsertCapitals(){
  const features = Object.entries(currentNodes).map(([id, v]) => ({
    type: "Feature",
    properties: { id, name: v.name },
    geometry: { type: "Point", coordinates: [v.lon, v.lat] }
  }));
  const fc = { type:"FeatureCollection", features };

  if (map.getSource("capitals")) {
    map.getSource("capitals").setData(fc);
    return;
  }

  map.addSource("capitals", { type:"geojson", data: fc });

  map.addLayer({
    id: "capital-points",
    type: "circle",
    source: "capitals",
    paint: {
      "circle-radius": 7.5,
      "circle-color": "#ffd166",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
      "circle-opacity": 0.96
    }
  });

  map.addLayer({
    id: "capital-labels",
    type: "symbol",
    source: "capitals",
    layout: {
      "text-field": ["get","name"],
      "text-font": ["Open Sans Regular", "Noto Sans Regular", "Arial Unicode MS Regular"],
      "text-size": [
        "interpolate", ["linear"], ["zoom"],
        1.5, 10,
        3.0, 12,
        5.0, 14
      ],
      "text-offset": [0, 1.25],
      "text-anchor": "top",
      "text-allow-overlap": true
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "rgba(0,0,0,.75)",
      "text-halo-width": 1.4,
      "text-halo-blur": 0.2
    }
  });

  try { map.moveLayer("capital-points"); map.moveLayer("capital-labels"); } catch(_) {}
}

/* ---------- Planes ---------- */
const MAX_PLANES = 16;

function spawnPlane(id, A, B){
  const coords = getArcCoords(A,B);
  if (!coords || coords.length < 2) return;

  PLANES.push({
    id, A, B,
    path: coords,
    seg: 0,
    t: Math.random() * 0.6,
    speed: 0.85 + Math.random()*0.25,
    paused: false,
    affectedKey: null,
    reroute: null
  });
}

function buildPlanesForPairs(pairs){
  PLANES.length = 0;
  let idx = 1;
  const sampled = pairs.slice(0, Math.ceil(MAX_PLANES/2));
  for (const [A,B] of sampled){
    spawnPlane(`F${idx++}`, A, B);
    spawnPlane(`F${idx++}`, B, A);
  }
}

function prj(lon,lat){ return map.project({lng:lon,lat:lat}); }

function drawPlaneAt(p, theta){
  const z = map.getZoom();
  const baseAtZoom = (z <= 2) ? 34 : (z >= 5 ? 56 : 34 + (56 - 34) * ((z - 2) / (5 - 2)));
  const W = baseAtZoom * PLANE_SIZE_MULT;
  const H = W;

  // shadow
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(theta);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, H*0.18, W*0.40, H*0.16, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  if (PLANE_READY) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(theta);

    ctx.shadowColor = "rgba(255,255,220,0.55)";
    ctx.shadowBlur = 20;

    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1.05 + 0.18 * Math.sin(performance.now() / 320);
    ctx.drawImage(PLANE_IMG, -W/2, -H/2, W, H);

    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(theta);
    ctx.fillStyle="#ffd166";
    ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(9,12); ctx.lineTo(-9,12); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function advancePlane(PL, dt){
  if (PL.paused) return;

  const path = PL.reroute || PL.path;
  if (!path || path.length < 2) return;

  const pxPerSec = 88 * PL.speed * (0.9 + (map.getZoom() - 2) * 0.12);

  const a = path[PL.seg];
  const b = path[PL.seg + 1] || a;
  const aP = prj(a[0], a[1]);
  const bP = prj(b[0], b[1]);

  const segLen = Math.max(1, Math.hypot(bP.x - aP.x, bP.y - aP.y));
  let step = (pxPerSec * dt) / segLen;
  step = Math.max(step, 0.004);

  PL.t += step;

  while (PL.t >= 1) {
    PL.seg += 1;
    PL.t -= 1;
    if (PL.seg >= path.length - 1) {
      PL.seg = 0;
      PL.t = Math.random() * 0.2;
      break;
    }
  }
}

function drawPlanes(){
  ctx.clearRect(0,0,overlay.width,overlay.height);
  const now = performance.now()/1000;

  for(const PL of PLANES){
    const path = PL.reroute || PL.path;
    if (!path || path.length < 2) continue;

    const a = path[PL.seg];
    const b = path[PL.seg + 1] || a;

    const aP = prj(a[0],a[1]);
    const bP = prj(b[0],b[1]);

    const bob = Math.sin(now*1.4 + (PL.id.charCodeAt(0)%7))*1.6;
    const x = aP.x + (bP.x-aP.x)*PL.t;
    const y = aP.y + (bP.y-aP.y)*PL.t + bob;

    const bearing = turf.bearing([a[0],a[1]], [b[0],b[1]]);
    const theta = (bearing * Math.PI) / 180;

    drawPlaneAt({x,y}, theta);
  }
}

let __lastTS = performance.now();
function tick(){
  if(ctx){
    const now = performance.now();
    const dt = Math.min(0.05,(now-__lastTS)/1000); __lastTS = now;
    for(const PL of PLANES) advancePlane(PL, dt);
    drawPlanes();
  }
  requestAnimationFrame(tick);
}

/* ---------- Dashboard ---------- */
function pathLengthKm(coords){
  if (!coords || coords.length < 2) return 0;
  const feature = { type:"Feature", geometry:{ type:"LineString", coordinates: coords } };
  return turf.length(feature, { units:"kilometers" }) || 0;
}

function renderStats(){
  const tbody = document.querySelector("#statsTable tbody");
  if(!tbody) return;
  tbody.innerHTML = "";

  const caps = Object.keys(currentNodes);
  const rows = {};
  for(const k of caps){
    rows[k] = { label: currentNodes[k].name, flights:0, active:0, paused:0, tonnage_t:0, time_h:0, fuel_t:0 };
  }

  for(const PL of PLANES){
    const A = PL.A, B = PL.B;
    if(!rows[A] || !rows[B]) continue;

    rows[A].flights++; rows[B].flights++;
    if (PL.paused){ rows[A].paused++; rows[B].paused++; continue; }
    rows[A].active++; rows[B].active++;

    const usedPath = PL.reroute || PL.path;
    const distKm = pathLengthKm(usedPath);
    const timeHr = distKm / AIRSPEED_KMPH;
    const fuelKg = FUEL_BURN_KG_PER_KM * distKm;

    rows[A].tonnage_t += AIRCRAFT_CAPACITY_TONS;
    rows[B].tonnage_t += AIRCRAFT_CAPACITY_TONS;

    rows[A].time_h += timeHr; rows[B].time_h += timeHr;
    rows[A].fuel_t += fuelKg/1000; rows[B].fuel_t += fuelKg/1000;
  }

  for(const k of caps){
    const r = rows[k];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(r.label)}</td>
      <td>${r.flights}</td>
      <td class="pos">+${r.active}</td>
      <td class="neg">-${r.paused}</td>
      <td>${r.tonnage_t.toFixed(0)}</td>
      <td>${r.time_h.toFixed(1)}</td>
      <td>${r.fuel_t.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ---------- Camera fit ---------- */
function fitToNodes(){
  const b = new maplibregl.LngLatBounds();
  Object.values(currentNodes).forEach(c=>b.extend([c.lon,c.lat]));
  map.fitBounds(b, {
    padding: { top: 90, left: 90, right: 90, bottom: 110 },
    duration: 950,
    maxZoom: 3.8
  });
}

/* ---------- ROUTE DISRUPTION SCENARIOS (existing) ---------- */
const ROUTE_SCENARIOS = [
  {
    name: "North Atlantic jetstream turbulence",
    disruptPairs: [["LON","NYC"]],
    correctionPaths: [
      ["LON","FRA","NYC"],
      ["NYC","CHI","LON"]
    ],
    disruptNarration:
      "Disruption detected. North Atlantic turbulence is forcing capacity reductions on the London to New York corridor. Impacted flights are paused.",
    correctNarration:
      "Correction applied. Flights are rerouted via Frankfurt and Chicago to stabilize flow and maintain service levels."
  },
  {
    name: "Gulf airspace constraint",
    disruptPairs: [["DXB","HKG"], ["DXB","LON"]],
    correctionPaths: [
      ["DXB","ROM","LON"],
      ["DXB","TYO","HKG"]
    ],
    disruptNarration:
      "Disruption detected. Gulf airspace constraints are affecting Dubai links to London and Hong Kong. Impacted flights are paused.",
    correctNarration:
      "Correction applied. Rerouting via Rome and Tokyo to preserve connectivity while avoiding constrained corridors."
  },
  {
    name: "East Asia corridor congestion",
    disruptPairs: [["HKG","TYO"]],
    correctionPaths: [["HKG","DXB","TYO"]],
    disruptNarration:
      "Disruption detected. East Asia corridor congestion is rising between Hong Kong and Tokyo. Affected flights are paused.",
    correctNarration:
      "Correction applied. Routing via Dubai to smooth congestion and restore network balance."
  }
];

/* ---------- COUNTRY DISRUPTION SCENARIOS (NEW) ----------
Each scenario:
- block: airport to bypass completely
- affectedPairs: red highlight on routes touching that airport
- bypassPairs: green routes to keep others connected without the blocked airport
*/
const COUNTRY_SCENARIOS = [
  {
    name: "Iran airspace closure (bypass Tehran)",
    block: "THR",
    affectedPairs: [["MOW","THR"], ["THR","KBL"], ["THR","DEL"]],
    bypassPairs: [["MOW","KBL"], ["MOW","DEL"], ["KBL","DEL"]],
    narration:
      "Country disruption detected. Tehran is unavailable. Flights are rerouted to bypass Tehran while preserving Moscow, Kabul, and New Delhi connectivity."
  },
  {
    name: "Venezuela airport disruption (bypass Caracas)",
    block: "CCS",
    affectedPairs: [["CCS","NYC"], ["CCS","ROM"]],
    bypassPairs: [["NYC","ROM"]],
    narration:
      "Country disruption detected. Caracas is unavailable. Connectivity is preserved by rerouting transatlantic flow directly between New York and Rome."
  },
  {
    name: "Afghanistan constraint (bypass Kabul)",
    block: "KBL",
    affectedPairs: [["DEL","KBL"], ["THR","KBL"]],
    bypassPairs: [["DEL","THR"], ["DEL","MOW"]],
    narration:
      "Country disruption detected. Kabul is unavailable. New Delhi and Tehran remain connected, with alternate links added to preserve regional reach."
  },
  {
    name: "Hong Kong capacity restriction (bypass Hong Kong)",
    block: "HKG",
    affectedPairs: [["DEL","HKG"], ["HKG","TYO"]],
    bypassPairs: [["DEL","TYO"]],
    narration:
      "Country disruption detected. Hong Kong is constrained. Network remains stable by connecting New Delhi directly to Tokyo, bypassing Hong Kong."
  },
  {
    name: "Frankfurt strike (bypass Frankfurt)",
    block: "FRA",
    affectedPairs: [["FRA","ROM"], ["FRA","LON"], ["FRA","MOW"]],
    bypassPairs: [["LON","ROM"], ["LON","MOW"]],
    narration:
      "Country disruption detected. Frankfurt is unavailable. London becomes the bridging point to preserve Rome and Moscow connectivity."
  },
  {
    name: "Dubai slot disruption (bypass Dubai)",
    block: "DXB",
    affectedPairs: [["DEL","DXB"], ["ROM","DXB"]],
    bypassPairs: [["DEL","ROM"]],
    narration:
      "Country disruption detected. Dubai is constrained. Network remains connected via a direct New Delhi to Rome corridor."
  }
];

/* ---------- Network application ---------- */
function basePairsForMode(){
  if (MODE === "hub"){
    return buildPairsHubPlusSignature();
  }
  // Normal: curated corridors only
  const pairs = SIGNATURE_CORRIDORS_NORMAL.filter(([A,B]) => getNode(A) && getNode(B));
  const seen = new Set();
  const out = [];
  for (const [A,B] of pairs){
    const k = keyPair(A,B);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([A,B]);
  }
  return out;
}

function applyNetwork(){
  // Always start from base pairs
  let pairs = basePairsForMode();

  // If a country disruption is active, filter out blocked airport pairs and add bypasses
  if (DISRUPTED_COUNTRY && ACTIVE_COUNTRY_BLOCK){
    const blocked = ACTIVE_COUNTRY_BLOCK;
    const filtered = pairs.filter(([A,B]) => A !== blocked && B !== blocked);

    const sc = COUNTRY_SCENARIOS[countryScenarioIndex] || null;
    const bypass = (sc && sc.bypassPairs) ? sc.bypassPairs : [];

    pairs = [...filtered, ...bypass];

    // de-dup
    const seen = new Set();
    const out = [];
    for (const [A,B] of pairs){
      const k = keyPair(A,B);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([A,B]);
    }
    pairs = out;
  }

  rebuildRoutesFromPairs(pairs);
  ensureRouteLayers();
  buildPlanesForPairs(pairs);
  upsertCapitals();
  fitToNodes();
  renderStats();
}

/* ---------- Disruption clear ---------- */
function clearAllDisruptionState(){
  DISRUPTED_ROUTES = false;
  DISRUPTED_COUNTRY = false;
  ACTIVE_COUNTRY_BLOCK = null;

  for (const p of PLANES){
    p.paused=false; p.affectedKey=null; p.reroute=null;
    p.seg=0; p.t=Math.random()*0.2;
  }
  clearAlert();
  clearFix();
}

/* ---------- ROUTE DISRUPTION handlers ---------- */
function startDisruptRoutes(){
  if (DISRUPTED_ROUTES){
    toast("Route disruption already active. Press Correct.");
    return;
  }
  // If a country disruption is active, keep it, but route disruption overlays should still work
  scenarioIndex = (scenarioIndex + 1) % ROUTE_SCENARIOS.length;
  const sc = ROUTE_SCENARIOS[scenarioIndex];

  DISRUPTED_ROUTES = true;
  setScenarioPill(sc.name);

  setAlertByPairs(sc.disruptPairs);
  // keep country bypass layer if active? we keep fix-green for country, but route disruption uses fix-green too.
  // So: clearFix only if country disruption not active
  if (!DISRUPTED_COUNTRY) clearFix();

  const disruptedKeys = new Set(sc.disruptPairs.map(([A,B])=>keyPair(A,B)));
  for (const PL of PLANES){
    const k = keyPair(PL.A, PL.B);
    if (disruptedKeys.has(k)){
      PL.paused = true;
      PL.affectedKey = k;
    }
  }

  toast(`🟥 Disrupt Routes: ${sc.name}`);
  speak(sc.disruptNarration);
  renderStats();
}

function applyCorrect(){
  // Correct should clear BOTH disruptions and restore network baseline for current mode/nodes
  if (!DISRUPTED_ROUTES && !DISRUPTED_COUNTRY){
    toast("No active disruption. Press Disrupt Routes or Disrupt Countries first.");
    return;
  }

  // If route disruption was active, show its correction paths briefly, then restore
  if (DISRUPTED_ROUTES){
    const sc = ROUTE_SCENARIOS[scenarioIndex];
    setFixFromPaths(sc.correctionPaths);
    clearAlert();

    // unpause all paused planes
    for (const PL of PLANES){
      PL.paused = false;
      PL.affectedKey = null;
      PL.reroute = null;
    }

    toast(`🟩 Correction applied: ${sc.name}`);
    speak(sc.correctNarration);
  } else {
    // country disruption correction: just restore baseline
    toast("🟩 Country correction applied. Network restored.");
    speak("Country correction applied. Network restored.");
  }

  // Clear state and rebuild clean
  DISRUPTED_ROUTES = false;
  DISRUPTED_COUNTRY = false;
  ACTIVE_COUNTRY_BLOCK = null;
  clearAlert();
  // keep fix-green visible for a moment, then clear
  setTimeout(()=>clearFix(), 900);

  setScenarioPill("Normal operations");
  applyNetwork();
  renderStats();
}

/* ---------- COUNTRY DISRUPTION handler (NEW) ---------- */
function startDisruptCountries(){
  // If route disruption is active, require Correct first (avoids overlay collisions)
  if (DISRUPTED_ROUTES){
    toast("Route disruption is active. Press Correct first, then Disrupt Countries.");
    return;
  }

  countryScenarioIndex = (countryScenarioIndex + 1) % COUNTRY_SCENARIOS.length;
  const sc = COUNTRY_SCENARIOS[countryScenarioIndex];

  DISRUPTED_COUNTRY = true;
  ACTIVE_COUNTRY_BLOCK = sc.block;

  setScenarioPill(sc.name);

  // Red: affected pairs, Green: bypass pairs
  setAlertByPairs(sc.affectedPairs);
  setFixFromPaths(sc.bypassPairs.map(p => [p[0], p[1]]));

  // Apply network with block+bypass (rebuild routes + planes)
  applyNetwork();

  toast(`🟥 Disrupt Countries: ${sc.name}`);
  speak(sc.narration);
  renderStats();
}

/* ---------- Mode handlers ---------- */
function setHubDubai(){
  unlockNarrationOnce();
  clearAllDisruptionState();

  MODE = "hub";
  setScenarioPill("Normal operations");
  applyNetwork();

  toast("🟨 Hub Dubai enabled (hub-and-spoke).");
  speak("Hub Dubai enabled. Network operating in hub and spoke mode.");
}

function setNormal(){
  unlockNarrationOnce();
  clearAllDisruptionState();

  // RESET baseline: remove optional cities + remove hub mode
  currentNodes = { ...BASE_NODES };
  MODE = "normal";

  setScenarioPill("Normal operations");
  applyNetwork();

  toast("🟦 Normal baseline restored. Paris/Vienna removed. Dubai is not hub.");
  speak("Normal operations restored. Dubai is not operating as a hub.");
}

/* ---------- Optional city add ---------- */
function addCity(code){
  const C = (code||"").toUpperCase();
  const node = OPTIONAL_CITIES[C];
  if (!node){ toast(`Unknown city: ${code}`); return; }
  if (currentNodes[C]){ toast(`${node.name} already added.`); return; }

  currentNodes = { ...currentNodes, [C]: node };
  clearAllDisruptionState();
  applyNetwork();

  toast(`➕ Added ${node.name}.`);
  speak(`${node.name} added.`);
}

/* ---------- Button wiring ---------- */
document.getElementById('btnNormal')?.addEventListener('click', ()=>setNormal());
document.getElementById('btnHub')?.addEventListener('click', ()=>setHubDubai());

// NEW: split disruptions
document.getElementById('btnDisruptRoutes')?.addEventListener('click', ()=>startDisruptRoutes());
document.getElementById('btnDisruptCountries')?.addEventListener('click', ()=>startDisruptCountries());

document.getElementById('btnCorrect')?.addEventListener('click', ()=>applyCorrect());
document.getElementById('btnAddParis')?.addEventListener('click', ()=>addCity("PAR"));
document.getElementById('btnAddVienna')?.addEventListener('click', ()=>addCity("VIE"));

/* ---------- Boot ---------- */
map.on("load", async ()=>{
  map.on("error", (e)=>{ try{ console.error("Map error:", e && e.error || e); }catch(_){} });

  ensureCanvas();

  PLANE_IMG = new Image();
  PLANE_IMG.onload = ()=>{ PLANE_READY = true; };
  PLANE_IMG.onerror = ()=>{ PLANE_READY = false; };
  PLANE_IMG.src = PLANE_IMG_SRC + "?v=" + Date.now();

  // Default: NORMAL baseline (Dubai not hub; no Paris/Vienna)
  MODE = "normal";
  currentNodes = { ...BASE_NODES };
  applyNetwork();

  toast("Ready. Press Narration to enable voice, then try Disrupt Routes → Correct. Use Disrupt Countries for airport bypass scenarios.");
  setInterval(renderStats, 1200);
  requestAnimationFrame(tick);
});
