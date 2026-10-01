import type {
  DetectedVideoInfo,
  ExtractedFrame,
  GeminiVideoAnalysisResponse,
  VideoReferenceImages,
  VideoReferenceSlot
} from "./types";

export const GEMINI_VIDEO_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    videoSummary: { type: "string" },
    generatedPrompt: {
      type: "object",
      properties: {
        globalStyle: { type: "string" },
        referenceImageNotes: {
          type: "object",
          properties: {
            outfit: { type: "string" },
            background: { type: "string" },
            product: { type: "string" }
          },
          required: ["outfit", "background", "product"]
        },
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              startSeconds: { type: "number" },
              endSeconds: { type: "number" },
              shortSourceShot: { type: "boolean" },
              affiliateBeat: {
                type: "string",
                enum: ["Hook", "Product demo/use", "CTA/closing", "Other"]
              },
              subject: { type: "string" },
              action: { type: "string" },
              setting: { type: "string" },
              framing: { type: "string" },
              angle: { type: "string" },
              cameraMovement: { type: "string" },
              composition: { type: "string" },
              lighting: { type: "string" },
              transition: { type: "string" },
              pacing: { type: "string" }
            },
            required: [
              "startSeconds",
              "endSeconds",
              "shortSourceShot",
              "affiliateBeat",
              "subject",
              "action",
              "setting",
              "framing",
              "angle",
              "cameraMovement",
              "composition",
              "lighting",
              "transition",
              "pacing"
            ]
          }
        },
        consistencyConstraints: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["globalStyle", "referenceImageNotes", "segments", "consistencyConstraints"]
    }
  },
  required: ["videoSummary", "generatedPrompt"]
} as const;

const REFERENCE_SLOTS: VideoReferenceSlot[] = ["outfit", "background", "product"];

type InlineImagePart = { mimeType: string; data: string };
export type VideoAnalysisPart = { text: string } | { inlineData: InlineImagePart };

export function dataUrlToInlinePart(dataUrl: string): InlineImagePart {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error("Unsupported image data format.");
  }
  return { mimeType: match[1], data: match[2] };
}

export function buildVideoAnalysisParts(
  frames: ExtractedFrame[],
  referenceImages: VideoReferenceImages = {}
): VideoAnalysisPart[] {
  const frameParts = frames.flatMap((frame, index): VideoAnalysisPart[] => [
    { text: `Video frame ${index + 1} at ${frame.timestamp.toFixed(2)} seconds` },
    { inlineData: dataUrlToInlinePart(frame.dataUrl) }
  ]);
  const referenceParts = REFERENCE_SLOTS.flatMap((slot): VideoAnalysisPart[] => {
    const dataUrl = referenceImages[slot];
    return dataUrl
      ? [
          {
            text: `Reference image role: ${slot}. Analyze it and use it only as a visual reference for that role; keep its description in the separate reference notes.`
          },
          { inlineData: dataUrlToInlinePart(dataUrl) }
        ]
      : [];
  });
  return [...frameParts, ...referenceParts];
}

function inferAspectRatio(videoInfo?: DetectedVideoInfo): string {
  if (!videoInfo?.videoWidth || !videoInfo.videoHeight) return "unknown";
  const ratio = videoInfo.videoWidth / videoInfo.videoHeight;
  if (ratio > 1.7) return "16:9";
  if (ratio < 0.8) return "9:16";
  return "1:1 or 4:5";
}

export function buildVideoAnalysisInstruction(
  videoInfo?: DetectedVideoInfo,
  referenceImages: VideoReferenceImages = {}
): string {
  const duration =
    typeof videoInfo?.duration === "number" && Number.isFinite(videoInfo.duration)
      ? `${videoInfo.duration.toFixed(2)} seconds`
      : "unknown";
  const providedReferences = REFERENCE_SLOTS.filter((slot) => referenceImages[slot]);

  return `You reverse-engineer short affiliate videos into reusable, model-neutral video prompts.

Analyze the supplied video frames visually only. Ignore and do not transcribe or describe on-screen captions, overlay text, logos, signs, UI, or other readable text. Do not analyze or mention voice-over, dialogue, music, sound, or sound effects. Infer the affiliate sequence only from visible actions and visual order: identify a hook, product demonstration/use, and CTA/closing when the visuals support them; otherwise use Other rather than inventing a beat.

Video duration: ${duration}
Video aspect ratio: ${inferAspectRatio(videoInfo)}
Optional reference images supplied: ${providedReferences.length ? providedReferences.join(", ") : "none"}

Use the video frames as evidence for the scene, visible actions, shot changes, camera, and light. Optional reference images are also references for their explicitly labelled role (outfit, background, or product). Analyze each supplied image and describe it only in referenceImageNotes. Never copy an image description into a segment prompt or use it to fill a prompt field. Every segment prompt must retain these exact blank placeholders: Outfit: [OUTFIT], Background: [BACKGROUND], Product: [PRODUCT]. Refer to any shown product generically as “the product”; do not identify or describe its appearance, packaging, brand, or text.

Create contiguous, chronological segments that cover the source. Target 5–10 seconds per segment. If an original source shot is shorter than 5 seconds, preserve it as its own shorter segment and set shortSourceShot to true; do not merge adjacent short shots just to reach 5 seconds. For an original shot longer than 10 seconds, split at natural visible action or camera-movement changes into segments of 5–10 seconds. Use approximate boundaries when frame sampling makes exact cuts unclear. Keep each segment within 10 seconds; a segment under 5 seconds is allowed only for a source shot that is itself under 5 seconds.

For every segment, supply the visible subject, specific action, setting, framing, camera angle, one primary camera movement, composition, lighting, transition, and pacing. Describe concrete visual evidence, not inferred audio or text. Use a natural, practical shot brief; no model names, model-specific syntax, parameters, or unsupported events. Keep the camera movement motivated by the visible action. Choose affiliateBeat from Hook, Product demo/use, CTA/closing, or Other based only on visible sequence.

Return a concise visual-only videoSummary, one shared globalStyle, concise descriptions for supplied reference images (empty strings for images not supplied), and short visual consistencyConstraints. Do not include any sound/audio field. Keep the reference notes separate from the segment prompts.

Return valid JSON only, matching the provided response schema. Every value must be in English.`;
}

function extractJsonSubstring(rawText: string): string | null {
  const start = rawText.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < rawText.length; index += 1) {
    const char = rawText[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return rawText.slice(start, index + 1);
  }
  return null;
}

function parseJson(rawText: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawText.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const json = extractJsonSubstring(rawText);
    if (json) {
      try {
        const parsed: unknown = JSON.parse(json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Report the same user-facing format error below.
      }
    }
  }
  throw new Error("Gemini returned an invalid video analysis format. Please try again.");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Gemini returned an incomplete video analysis (${label}). Please try again.`);
  }
  return value.trim();
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatVideoAnalysisPrompt(response: GeminiVideoAnalysisResponse): string {
  const { generatedPrompt } = response;
  const segments = generatedPrompt.segments.map((segment, index) => {
    const range = `${formatSeconds(segment.startSeconds)}–${formatSeconds(segment.endSeconds)}s`;
    const shortNote = segment.shortSourceShot ? " · short source-shot exception" : "";
    return [
      `Segment ${String(index + 1).padStart(2, "0")} · ${range} · ${segment.affiliateBeat}${shortNote}`,
      `Subject/action: ${segment.subject} ${segment.action}`,
      `Setting: ${segment.setting}`,
      `Framing: ${segment.framing}; angle: ${segment.angle}.`,
      `Camera movement: ${segment.cameraMovement}.`,
      `Composition: ${segment.composition}.`,
      `Lighting: ${segment.lighting}.`,
      `Transition: ${segment.transition}. Pacing: ${segment.pacing}.`,
      "Outfit: [OUTFIT]",
      "Background: [BACKGROUND]",
      "Product: [PRODUCT]"
    ].join("\n");
  });
  const constraints = generatedPrompt.consistencyConstraints.map((item) => `- ${item}`);

  return [
    "Global Visual Style:",
    generatedPrompt.globalStyle,
    "",
    "Shot-by-Shot Prompts:",
    "",
    ...segments.flatMap((segment, index) => (index ? ["", segment] : [segment])),
    "",
    "Visual Consistency:",
    ...constraints
  ].join("\n");
}

export function parseGeminiVideoAnalysisResponse(
  rawText: string,
  referenceImages: VideoReferenceImages = {}
): {
  videoSummary: string;
  generatedPrompt: string;
  rawResult: string;
  promptResult: GeminiVideoAnalysisResponse;
  referenceImageNotes: GeminiVideoAnalysisResponse["generatedPrompt"]["referenceImageNotes"];
} {
  const raw = parseJson(rawText);
  const prompt = record(raw.generatedPrompt);
  const notes = record(prompt.referenceImageNotes);
  const rawSegments = prompt.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error("Gemini returned an incomplete video analysis (segments). Please try again.");
  }

  const segments = rawSegments.map((value) => {
    const item = record(value);
    const startSeconds = item.startSeconds;
    const endSeconds = item.endSeconds;
    const shortSourceShot = item.shortSourceShot;
    if (
      typeof startSeconds !== "number" || !Number.isFinite(startSeconds) || startSeconds < 0 ||
      typeof endSeconds !== "number" || !Number.isFinite(endSeconds) || endSeconds <= startSeconds ||
      typeof shortSourceShot !== "boolean"
    ) {
      throw new Error("Gemini returned invalid video segment timing. Please try again.");
    }
    const duration = endSeconds - startSeconds;
    if (duration > 10 || (duration < 5 && !shortSourceShot)) {
      throw new Error("Gemini returned a segment outside the 5–10 second target. Please try again.");
    }
    const affiliateBeat = requiredText(item.affiliateBeat, "affiliate beat");
    const allowedBeats = ["Hook", "Product demo/use", "CTA/closing", "Other"];
    const normalizedBeat = allowedBeats.find((beat) => beat.toLowerCase() === affiliateBeat.toLowerCase()) ?? "Other";
    return {
      startSeconds,
      endSeconds,
      shortSourceShot,
      affiliateBeat: normalizedBeat,
      subject: requiredText(item.subject, "subject"),
      action: requiredText(item.action, "action"),
      setting: requiredText(item.setting, "setting"),
      framing: requiredText(item.framing, "framing"),
      angle: requiredText(item.angle, "angle"),
      cameraMovement: requiredText(item.cameraMovement, "camera movement"),
      composition: requiredText(item.composition, "composition"),
      lighting: requiredText(item.lighting, "lighting"),
      transition: requiredText(item.transition, "transition"),
      pacing: requiredText(item.pacing, "pacing")
    };
  });

  const referenceImageNotes = {
    outfit: referenceImages.outfit && typeof notes.outfit === "string" ? notes.outfit.trim() : "",
    background: referenceImages.background && typeof notes.background === "string" ? notes.background.trim() : "",
    product: referenceImages.product && typeof notes.product === "string" ? notes.product.trim() : ""
  };
  const consistencyConstraints = Array.isArray(prompt.consistencyConstraints)
    ? prompt.consistencyConstraints
        .filter((item): item is string => typeof item === "string" && !!item.trim())
        .map((item) => item.trim())
    : [];
  if (!consistencyConstraints.length) {
    throw new Error("Gemini returned an incomplete video analysis (visual constraints). Please try again.");
  }

  const promptResult: GeminiVideoAnalysisResponse = {
    videoSummary: requiredText(raw.videoSummary, "video summary"),
    generatedPrompt: {
      globalStyle: requiredText(prompt.globalStyle, "global visual style"),
      referenceImageNotes,
      segments,
      consistencyConstraints
    }
  };
  const generatedPrompt = formatVideoAnalysisPrompt(promptResult);
  return {
    videoSummary: promptResult.videoSummary,
    generatedPrompt,
    rawResult: JSON.stringify(promptResult, null, 2),
    promptResult,
    referenceImageNotes
  };
}
