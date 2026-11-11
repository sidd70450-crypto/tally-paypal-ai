// Shared motion + interaction effects for all Tally pages.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Animated aurora + grid background (inserted once per page).
export function background() {
  if (document.querySelector(".aurora")) return;
  document.body.insertAdjacentHTML("afterbegin", '<div class="aurora" aria-hidden="true"><i></i><i></i><i></i></div><div class="gridlines" aria-hidden="true"></div>');
}

// Cursor-following spotlight on any .spot element (delegated, works for dynamic content).
export function spotlight() {
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(".spot");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });
}

// 3D tilt for [data-tilt] elements.
export function tilt(root = document) {
  if (reduced) return;
  root.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.("[data-tilt]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-y * 10).toFixed(2)}deg) rotateY(${(x * 12).toFixed(2)}deg) translateY(-4px)`;
  }, { passive: true });
  root.addEventListener("pointerout", (e) => {
    const el = e.target.closest?.("[data-tilt]");
    if (el && !el.contains(e.relatedTarget)) el.style.transform = "";
  });
}

// Fade/slide elements with .reveal in as they enter the viewport.
let io;
export function reveal() {
  io ||= new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }), { threshold: 0.08 });
  const els = [...document.querySelectorAll(".reveal:not(.in)")];
  // Anything already on screen animates in right away (doesn't depend on the
  // observer firing, which pauses in background tabs); the rest on scroll.
  setTimeout(() => {
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) el.classList.add("in");
      else io.observe(el);
    }
  }, 40);
}

// Tween a number inside an element.
const tweens = new WeakMap();
export function countTo(el, target, fmt = (n) => Math.round(n).toString(), ms = 900) {
  const from = tweens.get(el)?.value ?? 0;
  if (from === target && el.textContent) return;
  cancelAnimationFrame(tweens.get(el)?.raf);
  const t0 = performance.now();
  const state = { value: from };
  tweens.set(el, state);
  if (reduced) { state.value = target; el.textContent = fmt(target); return; }
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    state.value = from + (target - from) * eased;
    el.textContent = fmt(state.value);
    if (p < 1) state.raf = requestAnimationFrame(step);
    else { state.value = target; el.textContent = fmt(target); }
  };
  state.raf = requestAnimationFrame(step);
  if (from !== target) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
}

// Little burst of emoji from an element (money moved!).
export function burst(el, glyph = "💰", n = 10) {
  if (reduced || !el) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "coin";
    s.textContent = glyph;
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const d = 50 + Math.random() * 70;
    s.style.setProperty("--tx", `${Math.cos(a) * d}px`);
    s.style.setProperty("--ty", `${Math.sin(a) * d - 30}px`);
    s.style.setProperty("--rot", `${(Math.random() - 0.5) * 120}deg`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}

export function initFx() { background(); spotlight(); tilt(); reveal(); }
