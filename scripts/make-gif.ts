/**
 * Joins screenshots into the README's demo GIF. Uses sharp, which Next.js already installs.
 * Every frame must be the same size. A frame's delay goes after its path, in milliseconds.
 *
 * Run: npx tsx scripts/make-gif.ts docs/demo.gif frames/01.jpg:1800 frames/02.jpg:1500 ...
 */
import fs from "node:fs";
import sharp from "sharp";

async function main() {
  const [out, ...specs] = process.argv.slice(2);
  if (!out || specs.length < 2) throw new Error("Usage: make-gif.ts <out.gif> <frame.jpg[:ms]> <frame.jpg[:ms]> ...");
  const frames = specs.map((s) => {
    const [file, ms] = s.split(":");
    return { file, delay: Number(ms) || 2000 };
  });
  const sizes = await Promise.all(frames.map((f) => sharp(f.file).metadata()));
  const { width, height } = sizes[0];
  const odd = frames.filter((_, i) => sizes[i].width !== width || sizes[i].height !== height);
  if (odd.length) throw new Error(`Every frame must be ${width}x${height}: ${odd.map((f) => f.file).join(", ")} isn't`);

  await sharp(
    frames.map((f) => f.file),
    { join: { animated: true } },
  )
    .gif({ delay: frames.map((f) => f.delay), loop: 0, effort: 10, colours: 128 })
    .toFile(out);
  console.log(`Wrote ${out}: ${frames.length} frames, ${width}x${height}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
