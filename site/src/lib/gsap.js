// The one place GSAP plugins are registered. Self-hosted from npm: the page
// makes no third-party requests.
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, Flip);

export { Flip, gsap, ScrollTrigger };
