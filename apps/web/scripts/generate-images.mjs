#!/usr/bin/env node
// =============================================================
// fal.ai Image Generation Script
// =============================================================
// One-off script to generate PMGN brand assets:
// - Logo (small, transparent)
// - Hero background (wide, dark themed)
// - Category illustrations
//
// Run: node apps/web/scripts/generate-images.mjs
// Requires: FAL_KEY env variable
// =============================================================

import { fal } from '@fal-ai/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'generated');

// Configure fal client
if (!process.env.FAL_KEY) {
  console.error('ERROR: FAL_KEY env variable not set');
  console.error('Set it in .env or pass: FAL_KEY=xxx node ...');
  process.exit(1);
}
fal.config({ credentials: process.env.FAL_KEY });

async function downloadImage(url, filename) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const fullPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(fullPath, buf);
  console.log(`  ✓ Saved: public/generated/${filename}`);
  return fullPath;
}

async function generate(name, prompt, filename, options = {}) {
  console.log(`\nGenerating ${name}...`);
  console.log(`  Prompt: ${prompt.slice(0, 80)}...`);
  try {
    const result = await fal.subscribe('fal-ai/flux/schnell', {
      input: {
        prompt,
        image_size: options.imageSize || 'square_hd',
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: false,
        ...options,
      },
      logs: false,
    });
    const imageUrl = result.data.images[0].url;
    await downloadImage(imageUrl, filename);
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
  }
}

async function main() {
  console.log('=================================');
  console.log('PMGN — fal.ai Asset Generator');
  console.log('=================================');

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // 1. Logo — simple, iconic, looks good at small sizes
  await generate(
    'Logo',
    'A minimalist app logo icon, abstract geometric letter P with a data visualization pattern inside, emerald green to amber gold gradient, glowing neon effect, crypto finance aesthetic, centered on pure black background, flat design, vector style, high contrast, clean edges, no text, no words',
    'logo.png',
    { imageSize: 'square' }
  );

  // 2. Hero background — dark, abstract, techy
  await generate(
    'Hero background',
    'Ultra-wide abstract dark background for a prediction market trading dashboard, subtle glowing emerald green and amber orange data streams, flowing candlestick chart silhouettes, digital network lines, volumetric light rays, cinematic depth of field, deep black base with neon accents, 8k, photorealistic, moody atmosphere, GMGN.ai inspired',
    'hero-bg.png',
    { imageSize: 'landscape_16_9' }
  );

  // 3. Category illustrations — square, themed per category
  const categories = [
    { slug: 'politics', prompt: 'Minimalist icon illustration for politics category, ballot box with glowing checkmark, red neon gradient, dark background, flat vector style, no text' },
    { slug: 'crypto', prompt: 'Minimalist icon illustration for crypto category, bitcoin symbol with digital circuit lines, amber gold neon gradient, dark background, flat vector style, no text' },
    { slug: 'sports', prompt: 'Minimalist icon illustration for sports category, stylized trophy with motion lines, emerald green neon gradient, dark background, flat vector style, no text' },
    { slug: 'economics', prompt: 'Minimalist icon illustration for economics category, stylized rising chart with dollar symbol, blue neon gradient, dark background, flat vector style, no text' },
  ];

  for (const cat of categories) {
    await generate(`Category: ${cat.slug}`, cat.prompt, `cat-${cat.slug}.png`, { imageSize: 'square' });
  }

  console.log('\n=================================');
  console.log('Done! Check: apps/web/public/generated/');
  console.log('=================================');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
