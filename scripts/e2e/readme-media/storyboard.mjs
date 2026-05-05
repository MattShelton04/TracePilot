import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export function writeStoryboard(targets, candidateRoot, docsImagesDir) {
  const selected = targets.filter((target) => target.readme);
  const cards = selected
    .map((target, index) => {
      const src = relative(candidateRoot, resolve(docsImagesDir, target.fileName)).replace(
        /\\/g,
        "/",
      );
      return `    <section class="shot" style="--i:${index}">
      <img src="${src}" alt="${target.title}" />
      <h2>${target.title}</h2>
    </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TracePilot README demo storyboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #090b10; }
    body { margin: 0; padding: 40px; color: #f6f8fa; }
    main { display: grid; gap: 40px; max-width: 1180px; margin: 0 auto; }
    .shot { position: relative; overflow: hidden; border-radius: 24px; border: 1px solid #30363d; background: #0d1117; box-shadow: 0 24px 80px #0008; }
    .shot img { display: block; width: 100%; transform-origin: 50% 45%; animation: kenburns 9s ease-in-out infinite alternate; animation-delay: calc(var(--i) * -1.1s); }
    .shot h2 { position: absolute; left: 24px; bottom: 20px; margin: 0; padding: 10px 14px; border-radius: 14px; background: #090b10cc; backdrop-filter: blur(12px); font-size: 18px; }
    @keyframes kenburns {
      from { transform: scale(1.005) translate3d(0, 0, 0); }
      to { transform: scale(1.055) translate3d(-10px, -8px, 0); }
    }
  </style>
</head>
<body>
  <main>
${cards}
  </main>
</body>
</html>
`;

  const storyboardPath = resolve(candidateRoot, "readme-demo-storyboard.html");
  writeFileSync(storyboardPath, html);

  const ffmpegScript = `# Optional: create a lightweight README demo MP4 from the selected PNGs.
# Requires ffmpeg on PATH. Run from the repository root.

$ErrorActionPreference = "Stop"
$Frames = @(
${selected.map((target) => `  "docs\\images\\${target.fileName}"`).join(",\n")}
)

$ListPath = "scripts\\e2e\\screenshots\\readme-candidates\\ffmpeg-input.txt"
$Frames | ForEach-Object {
  "file '$((Resolve-Path $_).Path.Replace("'", "''"))'"
  "duration 2.3"
} | Set-Content -Encoding UTF8 $ListPath

ffmpeg -y -f concat -safe 0 -i $ListPath -vf "scale=1440:-2,format=yuv420p,fps=30" "docs\\images\\tracepilot-readme-demo.mp4"
`;

  const ffmpegPath = resolve(candidateRoot, "make-readme-demo-video.ps1");
  writeFileSync(ffmpegPath, ffmpegScript);
  return { storyboardPath, ffmpegPath };
}
