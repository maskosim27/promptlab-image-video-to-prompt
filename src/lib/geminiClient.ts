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
  buildGeminiVideoInstruction,
  parseGeminiImageResponse,
  parseGeminiVideoResponse
} from "./promptTemplates";
import {
  GEMINI_ANALYSIS_MODEL,
  type DetectedImageInfo,
  type DetectedVideoInfo,
  type ExtractedFrame,
  type TargetModelId
} from "./types";

function dataUrlToInlinePart(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error("Unsupported frame format.");
  }

  return {
    mimeType: match[1],
    data: match[2]
  };
}

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
  targetModel,
  frames,
  videoInfo
}: {
  apiKey: string;
  targetModel: TargetModelId;
  frames: ExtractedFrame[];
  videoInfo?: DetectedVideoInfo;
}): Promise<ReturnType<typeof parseGeminiVideoResponse>> {
  const instruction = buildGeminiVideoInstruction(targetModel, videoInfo);

  const frameParts = frames.flatMap((frame, index) => {
    const inlineData = dataUrlToInlinePart(frame.dataUrl);

    return [
      {
        text: `Frame ${index + 1} at ${frame.timestamp.toFixed(2)} seconds`
      },
      {
        inlineData
      }
    ];
  });

  const text = await generateGeminiText(apiKey, {
    contents: [
      {
        role: "user",
        parts: [{ text: instruction }, ...frameParts]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_VIDEO_RESPONSE_SCHEMA,
      temperature: 0.4,
      topP: 0.9
    }
  });
  return parseGeminiVideoResponse(text);
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
