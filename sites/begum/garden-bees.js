"use strict";
/* Tiny, decorative garden visitors. Independent of schedule, tasks and sync. */
(() => {
  const garden = document.querySelector(".app-shell.garden");
  if (!garden || !("animate" in document.createElement("div"))) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const layer = document.createElement("div");
  layer.className = "garden-flight-layer";
  layer.setAttribute("aria-hidden", "true");
  garden.append(layer);

  let active = null;
  let nextVisit = 0;
  let lastPollen = 0;

  function scheduleVisit(delay) {
    clearTimeout(nextVisit);
    nextVisit = window.setTimeout(visit, delay);
  }

  function release() {
    if (!active) return;
    window.clearInterval(active.pollenTimer);
    active.animation.cancel();
    active.bee.remove();
    active = null;
  }

  function dust(bee, leftToRight) {
    if (reduceMotion.matches || document.hidden) return;
    const frame = bee.getBoundingClientRect();
    const canvas = layer.getBoundingClientRect();
    if (frame.right < canvas.left || frame.left > canvas.right) return;
    const pollen = document.createElement("span");
    pollen.className = "garden-pollen";
    pollen.style.left = (frame.left - canvas.left + (leftToRight ? 9 : frame.width - 9)) + "px";
    pollen.style.top = (frame.top - canvas.top + frame.height * 0.67) + "px";
    pollen.style.setProperty("--pollen-x", (leftToRight ? -1 : 1) * (15 + Math.random() * 23) + "px");
    pollen.style.setProperty("--pollen-y", (18 + Math.random() * 28) + "px");
    pollen.style.setProperty("--pollen-size", (3 + Math.random() * 3) + "px");
    layer.append(pollen);
    pollen.addEventListener("animationend", () => pollen.remove(), { once: true });
  }

  function visit() {
    if (reduceMotion.matches || document.hidden || !garden.isConnected) {
      scheduleVisit(18000);
      return;
    }
    if (active) return;
    const leftToRight = Math.random() < 0.5;
    const bounds = layer.getBoundingClientRect();
    const span = Math.max(300, bounds.width);
    const yStart = Math.max(52, Math.min(bounds.height - 80, bounds.height * (0.19 + Math.random() * 0.48)));
    const yEnd = Math.max(52, Math.min(bounds.height - 80, yStart + (Math.random() - .5) * 90));
    const bee = document.createElement("div");
    bee.className = "garden-flyer" + (leftToRight ? " is-reversed" : "");
    bee.innerHTML = '<div class="hero-bee"><span class="bee-wing"></span><span class="bee-wing right"></span><span class="bee-body"></span><span class="bee-head"></span><span class="bee-antenna"></span></div>';
    layer.append(bee);
    const startX = leftToRight ? -70 : span + 70;
    const endX = leftToRight ? span + 70 : -70;
    const duration = 8200 + Math.round(Math.random() * 3500);
    const animation = bee.animate([
      { transform: `translate3d(${startX}px,${yStart}px,0)`, offset: 0 },
      { transform: `translate3d(${startX + (endX-startX)*.31}px,${yStart-16}px,0)`, offset: .31 },
      { transform: `translate3d(${startX + (endX-startX)*.68}px,${yEnd+13}px,0)`, offset: .68 },
      { transform: `translate3d(${endX}px,${yEnd}px,0)`, offset: 1 }
    ], { duration, easing: "linear", fill: "forwards" });
    active = { bee, animation, pollenTimer: 0 };
    lastPollen = 0;
    active.pollenTimer = window.setInterval(() => {
      const now = performance.now();
      if (now - lastPollen > 180) {
        lastPollen = now;
        dust(bee, leftToRight);
      }
    }, 210);
    animation.onfinish = () => {
      release();
      scheduleVisit(14000 + Math.random() * 19000);
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) release();
    else if (!reduceMotion.matches) scheduleVisit(3500 + Math.random() * 5000);
  });
  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) release();
    else if (!document.hidden) scheduleVisit(5000);
  });
  if (!reduceMotion.matches) scheduleVisit(1800 + Math.random() * 2400);
})();
