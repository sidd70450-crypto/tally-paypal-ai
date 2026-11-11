// Tally landing hero: a WebGL receipt printer that prints Tally's real PayPal
// sandbox actions onto curling paper. Three.js r160 + optional GSAP ScrollTrigger.
// Returns false (and touches nothing) if WebGL isn't available, so the page can
// keep its CSS fallback.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const ESPRESSO = 0x17110d;
const PAPER = "#f3ead9";
const INK = "#2b2018";

// Real records from our PayPal sandbox tests.
const SCENES = [
  { what: "INVOICE", amt: "344.00", id: "INV2-BCF4-NCD6-SJSJ-3DSR", note: "Northside Cafe · SENT" },
  { what: "SALE", amt: "24.00", id: "60R169244U374500N", note: "V60 dripper · PAID" },
  { what: "REFUND", amt: "-24.00", id: "50B5078515991153T", note: "beans arrived stale" },
  { what: "PAYOUT x3", amt: "-155.00", id: "6K4UFKFU9HGDJ", note: "3 contractors", hold: true },
  { what: "DISPUTES", amt: "0", id: "Agent Toolkit", note: "none open" },
];

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2")) || !!c.getContext("webgl");
  } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => t * t * (3 - 2 * t);

export async function initHero3D({ mount, hero, header }) {
  if (!mount || !webglAvailable()) return false;
  const mobile = matchMedia("(max-width: 980px)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  } catch { return false; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ESPRESSO);
  scene.fog = new THREE.Fog(ESPRESSO, 9, 16);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);

  // ---------- lighting: warm key with soft shadows, crema rim, low fill ----------
  scene.add(new THREE.AmbientLight(0xffe6cc, 0.18));
  const key = new THREE.SpotLight(0xffd2a0, 38, 22, 0.55, 0.75, 1.6);
  key.position.set(3.6, 4.2, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 6;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xf0a64a, 1.6);
  rim.position.set(-4, 2.5, -3.5);
  scene.add(rim);
  const fill = new THREE.PointLight(0xffc68a, 2.5, 8, 2);
  fill.position.set(-1.8, -1.2, 2.6);
  scene.add(fill);

  // ---------- the printer ----------
  const rig = new THREE.Group();
  scene.add(rig);
  key.target = rig;

  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x2e2219, roughness: 0.42, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.28, envMapIntensity: 0.9 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.62, 1.15, 6, 0.14), bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  rig.add(body);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(1.78, 0.08, 0.16, 3, 0.03), new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 0.6 }));
  lip.position.set(0, -0.2, 0.55);
  rig.add(lip);

  // Brand plate on the front face, drawn to a small canvas.
  const plate = document.createElement("canvas");
  plate.width = 512; plate.height = 96;
  const pg = plate.getContext("2d");
  const plateTex = new THREE.CanvasTexture(plate);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), new THREE.MeshStandardMaterial({ map: plateTex, transparent: true, roughness: 0.5 }));
  front.position.set(-0.18, 0.1, 0.577);
  rig.add(front);

  const ledMat = new THREE.MeshStandardMaterial({ color: 0x8fd4a4, emissive: 0x8fd4a4, emissiveIntensity: 2.2 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), ledMat);
  led.position.set(0.82, 0.12, 0.585);
  rig.add(led);

  // ---------- the paper: real geometry that hangs and curls ----------
  const W = 1.5, L = 3.5;
  const paperGeo = new THREE.PlaneGeometry(W, L, 1, 90);
  paperGeo.translate(0, -L / 2, 0);
  const base = paperGeo.attributes.position.array.slice();

  const CW = 640, CH = Math.round((CW * L) / W);
  const sheet = document.createElement("canvas");
  sheet.width = CW; sheet.height = CH;
  const g = sheet.getContext("2d");
  const paperTex = new THREE.CanvasTexture(sheet);
  paperTex.colorSpace = THREE.SRGBColorSpace;
  paperTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const paperMat = new THREE.MeshStandardMaterial({ map: paperTex, color: 0xd9cfbd, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, envMapIntensity: 0.25 });
  const paper = new THREE.Mesh(paperGeo, paperMat);
  paper.position.set(0, -0.22, 0.6);
  paper.castShadow = true; paper.receiveShadow = true;
  rig.add(paper);

  function bendPaper(time) {
    const pos = paperGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const y = base[i + 1];
      const t = -y / L; // 0 at the slot, 1 at the torn edge
      const curl = Math.pow(clamp01((t - 0.5) / 0.5), 2);
      pos[i] = base[i];
      pos[i + 1] = y + curl * 0.35;
      pos[i + 2] = 0.04 * t + curl * 0.75 + Math.sin(t * 10 + time * 1.4) * 0.012 * t;
    }
    paperGeo.attributes.position.needsUpdate = true;
    paperGeo.computeVertexNormals();
  }

  // ---------- floor, shadows and coffee beans ----------
  const FLOOR_Y = -3.55;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.5 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);

  const beanGeo = new THREE.SphereGeometry(0.1, 18, 12);
  beanGeo.scale(1, 0.6, 1.45);
  const beanMat = new THREE.MeshPhysicalMaterial({ color: 0x3b2112, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  const BEANS = mobile ? 22 : 48;
  const beans = new THREE.InstancedMesh(beanGeo, beanMat, BEANS);
  beans.castShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < BEANS; i++) {
    const a = rand() * Math.PI * 2, r = 1.1 + rand() * 2.6;
    p.set(Math.cos(a) * r * 1.2, FLOOR_Y + 0.06, Math.sin(a) * r * 0.8 + 0.6);
    e.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
    q.setFromEuler(e);
    const k = 0.8 + rand() * 0.45;
    s.set(k, k, k);
    beans.setMatrixAt(i, m4.compose(p, q, s));
  }
  scene.add(beans);

  // ---------- postprocessing: soft bloom for the LED and highlights ----------
  let composer = null;
  if (!mobile) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 0.97));
    composer.addPass(new OutputPass());
  }

  // ---------- drawing the receipt ----------
  await Promise.race([document.fonts?.load?.('700 34px "Courier Prime"'), sleep(1500)]).catch(() => {});
  const date = new Date().toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const entries = []; // newest first
  let feed = 0, dirty = true, printing = false;
  const EH = 168;

  function drawPlate() {
    pg.clearRect(0, 0, 512, 96);
    pg.fillStyle = "#b9a898";
    pg.font = '600 34px "Instrument Sans", system-ui, sans-serif';
    pg.textBaseline = "middle";
    pg.fillText("Tally · Ember & Oak", 10, 48);
    plateTex.needsUpdate = true;
  }
  drawPlate();

  function zigzagPath() {
    const tooth = 22, depth = 16;
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(CW, 0); g.lineTo(CW, CH - depth);
    for (let x = CW; x > 0; x -= tooth) { g.lineTo(x - tooth / 2, CH); g.lineTo(Math.max(0, x - tooth), CH - depth); }
    g.closePath();
  }
  function dashed(y) {
    g.save(); g.strokeStyle = "rgba(43,32,24,.45)"; g.lineWidth = 3; g.setLineDash([12, 9]);
    g.beginPath(); g.moveTo(40, y); g.lineTo(CW - 40, y); g.stroke(); g.restore();
  }
  function stamp(text, color, x, y) {
    g.save(); g.translate(x, y); g.rotate(-0.16);
    g.font = '800 30px "Instrument Sans", system-ui, sans-serif';
    const w = g.measureText(text).width + 28;
    g.globalAlpha = 0.85; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 5;
    g.strokeRect(-w / 2, -26, w, 52);
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 0, 2);
    g.restore();
  }
  function drawSheet() {
    g.clearRect(0, 0, CW, CH);
    g.save();
    zigzagPath(); g.clip();
    g.fillStyle = PAPER; g.fillRect(0, 0, CW, CH);
    const shade = g.createLinearGradient(0, 0, 0, 90);
    shade.addColorStop(0, "rgba(0,0,0,.28)"); shade.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = shade; g.fillRect(0, 0, CW, 90);
    g.fillStyle = INK; g.textBaseline = "alphabetic";
    let y = 80 - (1 - feed) * EH;
    for (const en of entries) {
      g.font = '700 40px "Courier Prime", monospace';
      g.textAlign = "left"; g.fillText(en.what.slice(0, en.typed), 44, y + 44);
      if (en.typed >= en.what.length) { g.textAlign = "right"; g.fillText(en.amt.slice(0, en.amtTyped), CW - 44, y + 44); }
      if (en.meta) {
        g.font = '400 27px "Courier Prime", monospace';
        g.textAlign = "left"; g.fillText(en.id, 44, y + 88);
        g.textAlign = "right"; g.fillText(en.note, CW - 44, y + 124);
      }
      if (en.stamp === "held") stamp("HELD · NEEDS OK", "#b9771a", CW * 0.45, y + 92);
      if (en.stamp === "ok") stamp("APPROVED", "#2f8a53", CW * 0.45, y + 92);
      dashed(y + EH - 14);
      y += EH;
    }
    g.textAlign = "center";
    g.font = '700 38px "Courier Prime", monospace'; g.fillText("EMBER & OAK COFFEE", CW / 2, y + 56);
    g.font = '400 27px "Courier Prime", monospace';
    g.fillText("Tally clerk · PayPal sandbox", CW / 2, y + 96);
    g.fillText(date, CW / 2, y + 132);
    g.restore();
    paperTex.needsUpdate = true;
  }

  async function printLoop() {
    for (;;) {
      for (const sc of SCENES) {
        const en = { ...sc, typed: 0, amtTyped: 0, meta: false, stamp: null };
        entries.unshift(en);
        if (entries.length > 7) entries.pop();
        printing = true;
        const t0 = performance.now();
        while (feed < 1) { feed = clamp01((performance.now() - t0) / 500); feed = smooth(feed); dirty = true; await sleep(16); }
        for (let i = 1; i <= en.what.length; i++) { en.typed = i; dirty = true; await sleep(45); }
        for (let i = 1; i <= en.amt.length; i++) { en.amtTyped = i; dirty = true; await sleep(45); }
        en.meta = true; dirty = true;
        printing = false;
        if (en.hold) {
          await sleep(500); en.stamp = "held"; dirty = true;
          await sleep(1800); en.stamp = "ok"; dirty = true;
        }
        await sleep(1500);
        feed = 0;
      }
    }
  }

  // ---------- camera choreography ----------
  const camStart = new THREE.Vector3(3.3, 0.5, 6.6), lookStart = new THREE.Vector3(0, -1.35, 0.4);
  const camEnd = new THREE.Vector3(0.45, 0.1, 3.6), lookEnd = new THREE.Vector3(0, -1.05, 0.7);
  const camPos = new THREE.Vector3(), look = new THREE.Vector3();
  let scrollP = 0, mx = 0, my = 0, pmx = 0, pmy = 0;

  if (!mobile && window.gsap && window.ScrollTrigger) {
    window.ScrollTrigger.create({
      trigger: hero,
      start: () => `top ${header ? header.offsetHeight : 0}px`,
      end: "+=95%",
      pin: true,
      scrub: 0.8,
      onUpdate: (self) => { scrollP = self.progress; },
    });
  }
  hero.addEventListener("pointermove", (ev) => {
    const r = hero.getBoundingClientRect();
    mx = (ev.clientX - r.left) / r.width - 0.5;
    my = (ev.clientY - r.top) / r.height - 0.5;
  });
  hero.addEventListener("pointerleave", () => { mx = 0; my = 0; });

  function resize() {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 40 : 32;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(mount);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    const time = clock.getElapsedTime();
    pmx += (mx - pmx) * 0.06; pmy += (my - pmy) * 0.06;
    const k = smooth(scrollP);
    camPos.lerpVectors(camStart, camEnd, k);
    look.lerpVectors(lookStart, lookEnd, k);
    camPos.x += pmx * (0.9 - k * 0.6); camPos.y += -pmy * (0.5 - k * 0.3);
    if (mobile) { camPos.x += Math.sin(time * 0.3) * 0.25; }
    camera.position.copy(camPos);
    camera.lookAt(look);
    rig.rotation.y = Math.sin(time * 0.35) * 0.04 - 0.12 * (1 - k);
    bendPaper(time);
    ledMat.emissiveIntensity = printing ? 2.6 + Math.sin(time * 18) * 1.4 : 2.2;
    ledMat.emissive.setHex(printing ? 0xf0a64a : 0x8fd4a4);
    if (dirty) { drawSheet(); dirty = false; }
    composer ? composer.render() : renderer.render(scene, camera);
  }

  // Only render while the hero is on screen.
  let running = false;
  new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !running) { running = true; renderer.setAnimationLoop(frame); }
    else if (!en.isIntersecting && running) { running = false; renderer.setAnimationLoop(null); }
  }).observe(mount);

  drawSheet();
  frame();
  printLoop();
  return true;
}
