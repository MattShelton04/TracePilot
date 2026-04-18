// Playwright CT entry — loads design tokens + a deterministic canvas
// background so every component snapshot has the same environment.
import "../src/styles/tokens.css";

// Pin backdrop to the canonical canvas color + disable every animation
// so snapshots are pixel-deterministic regardless of transition timing.
const style = document.createElement("style");
style.textContent = `
  html, body, #root {
    margin: 0;
    padding: 0;
    background: var(--canvas-default, #09090b);
    color: var(--text-primary, #e5e5e7);
    font-family: var(--font-family, system-ui, sans-serif);
  }
  body { padding: 24px; }
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;
document.head.appendChild(style);
