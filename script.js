/* =========================
REPLACE ENTIRE script.js WITH THIS
Premium + performant + intelligent:
- Curated global network (not all-to-all) so it looks intentional
- Default = Hub Dubai (beautiful, readable)
- 3 disruption scenarios (cycle) + smart corrections (reroute legs)
- Planes capped for performance
- Fixes speech autoplay via gesture unlock
- Removes duplicate upsertCapitals bug
========================= */

const STYLE_URL = "style.json";

/* ---------- Map init (global view) ---------- */
const MAP_INIT = { center:[35, 25], zoom: 2.2, minZoom: 1.5, maxZoom: 6.5 };

/* ---------- Assets ---------- */
const PLANE_IMG_SRC = "airplane_topview.png";
const PLANE_SIZE_MULT = 1.05;

/* ---------- Ops assumptions ---------- */
const AIRCRAFT_CAPACITY_TONS = 18;     // widebody-ish for global vibe
const AIRSPEED_KMPH = 870;
const FUEL_BURN_KG_PER_KM = 3.1;

/* ---------- Cities (premium global set) ---------- */
const NODES = {
  DXB: { name:"Dubai",      lon:55.2708,  lat:25.2048 },
  FRA: { name:"Frankfurt",  lon:8.6821,   lat:50.1109 },
  LON: { name:"London",     lon:-0.1276,  lat:51.5072 },
  ROM: { name:"Rome",       lon:12.4964,  lat:41.9028 },
  NYC: { name:"New York",   lon:-74.0060, lat:40.7128 },
  CHI: { name:"Chicago",    lon:-87.6298, lat:41.8781 },
  HKG: { name:"Hong Kong",  lon:114.1694, lat:22.3193 },
  TYO: { name:"Tokyo",      lon:139.6917, lat:35.6895 }
};

const NEW_CITIES = {
  PAR: { name:"Paris",  lon:2.3522,  lat:48.8566 },
  VIE: { name:"Vienna", lon:16.3738, lat:48.2082 }
};

/* ---------- Network design (curated, premium) ----------
We avoid all-to-all clutter. We use:
- Hub Dubai star (default)
- A few signature “premium corridors” that look intelligent
*/
const HUB = "DXB";

// signature corridors (unordered pairs)
const SIGNATURE_CORRIDORS = [
  ["LON","NYC"],   // transatlantic
  ["FRA","ROM"],   // europe corridor
  ["HKG","TYO"],   // east asia corridor
  ["DXB","HKG"],   // hub to asia
  ["DXB","LON"],   // hub to europe
  ["NYC","CHI"]    // domestic
];

/* ---------- Scenarios (cycle) ----------
Each scenario:
- disruptPairs: unordered pairs (pause both directions)
- correctionPaths: list of paths (A->...->B) as legs, shown green
*/
const SCENARIOS = [
  {
    name: "North Atlantic jetstream turbulence",
    disruptPairs: [["LON","NYC"]],
    correctionPaths: [
      ["LON","FRA","NYC"],    // Europe hop to shift altitude corridor
      ["NYC","CHI","LON"]     // alternate pattern (visual richness)
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
    correctionPaths: [
      ["HKG","DXB","TYO"]
    ],
    disruptNarration:
      "Disruption detected. East Asia corridor congestion is rising between Hong Kong and Tokyo. Affected flights are paused.",
    correctNarration:
      "Correction applied. Routing via Dubai to smooth congestion and restore network balance."
  }
];

/* ---------- Utilities ---------- */
function escapeHTML(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function nowStamp(){ return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }

// unordered key helper
function keyPair(A,B){ return [A,B].sort().join("-"); }

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

/* ---------- UI elements ---------- */
const msgs = document.getElementById('msgs');
const input = document.getElementById('chatInput');
const send  = document.getElementById('chatSend');
const muteBtn = document.getElementById('muteBtn');
const clearBtn = document.getElementById('clearBtn');
const modeBadge = document.getElementById('modeBadge');
const scenarioPill = document.getElementById('scenarioPill');

function pushMsg(t, kind='system'){
  const d = document.createElement('div');
  d.className = `msg ${kind}`;
  d.innerHTML = `${escapeHTML(t)}<small>${nowStamp()}</small>`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight + 200;
}

/* ---------- Speech (gesture unlock) ---------- */
const synth = window.speechSynthesis;
let MUTED=false, VOICE=null, NARRATION_UNLOCKED=false;

function unlockNarrationOnce(){
  if (NARRATION_UNLOCKED) return;
  NARRATION_UNLOCKED = true;
  try { synth.cancel(); } catch(_) {}
  // silent prime
  try {
    const u = new SpeechSynthesisUtterance("Narration enabled");
    u.volume = 0;
    synth.speak(u);
  } catch(_) {}
}

function speak(line){
  if (!synth || MUTED) { try{ synth && synth.cancel(); }catch(_){}; return; }
  if (!NARRATION_UNLOCKED) return; // autoplay-safe: only after user gesture

  try { synth.cancel(); } catch(_) {}

  const u = new SpeechSynthesisUtterance(String(line));
  const voices = synth.getVoices();
  if (!VOICE && voices && voices.length){
    VOICE = voices.find(v => /en-|English/i.test(v.lang)) || voices[0];
  }
  if (!VOICE){
    synth.onvoiceschanged = () => {
      const vs = synth.getVoices();
      VOICE = vs.find(v => /en-|English/i.test(v.lang)) || vs[0];
    };
  }
  if (VOICE) u.voice = VOICE;
  u.rate = 0.95;
  u.pitch = 1.0;

  try { synth.speak(u); } catch(_) {}
}

clearBtn.addEventListener('click', ()=>{ msgs.innerHTML=''; });
muteBtn.addEventListener('click', ()=>{
  MUTED = !MUTED;
  muteBtn.textContent = MUTED ? '🔇 Unmute' : '🔊 Mute';
  if (MUTED) { try { synth.cancel(); } catch(_){} }
});

/* ---------- Buttons ---------- */
document.getElementById('btnNormal')?.addEventListener('click', ()=>handleCommand('normal'));
document.getElementById('btnHub')?.addEventListener('click', ()=>handleCommand('hub dubai'));
document.getElementById('btnDisrupt')?.addEventListener('click', ()=>handleCommand('disrupt'));
document.getElementById('btnCorrect')?.addEventListener('click', ()=>handleCommand('correct'));
document.getElementById('btnAddParis')?.addEventListener('click', ()=>handleCommand('add paris'));
document.getElementById('btnAddVienna')?.addEventListener('click', ()=>handleCommand('add vienna'));

send.addEventListener('click', ()=>handleCommand((input.value||'').trim()));
input.addEventListener('keydown',(e)=>{ if(e.key==='Enter') handleCommand((input.value||'').trim()); });

/* ---------- Routes + planes ---------- */
function greatCircle(a,b,n=160){
  const line = turf.greatCircle([a.lon,a.lat],[b.lon,b.lat],{npoints:n});
  return line.geometry.coordinates;
}

let currentNodes = {...NODES};
let ROUTES = [];            // features
let ROUTE_MAP = new Map();  // "A-B" -> coords (directional)
let PLANES = [];

let overlay=null, ctx=null, PLANE_IMG=null, PLANE_READY=false;

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

function getArcCoords(A,B){
  const c = ROUTE_MAP.get(`${A}-${B}`);
  if (c) return c;
  const a = currentNodes[A], b = currentNodes[B];
  if (!a || !b) return [];
  const coords = greatCircle(a,b,160);
  ROUTE_MAP.set(`${A}-${B}`, coords);
  ROUTE_MAP.set(`${B}-${A}`, [...coords].reverse());
  return coords;
}

/* Curated route builder:
   - hub: everyone <-> DXB
   - plus signature corridors
*/
function buildPairsHubPlusSignature(){
  const pairs = [];
  const keys = Object.keys(currentNodes).filter(k=>k!==HUB);

  // hub spokes
  for (const K of keys) pairs.push([K, HUB]);

  // signature corridors (only if both exist)
  for (const [A,B] of SIGNATURE_CORRIDORS){
    if (currentNodes[A] && currentNodes[B]) pairs.push([A,B]);
  }

  // de-dup unordered
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

function ensureRouteLayers(){
  const baseFC = { type:"FeatureCollection", features: ROUTES };

  if(!map.getSource("routes")) map.addSource("routes",{type:"geojson", data: baseFC});
  else map.getSource("routes").setData(baseFC);

  // Premium, minimal layers: one glow + one base
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

  // alert (red) and fix (green)
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
    const id = `${A}-${B}`;
    const coords = ROUTE_MAP.get(`${A}-${B}`) || ROUTE_MAP.get(`${B}-${A}`);
    feats.push({ type:"Feature", properties:{ id }, geometry:{ type:"LineString", coordinates: coords||[] } });
  }
  map.getSource("alert")?.setData({type:"FeatureCollection", features: feats});
}
function clearAlert(){ map.getSource("alert")?.setData({type:"FeatureCollection",features:[]}); }

function setFixFromPaths(paths){
  // paths is list of ["A","X","B"] etc -> build legs
  const feats = [];
  for (const path of paths){
    for (let i=0;i<path.length-1;i++){
      const from = path[i], to = path[i+1];
      const id = `${from}-${to}`;
      const coords = getArcCoords(from,to);
      feats.push({ type:"Feature", properties:{ id }, geometry:{ type:"LineString", coordinates: coords||[] } });
    }
  }
  map.getSource("fix")?.setData({type:"FeatureCollection", features: feats});
}
function clearFix(){ map.getSource("fix")?.setData({type:"FeatureCollection",features:[]}); }

/* ---------- Capitals layer (single function, no duplicates) ---------- */
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
const MAX_PLANES = 16; // cap for premium smoothness

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
    affectedKey: null,     // keyPair(A,B) if disrupted
    reroute: null          // optional reroute polyline (combined)
  });
}

function buildPlanesForPairs(pairs){
  PLANES.length = 0;
  let idx = 1;

  // sample pairs if too many
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
    let theta = (bearing * Math.PI) / 180;

    drawPlaneAt({x,y}, theta);
  }
}

/* ---------- Animation loop ---------- */
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
    padding: { top: 90, left: 90, right: 460, bottom: 90 },
    duration: 950,
    maxZoom: 3.8
  });
}

/* ---------- State + Scenarios ---------- */
let MODE = "hub"; // "hub" or "normal"
let DISRUPTED = false;
let scenarioIndex = -1;

function setModeBadge(){
  modeBadge.textContent = (MODE === "hub") ? "Hub Dubai" : "Normal";
}

function setScenarioPill(text){
  scenarioPill.textContent = text;
}

function applyNetwork(){
  // network depends on mode; we still keep curated look
  let pairs;
  if (MODE === "hub"){
    pairs = buildPairsHubPlusSignature();
  } else {
    // "Normal" = curated corridors only (still premium), not all-to-all
    pairs = [...SIGNATURE_CORRIDORS].filter(([A,B])=>currentNodes[A] && currentNodes[B]);
    // ensure at least some spokes to keep density readable
    if (currentNodes[HUB]) {
      for (const k of Object.keys(currentNodes)) if (k!==HUB) pairs.push([k,HUB]);
    }
    // de-dup
    const seen = new Set(); const out=[];
    for (const [A,B] of pairs){ const k=keyPair(A,B); if(seen.has(k)) continue; seen.add(k); out.push([A,B]); }
    pairs = out;
  }

  rebuildRoutesFromPairs(pairs);
  ensureRouteLayers();
  buildPlanesForPairs(pairs);
  upsertCapitals();
  fitToNodes();
  setModeBadge();
  renderStats();
}

function clearDisruptionState(){
  DISRUPTED = false;
  for (const p of PLANES){ p.paused=false; p.affectedKey=null; p.reroute=null; p.seg=0; p.t=Math.random()*0.2; }
  clearAlert();
  clearFix();
}

function startDisrupt(){
  if (DISRUPTED){
    pushMsg("A disruption is already active. Apply Correct, or switch mode.");
    return;
  }
  scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
  const sc = SCENARIOS[scenarioIndex];

  DISRUPTED = true;
  setScenarioPill(sc.name);

  // highlight disrupted corridors
  setAlertByPairs(sc.disruptPairs);
  clearFix();

  const disruptedKeys = new Set(sc.disruptPairs.map(([A,B])=>keyPair(A,B)));
  for (const PL of PLANES){
    const k = keyPair(PL.A, PL.B);
    if (disruptedKeys.has(k)){
      PL.paused = true;
      PL.affectedKey = k;
    }
  }

  pushMsg(`🟥 Disruption: ${sc.name}. Impacted corridors paused.`);
  speak(sc.disruptNarration);
  renderStats();
}

function applyCorrect(){
  if (!DISRUPTED){
    pushMsg("No active disruption. Click Disrupt first.");
    return;
  }
  const sc = SCENARIOS[scenarioIndex];

  // show fix paths in green
  setFixFromPaths(sc.correctionPaths);
  clearAlert();

  // Build combined polylines for each correction path (A->...->B)
  // Then reassign affected flights whose endpoints match the start/end of a correction path.
  const combined = [];
  for (const path of sc.correctionPaths){
    const forward = [];
    for (let i=0;i<path.length-1;i++){
      const seg = getArcCoords(path[i], path[i+1]);
      if (!seg || seg.length<2) continue;
      if (i===0) forward.push(...seg);
      else forward.push(...seg.slice(1));
    }
    if (forward.length >= 2){
      combined.push({ from: path[0], to: path[path.length-1], coords: forward, back: [...forward].reverse() });
    }
  }

  for (const PL of PLANES){
    if (!PL.affectedKey) continue;

    // match based on endpoints first (best UX)
    const match = combined.find(c => (c.from===PL.A && c.to===PL.B) || (c.from===PL.B && c.to===PL.A));
    if (match){
      PL.reroute = (match.from===PL.A && match.to===PL.B) ? match.coords : match.back;
      PL.seg = 0; PL.t = 0;
    }

    PL.paused = false;
    PL.affectedKey = null;
  }

  DISRUPTED = false;
  pushMsg(`🟩 Correction applied: ${sc.name}. Green reroutes active.`);
  speak(sc.correctNarration);
  renderStats();
}

function setHubDubai(){
  unlockNarrationOnce();
  clearDisruptionState();
  MODE = "hub";
  setScenarioPill("Normal operations");
  applyNetwork();
  pushMsg("🟨 Hub Dubai enabled. Network is now intentionally hub-and-spoke with signature corridors.");
  speak("Hub Dubai enabled. Network operating in hub and spoke mode.");
}

function setNormal(){
  unlockNarrationOnce();
  clearDisruptionState();
  MODE = "normal";
  setScenarioPill("Normal operations");
  applyNetwork();
  pushMsg("🟦 Normal operations. Curated global corridors active (premium view).");
  speak("Normal operations. Curated global corridors active.");
}

function addCity(code){
  const C = (code||"").toUpperCase();
  const node = NEW_CITIES[C];
  if (!node){ pushMsg(`Unknown city: ${code}`); return; }
  if (currentNodes[C]){ pushMsg(`${node.name} is already added.`); return; }

  currentNodes = { ...currentNodes, [C]: node };
  clearDisruptionState();
  applyNetwork();

  pushMsg(`➕ Added ${node.name}. Network recomputed and camera refit.`);
  speak(`${node.name} added. Network recomputed.`);
}

/* ---------- Command handler ---------- */
function handleCommand(raw){
  const cmd = (raw||'').trim();
  if(!cmd) return;

  unlockNarrationOnce();
  pushMsg(cmd,'user');
  if (input) input.value = "";

  const k = cmd.toLowerCase();

  if (k === "normal") setNormal();
  else if (k === "hub dubai" || k === "hub" || k === "dubai hub") setHubDubai();
  else if (k === "disrupt") startDisrupt();
  else if (k === "correct") applyCorrect();
  else if (k === "add paris" || k === "paris") addCity("PAR");
  else if (k === "add vienna" || k === "vienna") addCity("VIE");
  else pushMsg("Valid commands: Normal, Hub Dubai, Disrupt, Correct, Add Paris, Add Vienna.");
}

/* ---------- Boot ---------- */
map.on("load", async ()=>{
  map.on("error", (e)=>{ try{ console.error("Map error:", e && e.error || e); }catch(_){} });

  ensureCanvas();

  PLANE_IMG = new Image();
  PLANE_IMG.onload = ()=>{ PLANE_READY = true; };
  PLANE_IMG.onerror = ()=>{ PLANE_READY = false; };
  PLANE_IMG.src = PLANE_IMG_SRC + "?v=" + Date.now();

  // Default: premium hub mode
  MODE = "hub";
  applyNetwork();

  pushMsg("Ready. Try: Hub Dubai, Disrupt, Correct, Normal, Add Paris, Add Vienna.");
  // speech will begin only after first click/enter due to autoplay rules

  requestAnimationFrame(tick);

  // keep stats fresh (optional, lightweight)
  setInterval(renderStats, 1200);
});

