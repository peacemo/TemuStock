import { createRequire } from 'node:module';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const icongen = require('icon-gen');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const sourcePath = path.join(projectRoot, 'assets/icons/source/app-icon.svg');
const generatedDir = path.join(projectRoot, 'assets/icons/generated');
const iconGenInputDir = path.join(generatedDir, 'icon-gen-input');
const pngDir = path.join(generatedDir, 'png');
const outputBaseName = 'app-icon';
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

await rm(generatedDir, { recursive: true, force: true });
await mkdir(iconGenInputDir, { recursive: true });
await mkdir(pngDir, { recursive: true });

await Promise.all(
  sizes.map(async (size) => {
    const buffer = await sharp(sourcePath).resize(size, size).png().toBuffer();

    await Promise.all([
      writeFile(path.join(iconGenInputDir, `${size}.png`), buffer),
      writeFile(path.join(pngDir, `${size}x${size}.png`), buffer),
    ]);
  }),
);

await icongen(iconGenInputDir, generatedDir, {
  report: true,
  ico: { name: outputBaseName },
  icns: { name: outputBaseName },
});

await rm(iconGenInputDir, { recursive: true, force: true });

console.log(`Generated app icons in ${generatedDir}`);
