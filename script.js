/* =========================
REPLACE ENTIRE script.js WITH THIS

Fixes + Guarantees:
1) Disrupt Countries shows ONLY red + disruption narration. Green shows ONLY on Correct + correction narration.
2) Green corridors NEVER auto-disappear. They persist until user clicks another major action (Normal/Hub/Add/Disrupt).
3) Guaranteed planes on:
   - All corridors touching CHI, DXB, KBL, THR (requested)
   - Plus must-have corridors: CCS<->NYC, CCS<->ROM, MOW<->THR, DEL<->HKG, FRA<->LON
4) More visible traffic: MAX_PLANES increased (safe default 48).

No style.json changes required.

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

/* ---------- Master Nodes ---------- */
const NODES_MASTER = {
  DXB: { name:"Dubai",        lon:55.2708,  lat:25.2048 },
  FRA: { name:"Frankfurt",    lon:8.6821,   lat:50.1109 },
  LON: { name:"London",       lon:-0.1276,  lat:51.5072 },
  ROM: { name:"Rome",         lon:12.4964,  lat:41.9028 },
  NYC: { name:"New York",     lon:-74.0060, lat:40.7128 },
  CHI: { name:"Chicago",      lon:-87.6298, lat:41.8781 },
  HKG: { name:"Hong Kong",    lon:114.1694, lat:22.3193 },
  TYO: { name:"Tokyo",        lon:139.6917, lat:35.6895 },

  MOW: { name:"Moscow",       lon:37.6173,  lat:55.7558 },
  KBL: { name:"Kabul",        lon:69.2075,  lat:34.5553 },
  DEL: { name:"New Delhi",    lon:77.2090,  lat:28.6139 },

  THR: { name:"Tehran",       lon:51.3890,  lat:35.6892 },
  CCS: { name:"Caracas",      lon:-66.9036, lat:10.4806 }
};

/* ---------- Base Nodes ---------- */
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
  THR: NODES_MASTER.THR,
  CCS: NODES_MASTER.CCS
};

/* ---------- Optional Cities ---------- */
const OPTIONAL_CITIES = {
  PAR: { name:"Paris",  lon:2.3522,  lat:48.8566 },
  VIE: { name:"Vienna", lon:16.3738, lat:48.2082 }
};

const HUB = "DXB";

/* ---------- Corridors ---------- */
const SIGNATURE_CORRIDORS_NORMAL = [
  ["LON","NYC"],
  ["FRA","ROM"],
  ["HKG","TYO"],
  ["NYC","CHI"],
  ["FRA","MOW"],
  ["DEL","KBL"],
  ["DEL","DXB"],
  ["ROM","DXB"],

  // must-have corridors
  ["FRA","LON"],
  ["DEL","HKG"],
  ["MOW","THR"],
  ["CCS","NYC"],
  ["CCS","ROM"],

  // extra richness
  ["THR","KBL"],
  ["THR","DEL"]
];

const SIGNATURE_CORRIDORS_HUB = [
  ["LON","NYC"],
  ["FRA","ROM"],
  ["HKG","TYO"],
  ["NYC","CHI"],

  // must-have corridors even in hub view
  ["FRA","LON"],
  ["DEL","HKG"],
  ["MOW","THR"],
  ["CCS","NYC"],
  ["CCS","ROM"]
];

/* ---------- Utilities ---------- */
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function keyPair(A,B){ return [A,B].sort().join("-"); }
function getNode(code){ return currentNodes[code] || NODES_MASTER[code] || null; }

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
const toastEl = document.getElementById('toast'); // toast may not exist; safe

/* ---------- Toast (optional) ---------- */
let toastTimer = null;
const BASE_TOAST_HTML = `Ready. Use buttons: Hub Dubai → Disrupt → Correct → Normal.`;

function toast(msg, holdMs = 2200){
  if (!toastEl) return;
  toastEl.innerHTML = `${escapeHTML(msg)}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> { toastEl.innerHTML = BASE_TOAST_HTML; }, holdMs);
}

/* ---------- Speech ---------- */
const synth = window.speechSynthesis;
let MUTED = true;
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

/* Disruption modes */
let DISRUPT_MODE = null; // null | "routes" | "countries"

/* For routes disruption */
let ROUTE_DISRUPTED = false;
let routeScenarioIndex = -1;

/* For country disruption */
let COUNTRY_DISRUPTED = false;
let countryScenarioIndex = -1;
let ACTIVE_COUNTRY_BLOCK = null;
let COUNTRY_PENDING_BYPASS = null;

/* Persist green overlays until user clears via another action */
let FIX_PERSIST = false;

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

function setFixByPairs(pairs){
  const feats = [];
  for (const [A,B] of pairs){
    const coords = getArcCoords(A,B);
    if (!coords || coords.length < 2) continue;
    feats.push({ type:"Feature", properties:{ id:`${A}-${B}` }, geometry:{ type:"LineString", coordinates: coords } });
  }
  map.getSource("fix")?.setData({type:"FeatureCollection", features: feats});
}
function clearFix(){ map.getSource("fix")?.setData({type:"FeatureCollection",features:[]}); }

function findHopPath(start, end, pairs, blockedNode = null){
  if (!start || !end) return null;
  if (start === end) return [start];
  if (blockedNode && (start === blockedNode || end === blockedNode)) return null;

  const graph = new Map();
  function addEdge(a,b){
    if (blockedNode && (a === blockedNode || b === blockedNode)) return;
    if (!graph.has(a)) graph.set(a, []);
    graph.get(a).push(b);
  }

  for (const [A,B] of pairs || []){
    addEdge(A,B);
    addEdge(B,A);
  }

  if (!graph.has(start) || !graph.has(end)) return null;

  const q = [start];
  const prev = new Map([[start, null]]);
  while (q.length){
    const node = q.shift();
    if (node === end) break;
    for (const next of graph.get(node) || []){
      if (prev.has(next)) continue;
      prev.set(next, node);
      q.push(next);
    }
  }

  if (!prev.has(end)) return null;
  const path = [];
  let cur = end;
  while (cur){
    path.push(cur);
    cur = prev.get(cur);
  }
  return path.reverse();
}

function buildCompositeRoute(hops){
  if (!hops || hops.length < 2) return null;
  const out = [];
  for (let i=0; i<hops.length-1; i++){
    const seg = getArcCoords(hops[i], hops[i+1]);
    if (!seg || seg.length < 2) return null;
    if (i === 0) out.push(...seg);
    else out.push(...seg.slice(1));
  }
  return out.length >= 2 ? out : null;
}

function getScenarioRerouteHops(sc, A, B){
  for (const rule of sc?.rerouteRules || []){
    if (keyPair(rule.pair?.[0], rule.pair?.[1]) !== keyPair(A,B)) continue;
    if (!rule.hops || rule.hops.length < 2) continue;
    if (rule.hops[0] === A) return [...rule.hops];
    if (rule.hops[rule.hops.length - 1] === A) return [...rule.hops].reverse();
  }
  return null;
}

function assignPlaneReroute(PL, rerouteCoords){
  PL.reroute = rerouteCoords || null;
  PL.paused = false;
  PL.affectedKey = null;
  PL.seg = 0;
  PL.t = Math.random() * 0.2;
}

function pickCountryBypassHops(PL, sc){
  if (sc?.block === "THR"){
    if (PL.A === "DEL" || PL.B === "DEL") return ["DEL","KBL","MOW"];
    if (PL.A === "MOW" || PL.B === "MOW") return ["MOW","KBL","DEL"];
    if (PL.A === "KBL" || PL.B === "KBL") return ["KBL","MOW","DEL"];
  }

  const bypassPairs = sc?.bypassPairs || [];
  if (!bypassPairs.length) return null;

  const anchor = (PL.A === sc.block) ? PL.B : PL.A;
  if (!anchor || anchor === sc.block) return null;

  // Prefer direct bypass from the affected anchor node.
  for (const [X,Y] of bypassPairs){
    if (X === anchor && Y !== sc.block) return [anchor, Y];
    if (Y === anchor && X !== sc.block) return [anchor, X];
  }

  // Fallback: find any reachable bypass node from anchor within bypass graph.
  const candidateTargets = [...new Set(
    bypassPairs.flat().filter((n)=>n !== anchor && n !== sc.block)
  )];
  for (const target of candidateTargets){
    const hops = findHopPath(anchor, target, bypassPairs, sc.block);
    if (hops && hops.length >= 2) return hops;
  }
  return null;
}

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
const MAX_PLANES = 48;

/* Always show flights on these corridors first (if present) */
const MUST_HAVE_FLIGHTS = [
  ["CCS","NYC"],
  ["CCS","ROM"],
  ["MOW","THR"],
  ["DEL","HKG"],
  ["FRA","LON"]
];

/* Requested: run flights on ALL corridors touching these cities */
const GUARANTEE_HUBS = new Set(["CHI","DXB","KBL","THR"]);

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

  const pairSet = new Set(pairs.map(([A,B])=>keyPair(A,B)));
  const used = new Set();

  function spawnBoth(A,B){
    if (PLANES.length + 2 > MAX_PLANES) return false;
    spawnPlane(`F${idx++}`, A, B);
    spawnPlane(`F${idx++}`, B, A);
    used.add(keyPair(A,B));
    return true;
  }

  // 1) Must-have corridors
  for (const [A,B] of MUST_HAVE_FLIGHTS){
    if (!pairSet.has(keyPair(A,B))) continue;
    if (used.has(keyPair(A,B))) continue;
    spawnBoth(A,B);
    if (PLANES.length >= MAX_PLANES) return;
  }

  // 2) ALL corridors touching CHI/DXB/KBL/THR
  for (const [A,B] of pairs){
    if (PLANES.length >= MAX_PLANES) return;
    if (!(GUARANTEE_HUBS.has(A) || GUARANTEE_HUBS.has(B))) continue;

    const k = keyPair(A,B);
    if (used.has(k)) continue;

    spawnBoth(A,B);
  }

  if (PLANES.length >= MAX_PLANES) return;

  // 3) Fill remaining slots with remaining corridors
  for (const [A,B] of pairs){
    if (PLANES.length >= MAX_PLANES) break;
    const k = keyPair(A,B);
    if (used.has(k)) continue;
    spawnBoth(A,B);
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

/* ---------- SCENARIOS ---------- */
const ROUTE_SCENARIOS = [
  {
    name: "London to New York corridor disruption",
    disruptPairs: [["LON","NYC"]],
    correctionPairs: [["LON","FRA"], ["FRA","NYC"]],
    rerouteRules: [
      { pair:["LON","NYC"], hops:["LON","FRA","NYC"] }
    ],
    disruptNarration:
      "Disruption detected. North Atlantic turbulence is forcing capacity reductions on the London to New York corridor. Impacted flights are paused.",
    correctNarration:
      "Correction applied. Flights are rerouted via Frankfurt to stabilize flow and maintain service levels."
  },
  {
    name: "Frankfurt to Dubai to Hong Kong corridor disruption",
    disruptPairs: [["FRA","DXB"], ["DXB","HKG"]],
    correctionPairs: [["FRA","DEL"], ["DEL","DXB"], ["DEL","HKG"]],
    rerouteRules: [
      { pair:["FRA","DXB"], hops:["FRA","DEL","DXB"] },
      { pair:["DXB","HKG"], hops:["DXB","DEL","HKG"] }
    ],
    disruptNarration:
      "Disruption detected. The Frankfurt to Dubai to Hong Kong flow is constrained. Impacted flights are paused.",
    correctNarration:
      "Correction applied. Rerouting through New Delhi to preserve Frankfurt, Dubai, and Hong Kong connectivity."
  },
  {
    name: "East Asia corridor congestion",
    disruptPairs: [["HKG","TYO"]],
    correctionPairs: [["HKG","DXB"], ["DXB","TYO"]],
    disruptNarration:
      "Disruption detected. East Asia corridor congestion is rising between Hong Kong and Tokyo. Affected flights are paused.",
    correctNarration:
      "Correction applied. Routing via Dubai to smooth congestion and restore network balance."
  }
];

const COUNTRY_SCENARIOS = [
  {
    name: "Iran airspace closure (bypass Tehran)",
    block: "THR",
    affectedPairs: [["MOW","THR"], ["THR","KBL"], ["THR","DEL"]],
    bypassPairs: [["DEL","KBL"], ["KBL","MOW"]],
    disruptNarration:
      "Country disruption detected. Tehran is unavailable. Impacted corridors are paused. Press Correct to apply bypass corridors.",
    correctNarration:
      "Correction applied. Tehran is bypassed while Moscow, Kabul, and New Delhi remain connected."
  },
  {
    name: "Venezuela airport disruption (bypass Caracas)",
    block: "CCS",
    affectedPairs: [["CCS","NYC"], ["CCS","ROM"]],
    bypassPairs: [["NYC","ROM"]],
    disruptNarration:
      "Country disruption detected. Caracas is unavailable. Impacted corridors are paused. Press Correct to apply bypass corridors.",
    correctNarration:
      "Correction applied. Caracas is bypassed and connectivity is preserved via a direct New York to Rome corridor."
  },
  {
    name: "Hong Kong capacity restriction (bypass Hong Kong)",
    block: "HKG",
    affectedPairs: [["DEL","HKG"], ["HKG","TYO"]],
    bypassPairs: [["DEL","TYO"]],
    disruptNarration:
      "Country disruption detected. Hong Kong is constrained. Impacted corridors are paused. Press Correct to apply bypass corridors.",
    correctNarration:
      "Correction applied. Hong Kong is bypassed by routing New Delhi directly to Tokyo."
  },
  {
    name: "Frankfurt strike (bypass Frankfurt)",
    block: "FRA",
    affectedPairs: [["FRA","ROM"], ["FRA","LON"], ["FRA","MOW"]],
    bypassPairs: [["LON","ROM"], ["LON","MOW"]],
    disruptNarration:
      "Country disruption detected. Frankfurt is unavailable. Impacted corridors are paused. Press Correct to apply bypass corridors.",
    correctNarration:
      "Correction applied. Frankfurt is bypassed, with London acting as the bridging node."
  }
];

/* ---------- Network application ---------- */
function basePairsForMode(){
  if (MODE === "hub"){
    return buildPairsHubPlusSignature();
  }
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
  const pairs = basePairsForMode();
  rebuildRoutesFromPairs(pairs);
  ensureRouteLayers();
  buildPlanesForPairs(pairs);
  upsertCapitals();
  fitToNodes();
  renderStats();
}

/* ---------- Overlay clearing ---------- */
function clearOverlaysHard(){
  clearAlert();
  clearFix();
  FIX_PERSIST = false;
}

function clearAllState(){
  ROUTE_DISRUPTED = false;
  COUNTRY_DISRUPTED = false;
  DISRUPT_MODE = null;

  ACTIVE_COUNTRY_BLOCK = null;
  COUNTRY_PENDING_BYPASS = null;

  for (const p of PLANES){
    p.paused=false; p.affectedKey=null; p.reroute=null;
    p.seg=0; p.t=Math.random()*0.2;
  }

  clearOverlaysHard();
}

/* ---------- Actions ---------- */
function setNormal(){
  unlockNarrationOnce();
  clearAllState();

  currentNodes = { ...BASE_NODES };
  MODE = "normal";
  setScenarioPill("Normal operations");
  applyNetwork();

  toast("🟦 Normal baseline restored.");
  speak("Normal operations restored.");
}

function setHubDubai(){
  unlockNarrationOnce();
  clearAllState();

  MODE = "hub";
  setScenarioPill("Normal operations");
  applyNetwork();

  toast("🟨 Hub Dubai enabled.");
  speak("Hub Dubai enabled. Network operating in hub and spoke mode.");
}

function addCity(code){
  const C = (code||"").toUpperCase();
  const node = OPTIONAL_CITIES[C];
  if (!node){ toast(`Unknown city: ${code}`); return; }
  if (currentNodes[C]){ toast(`${node.name} already added.`); return; }

  clearAllState();
  currentNodes = { ...currentNodes, [C]: node };
  applyNetwork();

  toast(`➕ Added ${node.name}.`);
  speak(`${node.name} added.`);
}

/* ---------- Disrupt Routes ---------- */
function startDisruptRoutes(){
  if (COUNTRY_DISRUPTED){
    toast("Country disruption active. Press Correct or Normal first.");
    return;
  }
  if (ROUTE_DISRUPTED){
    toast("Route disruption already active. Press Correct.");
    return;
  }

  // New disrupt clears previous green overlays
  clearOverlaysHard();

  DISRUPT_MODE = "routes";
  routeScenarioIndex = (routeScenarioIndex + 1) % ROUTE_SCENARIOS.length;
  const sc = ROUTE_SCENARIOS[routeScenarioIndex];

  ROUTE_DISRUPTED = true;
  setScenarioPill(sc.name);

  // ONLY RED on disruption
  setAlertByPairs(sc.disruptPairs);

  // pause impacted flights (only those exact pairs)
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

/* ---------- Disrupt Countries ---------- */
function startDisruptCountries(){
  if (ROUTE_DISRUPTED){
    toast("Route disruption active. Press Correct or Normal first.");
    return;
  }
  if (COUNTRY_DISRUPTED){
    toast("Country disruption already active. Press Correct.");
    return;
  }

  // New disrupt clears previous green overlays
  clearOverlaysHard();

  DISRUPT_MODE = "countries";
  countryScenarioIndex = (countryScenarioIndex + 1) % COUNTRY_SCENARIOS.length;
  const sc = COUNTRY_SCENARIOS[countryScenarioIndex];

  COUNTRY_DISRUPTED = true;
  ACTIVE_COUNTRY_BLOCK = sc.block;
  COUNTRY_PENDING_BYPASS = sc.bypassPairs;

  setScenarioPill(sc.name);

  // ONLY RED on disruption
  setAlertByPairs(sc.affectedPairs);

  // Pause planes touching blocked airport (demo effect)
  for (const PL of PLANES){
    if (PL.A === sc.block || PL.B === sc.block){
      PL.paused = true;
      PL.affectedKey = keyPair(PL.A, PL.B);
    }
  }

  toast(`🟥 Disrupt Countries: ${sc.name}`);
  speak(sc.disruptNarration);
  renderStats();
}

/* ---------- Correct (both types) ---------- */
function applyCorrect(){
  if (!ROUTE_DISRUPTED && !COUNTRY_DISRUPTED){
    toast("No active disruption. Press Disrupt first.");
    return;
  }

  // remove RED always
  clearAlert();

  if (DISRUPT_MODE === "routes"){
    const sc = ROUTE_SCENARIOS[routeScenarioIndex];
    const disruptedKeys = new Set(sc.disruptPairs.map(([A,B])=>keyPair(A,B)));

    // GREEN correction persists
    setFixByPairs(sc.correctionPairs);
    FIX_PERSIST = true;

    // unpause all + reroute only impacted flights through correction graph
    for (const PL of PLANES){
      assignPlaneReroute(PL, null);

      if (disruptedKeys.has(keyPair(PL.A, PL.B))){
        const hops = getScenarioRerouteHops(sc, PL.A, PL.B)
          || findHopPath(PL.A, PL.B, sc.correctionPairs);
        const reroute = buildCompositeRoute(hops);
        if (reroute) assignPlaneReroute(PL, reroute);
      }
    }

    ROUTE_DISRUPTED = false;

    toast(`🟩 Correction applied: ${sc.name}`);
    speak(sc.correctNarration);
    renderStats();
    return;
  }

  if (DISRUPT_MODE === "countries"){
    const sc = COUNTRY_SCENARIOS[countryScenarioIndex];

    // GREEN bypass persists
    const bypass = COUNTRY_PENDING_BYPASS || [];
    setFixByPairs(bypass);
    FIX_PERSIST = true;

    // Apply bypass paths so impacted flights visibly follow corrected reroutes.
    for (const PL of PLANES){
      assignPlaneReroute(PL, null);

      if (PL.A === sc.block || PL.B === sc.block){
        const hops = pickCountryBypassHops(PL, sc);
        const reroute = buildCompositeRoute(hops);
        if (reroute){
          assignPlaneReroute(PL, reroute);
        } else {
          PL.paused = true;
        }
      }
    }

    COUNTRY_DISRUPTED = false;
    ACTIVE_COUNTRY_BLOCK = null;
    COUNTRY_PENDING_BYPASS = null;

    toast(`🟩 Correction applied: ${sc.name}`);
    speak(sc.correctNarration);
    renderStats();
    return;
  }
}

/* ---------- Button wiring ---------- */
document.getElementById('btnNormal')?.addEventListener('click', ()=>setNormal());
document.getElementById('btnHub')?.addEventListener('click', ()=>setHubDubai());
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

  MODE = "normal";
  currentNodes = { ...BASE_NODES };
  applyNetwork();

  if (toastEl) toast("Ready.");
  setInterval(renderStats, 1200);
  requestAnimationFrame(tick);
});
