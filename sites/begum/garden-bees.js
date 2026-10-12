"use strict";
/* Begüm's decorative bees: randomized entrances, curves, speed and scale.
   This layer is visual only; scheduling, tasks and sync remain untouched. */
(() => {
  const garden = document.querySelector(".app-shell.garden");
  if (!garden || !("animate" in document.createElement("div"))) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const layer = document.createElement("div");
  layer.className = "garden-flight-layer";
  layer.setAttribute("aria-hidden", "true");
  garden.append(layer);

  const random = (low, high) => low + Math.random() * (high - low);
  const choose = items => items[Math.floor(Math.random() * items.length)];
  let active = null;
  let nextVisit = 0;

  function scheduleVisit(delay) {
    clearTimeout(nextVisit);
    if (!garden.isConnected || reducedMotion.matches || document.hidden) return;
    nextVisit = window.setTimeout(visit, delay);
  }

  function release() {
    if (!active) return;
    const flight = active;
    active = null;
    window.clearInterval(flight.pollenTimer);
    flight.animation.onfinish = null;
    flight.animation.cancel();
    flight.bee.remove();
  }

  // All five trajectories can be mirrored: entrances may be left, right,
  // top-left, top-right, bottom-left or bottom-right.
  function makePath(width, height) {
    const mode = choose(["cruise", "climb", "descend", "top-entry", "bottom-entry"]);
    const mirrored = Math.random() < 0.5;
    const w = Math.max(320, width);
    const h = Math.max(240, height);
    const x = position => mirrored ? w - position : position;
    const point = (px, py) => ({ x: x(px), y: py });
    let points;

    if (mode === "cruise") {
      const y = random(h * .16, h * .76);
      points = [
        point(-88, y),
        point(w * .29, y + random(-44, 30)),
        point(w * .72, y + random(-32, 44)),
        point(w + 88, y + random(-40, 35))
      ];
    } else if (mode === "climb") {
      points = [
        point(-88, random(h * .70, h * .88)),
        point(w * .29, random(h * .54, h * .72)),
        point(w * .68, random(h * .28, h * .46)),
        point(w + 88, random(h * .12, h * .28))
      ];
    } else if (mode === "descend") {
      points = [
        point(-88, random(h * .10, h * .28)),
        point(w * .28, random(h * .30, h * .44)),
        point(w * .70, random(h * .51, h * .70)),
        point(w + 88, random(h * .73, h * .87))
      ];
    } else if (mode === "top-entry") {
      points = [
        point(random(w * .08, w * .26), -88),
        point(w * .37, random(h * .12, h * .22)),
        point(w * .70, random(h * .32, h * .48)),
        point(w + 88, random(h * .48, h * .70))
      ];
    } else {
      points = [
        point(random(w * .08, w * .26), h + 88),
        point(w * .38, random(h * .72, h * .85)),
        point(w * .72, random(h * .40, h * .58)),
        point(w + 88, random(h * .15, h * .36))
      ];
    }
    return { mode, points, toRight: !mirrored };
  }

  function makeTransform(point, tilt, size) {
    return "translate3d(" + point.x + "px," + point.y +
      "px,0) rotate(" + tilt + "deg) scale(" + size + ")";
  }

  function sprinkle(bee, toRight) {
    if (document.hidden || reducedMotion.matches) return;
    const rect = bee.getBoundingClientRect();
    const canvas = layer.getBoundingClientRect();
    if (rect.right < canvas.left || rect.left > canvas.right ||
        rect.bottom < canvas.top || rect.top > canvas.bottom) return;

    // The body is behind the head; flip the pollen origin with flight direction.
    const pollen = document.createElement("span");
    pollen.className = "garden-pollen";
    pollen.style.left = (toRight
      ? rect.left - canvas.left + rect.width * .13
      : rect.right - canvas.left - rect.width * .13) + "px";
    pollen.style.top = (rect.top - canvas.top + rect.height * .68) + "px";
    pollen.style.setProperty("--pollen-x", ((toRight ? -1 : 1) * random(12, 38)) + "px");
    pollen.style.setProperty("--pollen-y", random(17, 47) + "px");
    pollen.style.setProperty("--pollen-size", random(3, 5.5) + "px");
    layer.append(pollen);
    pollen.addEventListener("animationend", () => pollen.remove(), { once: true });
  }

  function visit() {
    if (document.hidden || reducedMotion.matches || !garden.isConnected) return;
    if (active) return;

    const bounds = layer.getBoundingClientRect();
    const { points, toRight } = makePath(bounds.width, bounds.height);
    const distant = Math.random() < .35;
    const scale = distant ? random(.66, .91) : random(.98, 1.26);
    const bee = document.createElement("div");
    bee.className = "garden-flyer" + (toRight ? " is-reversed" : "") +
      (distant ? " is-distant" : " is-near");
    bee.innerHTML = '<div class="hero-bee"><span class="bee-wing"></span>' +
      '<span class="bee-wing right"></span><span class="bee-body"></span>' +
      '<span class="bee-head"></span><span class="bee-antenna"></span></div>';
    layer.append(bee);

    // Fast, leisurely and wandering visits vary significantly in speed.
    const speedBand = choose([[5800, 7600], [7900, 10700], [11000, 14600]]);
    const duration = random(speedBand[0], speedBand[1]);
    const tilt = [random(-12, 4), random(-8, 11), random(-10, 9), random(-5, 12)];
    const animation = bee.animate(points.map((point, index) => ({
      transform: makeTransform(point, tilt[index], scale),
      offset: [0, .31, .70, 1][index]
    })), { duration, easing: "linear", fill: "forwards" });

    const flight = { bee, animation, pollenTimer: 0 };
    active = flight;
    flight.pollenTimer = window.setInterval(() => {
      if (active !== flight) return;
      sprinkle(bee, toRight);
    }, random(170, 270));

    animation.onfinish = () => {
      if (active !== flight) return;
      release();
      scheduleVisit(random(11000, 25000));
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(nextVisit);
      release();
      layer.querySelectorAll(".garden-pollen").forEach(pollen => pollen.remove());
    } else {
      scheduleVisit(random(1800, 4200));
    }
  });

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      clearTimeout(nextVisit);
      release();
      layer.querySelectorAll(".garden-pollen").forEach(pollen => pollen.remove());
    } else if (!document.hidden) {
      scheduleVisit(random(1800, 4200));
    }
  });

  scheduleVisit(random(1800, 4200));
})();

/* Garden-only mail decoration; the shared mail client stays identical. */
(() => {
  const svgNS='http://www.w3.org/2000/svg';
  const canvas=document.createElement('canvas'),measure=canvas.getContext('2d');
  let fontRevision=0,queued=false,ready=false;
  function centerCounts(){
    document.querySelectorAll('.garden #mailDashboardButton .mailx-launch-count,.mailx-garden .mailx-rail-count').forEach(badge=>{
      const value=badge.textContent.trim();
      if(!/^\d+\+?$/.test(value))return;
      if(badge.querySelector('.mailx-flower-number')&&badge.dataset.flowerValue===value&&badge.dataset.flowerFont===String(fontRevision))return;
      const size=badge.classList.contains('mailx-rail-count')?17:18;
      let fontSize=12;
      measure.font='700 '+fontSize+'px Caveat, "Segoe Print", cursive';
      let bounds=measure.measureText(value);
      const inkWidth=bounds.actualBoundingBoxLeft+bounds.actualBoundingBoxRight;
      if(inkWidth>size-4){
        fontSize*= (size-4)/inkWidth;
        measure.font='700 '+fontSize+'px Caveat, "Segoe Print", cursive';
        bounds=measure.measureText(value);
      }
      const svg=document.createElementNS(svgNS,'svg');
      svg.setAttribute('viewBox','0 0 '+size+' '+size);
      svg.setAttribute('class','mailx-flower-number');
      const text=document.createElementNS(svgNS,'text');
      text.textContent=value;
      text.setAttribute('x',String(size/2-(bounds.actualBoundingBoxRight-bounds.actualBoundingBoxLeft)/2));
      text.setAttribute('y',String(size/2+(bounds.actualBoundingBoxAscent-bounds.actualBoundingBoxDescent)/2));
      text.setAttribute('style','font:700 '+fontSize+'px Caveat, "Segoe Print", cursive;fill:currentColor;stroke:none');
      svg.append(text);badge.replaceChildren(svg);
      badge.dataset.flowerValue=value;badge.dataset.flowerFont=String(fontRevision);
    });
  }
  function queueCounts(){
    if(queued)return;queued=true;
    requestAnimationFrame(()=>{queued=false;centerCounts();});
  }
  function install(){
    const bar=document.querySelector('.mailx-garden .mailx-topbar');
    const refresh=bar?.querySelector('#mailxRefresh');
    if(!refresh)return;
    // Stationary, softly colored bees matching the "Pick a letter" illustration.
    // Keep them separate from the Garden's decorative flyover animation.
    if(!bar.querySelector('.mailx-bee-parade')){
      refresh.insertAdjacentHTML('beforebegin', `
        <span class="mailx-bee-parade" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 48" preserveAspectRatio="xMidYMid meet">
            <defs>
              <g id="mailx-parade-bee-shape">
                <ellipse cx="-4" cy="-8" rx="7" ry="9" fill="#f7faf0" stroke="#dbe4cf"/>
                <ellipse cx="6" cy="-8" rx="7" ry="9" fill="#f7faf0" stroke="#dbe4cf"/>
                <ellipse rx="13" ry="8" fill="#edc775"/>
                <path d="M-4-7v14M3-7v14" stroke="#7a714c" stroke-width="3"/>
                <circle cx="12" cy="0" r="6" fill="#7a714c"/>
              </g>
            </defs>
            <path class="mailx-bee-trail" d="M18 27 C68 12 109 13 148 25 S230 35 268 23 S320 13 348 25"/>
            <g class="mailx-parade-bee" transform="translate(82 22) rotate(8) scale(1.18)"><use href="#mailx-parade-bee-shape"/></g>
            <g class="mailx-parade-bee" transform="translate(205 32) rotate(-8) scale(1.16)"><use href="#mailx-parade-bee-shape"/></g>
            <g class="mailx-parade-bee" transform="translate(312 21) rotate(7) scale(1.18)"><use href="#mailx-parade-bee-shape"/></g>
          </svg>
        </span>`);
    }
    if(ready)return;ready=true;discovery.disconnect();
    const counts=new MutationObserver(queueCounts);
    for(const target of [document.querySelector('#mailDashboardButton'),document.querySelector('.mailx-garden .mailx-nav')]){
      if(target)counts.observe(target,{childList:true,subtree:true,characterData:true});
    }
    queueCounts();
    document.fonts?.load('700 12px Caveat').then(()=>{fontRevision++;queueCounts();}).catch(()=>{});
  }
  // The deferred garden script can execute before the shared client mounts.
  const discovery=new MutationObserver(install);
  discovery.observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  install();
})();
