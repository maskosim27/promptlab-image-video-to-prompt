import { GoogleGenAI } from "@google/genai";
import {
  buildPromptEnhancerImageInstruction,
  buildPromptEnhancerVideoInstruction,
  type PromptEnhancerMode
} from "./prompts/enhancer";
import {
  GEMINI_IMAGE_RESPONSE_SCHEMA,
  GEMINI_VIDEO_RESPONSE_SCHEMA,
  buildGeminiImageInstruction,
  parseGeminiImageResponse,
  parseGeminiVideoResponse
} from "./promptTemplates";
import {
  buildVideoAnalysisInstruction,
  buildVideoAnalysisParts,
  dataUrlToInlinePart,
  GEMINI_VIDEO_ANALYSIS_RESPONSE_SCHEMA,
  parseGeminiVideoAnalysisResponse
} from "./videoAnalysis";
import {
  GEMINI_ANALYSIS_MODEL,
  type DetectedImageInfo,
  type DetectedVideoInfo,
  type ExtractedFrame,
  type TargetModelId,
  type VideoReferenceImages
} from "./types";

function inferMimeTypeFromUrl(imageUrl: string): string {
  const pathname = new URL(imageUrl).pathname.toLowerCase();
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  if (pathname.endsWith(".gif")) {
    return "image/gif";
  }
  return "image/jpeg";
}

type GeminiGenerationRequest = Omit<
  Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  "model"
>;

async function generateGeminiText(
  apiKey: string,
  request: GeminiGenerationRequest
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_ANALYSIS_MODEL,
    ...request
  });

  if (typeof response.text !== "string") {
    throw new Error("Gemini did not return a valid prompt. Please try again.");
  }

  return response.text;
}

export async function analyzeVideoFramesWithGemini({
  apiKey,
  frames,
  videoInfo,
  referenceImages
}: {
  apiKey: string;
  frames: ExtractedFrame[];
  videoInfo?: DetectedVideoInfo;
  referenceImages?: VideoReferenceImages;
}): Promise<ReturnType<typeof parseGeminiVideoAnalysisResponse>> {
  const instruction = buildVideoAnalysisInstruction(videoInfo, referenceImages);
  const videoParts = buildVideoAnalysisParts(frames, referenceImages);

  const text = await generateGeminiText(apiKey, {
    contents: [
      {
        role: "user",
        parts: [{ text: instruction }, ...videoParts]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_VIDEO_ANALYSIS_RESPONSE_SCHEMA,
      temperature: 0.4,
      topP: 0.9
    }
  });
  return parseGeminiVideoAnalysisResponse(text, referenceImages);
}

export async function analyzeImageWithGemini({
  apiKey,
  targetModel,
  imageUrl,
  imageDataUrl,
  imageInfo
}: {
  apiKey: string;
  targetModel: TargetModelId;
  imageUrl?: string;
  imageDataUrl?: string;
  imageInfo?: DetectedImageInfo;
}): Promise<ReturnType<typeof parseGeminiImageResponse>> {
  const instruction = buildGeminiImageInstruction(targetModel, imageInfo);
  const imagePart = imageUrl
    ? {
        fileData: {
          mimeType: inferMimeTypeFromUrl(imageUrl),
          fileUri: imageUrl
        }
      }
      : imageDataUrl
        ? {
            inlineData: dataUrlToInlinePart(imageDataUrl)
          }
        : null;

  if (!imagePart) {
    throw new Error("No image data was provided for analysis.");
  }

  const text = await generateGeminiText(apiKey, {
    contents: [
      {
        role: "user",
        parts: [{ text: instruction }, imagePart]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_IMAGE_RESPONSE_SCHEMA,
      temperature: 0.4,
      topP: 0.9
    }
  });
  return parseGeminiImageResponse(text);
}

function cleanEnhancedPrompt(text: string): string {
  return text
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^(?:enhanced\s+prompt|video\s+prompt|image\s+prompt|final\s+prompt|prompt)\s*:\s*/i, "")
    .trim();
}

export async function enhancePromptWithGemini({
  apiKey,
  mode,
  idea
}: {
  apiKey: string;
  mode: PromptEnhancerMode;
  idea: string;
}): Promise<string> {
  const trimmedIdea = idea.trim();
  if (!trimmedIdea) {
    throw new Error("Enter a short idea first.");
  }

  if (mode === "video") {
    const text = await generateGeminiText(apiKey, {
      contents: [
        {
          role: "user",
          parts: [{ text: buildPromptEnhancerVideoInstruction(trimmedIdea) }]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_VIDEO_RESPONSE_SCHEMA,
        temperature: 0.45,
        topP: 0.9
      }
    });
    return parseGeminiVideoResponse(text).generatedPrompt;
  }

  const text = await generateGeminiText(apiKey, {
    contents: [
      {
        role: "user",
        parts: [{ text: buildPromptEnhancerImageInstruction(trimmedIdea) }]
      }
    ],
    config: {
      temperature: 0.55,
      topP: 0.9
    }
  });
  const prompt = cleanEnhancedPrompt(text);
  if (!prompt) {
    throw new Error("Gemini did not return a valid prompt. Please try again.");
  }

  return prompt;
}
