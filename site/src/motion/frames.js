import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { Replica } from "../replica/replica.js";
import { $$, REDUCE } from "./env.js";
import { holds } from "./holds.js";

/* =========================================================
   Phone: one narrow live replica per scene (variant C)
   ========================================================= */
export function initFrames() {
  const PREV = {
    open: "library",
    conversation: "open",
    messages: "tree",
    context: "open",
    launch: "library",
  };
  $$(".m-frame").forEach((frame) => {
    const id = frame.dataset.mstep;
    const W = 520,
      H = id === "launch" ? 700 : 640;
    let rp = null;
    const size = () => {
      const w = frame.clientWidth || 1;
      frame.style.height = `${Math.round((w / W) * H)}px`;
      if (rp) gsap.set(rp.root, { scale: w / W, transformOrigin: "0 0", x: 0, y: 0 });
    };
    const build = () => {
      if (rp) return;
      rp = new Replica(frame, { w: W, h: H, collapsed: true, interactive: false, cursor: !REDUCE });
      if (PREV[id]) rp.setInstant(PREV[id]);
      if (REDUCE) rp.setInstant(id);
      size();
    };
    size();
    ScrollTrigger.create({ trigger: frame, start: "top bottom+=500", once: true, onEnter: build });
    if (!REDUCE) {
      // play while the frame is in view (centre past 62% of the viewport, the whole frame
      // visible); scrolling away mid-run resets it so it plays from the start next time
      let finished = false;
      ScrollTrigger.create({
        trigger: frame,
        start: "center 62%",
        end: "bottom 15%",
        onToggle: async (st) => {
          build();
          if (finished) return;
          if (!st.isActive) {
            holds.delete(frame);
            rp.setInstant(PREV[id]);
            return;
          }
          holds.add(frame);
          const run = rp.run;
          await rp.runStep(id);
          finished = rp.run === run + 1; // nothing newer started: it ran to the end
          // the tour lingers a beat on the result before moving on
          if (finished) setTimeout(() => holds.delete(frame), 1500);
        },
      });
    }
    addEventListener("resize", size);
  });
}
