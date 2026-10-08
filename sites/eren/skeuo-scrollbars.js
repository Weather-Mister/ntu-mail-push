/* Overlay sliders preserve native wheel, touch, and keyboard scrolling. */
(() => {
  const selectors = "#todoList,#coolDeadlines,.inbox,.rail";
  const layer = document.createElement("div");
  layer.id = "skeuo-slider-layer";
  layer.setAttribute("aria-hidden", "true");
  const entries = [];
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; entries.forEach(draw); });
  }
  function draw(s) {
    const el = s.el, r = el.getBoundingClientRect();
    const max = el.scrollHeight - el.clientHeight;
    const scrollStyle = getComputedStyle(el).overflowY;
    const top = Math.max(0, r.top + 5);
    const bottom = Math.min(innerHeight, r.bottom - 5);
    const active = (scrollStyle === "auto" || scrollStyle === "scroll") &&
      max > 2 && r.width > 35 && bottom - top > 46 &&
      r.right > 0 && r.left < innerWidth;
    el.classList.toggle("skeuo-can-scroll", active);
    s.track.hidden = !active;
    if (!active) return;
    const height = bottom - top;
    const compact = el.matches(".rail");
    s.track.classList.toggle("is-compact", compact);

    /* Read the actual CSS dimensions so Claude's knob can be resized in CSS
       without the scroll math drifting out of sync. */
    const knob = Math.min(height, s.thumb.offsetHeight || 49);
    const railWidth = s.track.offsetWidth || 33;
    const travel = Math.max(0, height - knob);
    const pos = travel * el.scrollTop / max;
    Object.assign(s, { top, max, travel, pos, knob });
    const railLeft = r.right - 3 - railWidth;
    s.track.style.cssText = "top:" + top + "px;left:" + Math.max(0,Math.min(innerWidth-railWidth,railLeft)) + "px;height:" + height + "px";
    s.thumb.style.top = pos + "px";
  }
  function attach(el, resize) {
    const track = document.createElement("div");
    track.className = "skeuo-slider";
    track.hidden = true;

    const thumb = document.createElement("div");
    thumb.className = "skeuo-slider-thumb slider-knob";

    track.appendChild(thumb);
    layer.appendChild(track);
    el.classList.add("skeuo-scroll-host");
    const s = {el, track, thumb, dragging:false};
    entries.push(s);
    const move = y => {
      if (!s.travel) return;
      el.scrollTop = s.max * Math.max(0, Math.min(s.travel, y-s.top-s.grab)) / s.travel;
      schedule();
    };
    track.addEventListener("pointerdown", e => {
      if (e.button !== 0 || track.hidden) return;
      const onKnob = thumb.contains(e.target);
      s.grab = onKnob ? e.clientY-s.top-s.pos : s.knob/2;
      s.dragging = true;
      track.classList.add("is-dragging");
      document.documentElement.classList.add("skeuo-slider-dragging");
      track.setPointerCapture(e.pointerId);
      if (!onKnob) move(e.clientY);
      e.preventDefault();
    });
    track.addEventListener("pointermove", e => { if (s.dragging) move(e.clientY); });
    function stop() {
      s.dragging = false;
      track.classList.remove("is-dragging");
      document.documentElement.classList.remove("skeuo-slider-dragging");
    }
    ["pointerup","pointercancel","lostpointercapture"].forEach(k=>track.addEventListener(k,stop));
    track.addEventListener("wheel", e => {
      el.scrollTop += e.deltaY * (e.deltaMode===1?16:e.deltaMode===2?el.clientHeight:1);
      e.preventDefault();
    }, {passive:false});
    resize.observe(el);
    new MutationObserver(schedule).observe(el,{childList:true,subtree:true});
  }
  function init() {
    if (document.getElementById("skeuo-slider-layer")) return;
    document.body.appendChild(layer);
    const resize = new ResizeObserver(schedule);
    document.querySelectorAll(selectors).forEach(el => attach(el,resize));
    const machine = document.querySelector(".machine");
    if (machine) {
      resize.observe(machine);
      new MutationObserver(schedule).observe(machine,{attributes:true,attributeFilter:["class"]});
    }
    const shell = document.querySelector(".mailx-shell");
    if (shell) {
      resize.observe(shell);
      new MutationObserver(schedule).observe(shell,{attributes:true,attributeFilter:["class"]});
    }
    document.addEventListener("scroll",schedule,true);
    document.addEventListener("input",schedule,true);
    window.addEventListener("resize",schedule);
    window.addEventListener("load",schedule);
    schedule();
  }
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
