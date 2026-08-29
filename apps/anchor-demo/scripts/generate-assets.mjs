// Generates real Anchor brand assets (icon, splash, adaptive icons, favicon)
// from a single avionics glyph definition. Run: node scripts/generate-assets.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'assets', 'images');

const BG = '#0C1116'; // panel background
const GRID = '#3A434D'; // chrome hairline
const ACCENT = '#00D9A3'; // trusted
const WHITE = '#FFFFFF';

// Geometric anchor inside a compass-rose crosshair ring. Hard edges, no curves
// except the fluke arc and ring. Designed on a 1024x1024 canvas; `glyphScale`
// shrinks everything about the center for adaptive-icon safe zones.
function glyphSvg({ stroke, strokeWidth, glyphScale = 1, withRing = true }) {
  const sw = strokeWidth;
  const ticks = [];
  if (withRing) {
    // Ring ticks every 30deg, cardinal ticks longer + thicker
    for (let deg = 0; deg < 360; deg += 30) {
      const cardinal = deg % 90 === 0;
      const r1 = cardinal ? 292 : 306;
      const r2 = 330;
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      ticks.push(
        `<line x1="${(512 + cos * r1).toFixed(1)}" y1="${(512 + sin * r1).toFixed(1)}" x2="${(512 + cos * r2).toFixed(1)}" y2="${(512 + sin * r2).toFixed(1)}" stroke="${stroke}" stroke-width="${cardinal ? sw * 1.2 : sw * 0.7}" stroke-linecap="butt"/>`,
      );
    }
  }
  const anchor = `
    <!-- shank -->
    <line x1="512" y1="368" x2="512" y2="676" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>
    <!-- stock -->
    <line x1="424" y1="412" x2="600" y2="412" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>
    <!-- ring -->
    <circle cx="512" cy="330" r="38" fill="none" stroke="${stroke}" stroke-width="${sw}"/>
    <!-- crown arc (flukes) -->
    <path d="M 356 560 A 170 170 0 0 0 668 560" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>
    <!-- fluke tips: angled strokes rising from the arc ends -->
    <line x1="356" y1="560" x2="300" y2="504" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>
    <line x1="668" y1="560" x2="724" y2="504" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>
    <!-- crosshair center hairlines left/right of shank -->
    <line x1="404" y1="512" x2="452" y2="512" stroke="${stroke}" stroke-width="${sw * 0.6}" stroke-linecap="butt"/>
    <line x1="572" y1="512" x2="620" y2="512" stroke="${stroke}" stroke-width="${sw * 0.6}" stroke-linecap="butt"/>
  `;
  const transform = glyphScale === 1 ? '' : ` transform="translate(${512 - 512 * glyphScale} ${512 - 512 * glyphScale}) scale(${glyphScale})"`;
  return `
    <g${transform}>
      ${withRing ? `<circle cx="512" cy="512" r="330" fill="none" stroke="${stroke}" stroke-width="${sw * 0.5}"/>` : ''}
      ${ticks.join('\n')}
      ${anchor}
    </g>
  `;
}

function gridSvg() {
  const lines = [];
  for (let p = 128; p < 1024; p += 128) {
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="1024" stroke="${GRID}" stroke-width="1.5"/>`);
    lines.push(`<line x1="0" y1="${p}" x2="1024" y2="${p}" stroke="${GRID}" stroke-width="1.5"/>`);
  }
  return lines.join('\n');
}

const iconSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" fill="${BG}"/>
  ${gridSvg()}
  ${glyphSvg({ stroke: ACCENT, strokeWidth: 34, glyphScale: 0.94 })}
</svg>`;

const splashSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${glyphSvg({ stroke: ACCENT, strokeWidth: 40, glyphScale: 0.9 })}
</svg>`;

// Adaptive foreground: glyph confined to the inner ~66% safe zone, transparent bg.
const foregroundSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${glyphSvg({ stroke: ACCENT, strokeWidth: 40, glyphScale: 0.62 })}
</svg>`;

const monochromeSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${glyphSvg({ stroke: WHITE, strokeWidth: 40, glyphScale: 0.62 })}
</svg>`;

async function main() {
  await mkdir(outDir, { recursive: true });
  const jobs = [
    ['icon.png', iconSvg, 1024],
    ['splash-icon.png', splashSvg, 1024],
    ['android-icon-foreground.png', foregroundSvg, 1024],
    ['android-icon-monochrome.png', monochromeSvg, 1024],
    ['favicon.png', iconSvg, 48],
  ];
  for (const [name, svg, size] of jobs) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(outDir, name));
    console.log('wrote', name);
  }
  // Adaptive background: solid panel color
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: BG },
  })
    .png()
    .toFile(path.join(outDir, 'android-icon-background.png'));
  console.log('wrote android-icon-background.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
