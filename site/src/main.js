// Landing page entry.
import "./styles/index.css";
import { mqDesk, mqReduce } from "./motion/env.js";
import { wire } from "./motion/wire.js";

// a breakpoint or motion-preference change needs a different layout: rebuild cleanly
const reload = () => location.reload();
mqDesk.addEventListener("change", reload);
mqReduce.addEventListener("change", reload);

// Wire once the fonts are in (scene geometry depends on them), one frame after the CSS hero
// entrance starts, so that entrance is already on the compositor when the long build runs.
document.fonts.ready.then(() => requestAnimationFrame(() => setTimeout(wire)));
