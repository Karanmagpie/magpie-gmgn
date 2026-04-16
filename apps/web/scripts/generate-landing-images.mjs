#!/usr/bin/env node
// =============================================================
// Landing Page Image Generator (fal.ai)
// =============================================================
import { fal } from '@fal-ai/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'generated');

if (!process.env.FAL_KEY) {
  console.error('ERROR: FAL_KEY env variable not set');
  process.exit(1);
}
fal.config({ credentials: process.env.FAL_KEY });

async function downloadImage(url, filename) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR, filename), buf);
  console.log(`  ✓ Saved: public/generated/${filename}`);
}

async function generate(name, prompt, filename, options = {}) {
  console.log(`\nGenerating ${name}...`);
  try {
    const result = await fal.subscribe('fal-ai/flux/schnell', {
      input: {
        prompt,
        image_size: options.imageSize || 'landscape_16_9',
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: false,
        ...options,
      },
      logs: false,
    });
    await downloadImage(result.data.images[0].url, filename);
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
  }
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Big landing hero — ultrawide cinematic
  await generate(
    'Landing Hero',
    'Epic cinematic futuristic dashboard visualization, abstract floating holographic trading panels with emerald green and amber gold glowing data streams, candlestick charts and whale silhouettes rendered as neon light, dark black cosmic background with depth of field and volumetric god rays, high-end fintech aesthetic, Bloomberg terminal meets sci-fi, 8k ultra detailed, cinematic lighting, moody atmosphere',
    'landing-hero.png',
    { imageSize: 'landscape_16_9' }
  );

  // Feature showcase — whale tracking
  await generate(
    'Feature: Whale',
    'Abstract neon whale silhouette made of flowing data streams and candlestick charts, swimming through dark ocean of numbers, emerald green and amber gold glow, cinematic, minimal, fintech aesthetic, dark background',
    'feature-whale.png',
    { imageSize: 'square' }
  );

  // Feature showcase — radar / safety
  await generate(
    'Feature: Safety',
    'Glowing neon radar scope with detection pulses, red risk zones and green safe zones, abstract data overlay, emerald green and red gradient, dark background, fintech minimal aesthetic',
    'feature-safety.png',
    { imageSize: 'square' }
  );

  // Feature showcase — arbitrage
  await generate(
    'Feature: Arbitrage',
    'Two glowing data nodes connected by flowing neon gold energy stream representing arbitrage opportunity, split-screen composition, emerald green and amber gold, dark futuristic background, cinematic',
    'feature-arbitrage.png',
    { imageSize: 'square' }
  );

  console.log('\n✓ Done');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
