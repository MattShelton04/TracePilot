// Landing page entry.
import "./styles/index.css";
import { mqDesk, mqReduce } from "./motion/env.js";
import { wire } from "./motion/wire.js";

// a breakpoint or motion-preference change needs a different layout: rebuild cleanly
const reload = () => location.reload();
mqDesk.addEventListener("change", reload);
mqReduce.addEventListener("change", reload);

document.fonts.ready.then(wire);
