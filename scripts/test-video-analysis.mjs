import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/videoAnalysis.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const tempDir = await mkdtemp(join(tmpdir(), "promptlab-video-test-"));

try {
  const modulePath = join(tempDir, "videoAnalysis.cjs");
  await writeFile(modulePath, compiled);
  const require = createRequire(import.meta.url);
  const {
    buildVideoAnalysisInstruction,
    buildVideoAnalysisParts,
    parseGeminiVideoAnalysisResponse
  } = require(modulePath);
  const sample = {
    videoSummary: "A visual hook leads into a product demonstration and a closing gesture.",
    generatedPrompt: {
      globalStyle: "Vertical handheld creator footage with soft window light and brisk cuts.",
      referenceImageNotes: {
        outfit: "A light blue jacket with a high collar.",
        background: "A warm kitchen with pale tile.",
        product: "A small amber bottle with a white cap."
      },
      segments: [
        {
          startSeconds: 0,
          endSeconds: 4,
          shortSourceShot: true,
          affiliateBeat: "Hook",
          subject: "A creator's hands",
          action: "quickly reach toward the product",
          setting: "a bright tabletop",
          framing: "tight medium framing",
          angle: "slightly above eye level",
          cameraMovement: "a short push-in following the reach",
          composition: "keep the hands in the lower third",
          lighting: "soft window light with a gentle edge shadow",
          transition: "open on the hand entering frame",
          pacing: "a quick reveal followed by a brief hold"
        },
        {
          startSeconds: 4,
          endSeconds: 10,
          shortSourceShot: false,
          affiliateBeat: "Product demo/use",
          subject: "A creator's hands",
          action: "rotate the product and demonstrate its use",
          setting: "the same bright tabletop",
          framing: "close-up framing",
          angle: "at tabletop height",
          cameraMovement: "a steady lateral track following the hands",
          composition: "leave clean negative space beside the product",
          lighting: "soft window light with stable shadows",
          transition: "cut on the product turning",
          pacing: "measured movement with a short final hold"
        }
      ],
      consistencyConstraints: ["Keep the same visual identity and natural hand movement across segments."]
    }
  };

  const references = {
    outfit: "data:image/png;base64,b3V0Zml0",
    product: "data:image/webp;base64,cHJvZHVjdA=="
  };
  const result = parseGeminiVideoAnalysisResponse(JSON.stringify(sample), references);
  assert.match(result.generatedPrompt, /Segment 01 · 0–4s · Hook/);
  assert.match(result.generatedPrompt, /Outfit: \[OUTFIT\]/);
  assert.match(result.generatedPrompt, /Background: \[BACKGROUND\]/);
  assert.match(result.generatedPrompt, /Product: \[PRODUCT\]/);
  assert.equal(result.referenceImageNotes.outfit, sample.generatedPrompt.referenceImageNotes.outfit);
  assert.ok(!result.generatedPrompt.includes("light blue jacket"));
  assert.ok(!result.generatedPrompt.includes("amber bottle"));
  assert.equal(
    parseGeminiVideoAnalysisResponse(JSON.stringify(sample)).referenceImageNotes.outfit,
    ""
  );
  const instruction = buildVideoAnalysisInstruction(undefined, references);
  assert.match(instruction, /outfit, product/);
  assert.match(instruction, /visually only/);
  assert.match(instruction, /Outfit: \[OUTFIT\], Background: \[BACKGROUND\], Product: \[PRODUCT\]/);

  const parts = buildVideoAnalysisParts(
    [{ timestamp: 1.25, dataUrl: "data:image/jpeg;base64,ZmFrZQ==" }],
    references
  );
  assert.deepEqual(parts[0], { text: "Video frame 1 at 1.25 seconds" });
  assert.equal(parts[1].inlineData.mimeType, "image/jpeg");
  assert.ok(parts.some((part) => part.text?.includes("Reference image role: outfit")));
  assert.ok(parts.some((part) => part.text?.includes("Reference image role: product")));
  assert.equal(parts.filter((part) => part.inlineData).length, 3);

  const invalid = structuredClone(sample);
  invalid.generatedPrompt.segments[1].endSeconds = 15;
  assert.throws(() => parseGeminiVideoAnalysisResponse(JSON.stringify(invalid)), /outside the 5–10 second target/);
  console.log("Video analysis parser and image-reference checks passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
