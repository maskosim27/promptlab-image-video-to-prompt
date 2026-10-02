import {
  DEFAULT_FRAME_SAMPLING_MODE,
  DEFAULT_TARGET_MODEL,
  TARGET_MODELS,
  type AnalysisPhase,
  type AnalysisState,
  type FrameSamplingMode,
  type PromptHistoryItem,
  type StoredSettings,
  type TargetModelId
} from "./types";
import { IS_EXTENSION } from "./platform";

const SETTINGS_KEY = "video2prompt:settings";
const ANALYSIS_KEY_PREFIX = "video2prompt:analysis:";
const HISTORY_KEY = "video2prompt:history";

export const defaultSettings: StoredSettings = {
  geminiApiKey: "",
  targetModel: DEFAULT_TARGET_MODEL,
  frameSamplingMode: DEFAULT_FRAME_SAMPLING_MODE
};

async function readStoredValue(key: string): Promise<unknown> {
  if (IS_EXTENSION) {
    const stored = await chrome.storage.local.get(key);
    return stored[key];
  }

  try {
    const value = localStorage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function writeStoredValue(key: string, value: unknown): Promise<void> {
  if (IS_EXTENSION) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

async function removeStoredValue(key: string): Promise<void> {
  if (IS_EXTENSION) {
    await chrome.storage.local.remove(key);
    return;
  }

  localStorage.removeItem(key);
}

function normalizeTargetModel(value: unknown): TargetModelId {
  if (TARGET_MODELS.some((model) => model.id === value)) {
    return value as TargetModelId;
  }

  if (value === "happyhorse-1.0") {
    return "generic-ai-video";
  }

  return DEFAULT_TARGET_MODEL;
}

function normalizeFrameSamplingMode(value: unknown): FrameSamplingMode {
  if (value === "fast" || value === "standard" || value === "detailed") {
    return value;
  }

  return DEFAULT_FRAME_SAMPLING_MODE;
}

export function createAnalysisState(
  tabId: number | null,
  phase: AnalysisPhase,
  statusText: string,
  targetModel: TargetModelId,
  extras: Partial<AnalysisState> = {}
): AnalysisState {
  return {
    tabId,
    phase,
    statusText,
    targetModel,
    updatedAt: Date.now(),
    ...extras
  };
}

export async function getSettings(): Promise<StoredSettings> {
  const merged = {
    ...defaultSettings,
    ...(await readStoredValue(SETTINGS_KEY) as Partial<StoredSettings> | undefined)
  };

  return {
    geminiApiKey: merged.geminiApiKey ?? "",
    targetModel: normalizeTargetModel(merged.targetModel),
    frameSamplingMode: normalizeFrameSamplingMode(merged.frameSamplingMode)
  };
}

export async function saveSettings(settings: StoredSettings): Promise<void> {
  await writeStoredValue(SETTINGS_KEY, settings);
}

export async function saveApiKey(geminiApiKey: string): Promise<StoredSettings> {
  const current = await getSettings();
  const next = { ...current, geminiApiKey: geminiApiKey.trim() };
  await saveSettings(next);
  return next;
}

export async function deleteApiKey(): Promise<StoredSettings> {
  const current = await getSettings();
  const next = { ...current, geminiApiKey: "" };
  await saveSettings(next);
  return next;
}

export async function saveTargetModel(
  targetModel: TargetModelId
): Promise<StoredSettings> {
  const current = await getSettings();
  const next = { ...current, targetModel };
  await saveSettings(next);
  return next;
}

export async function saveFrameSamplingMode(
  frameSamplingMode: FrameSamplingMode
): Promise<StoredSettings> {
  const current = await getSettings();
  const next = { ...current, frameSamplingMode };
  await saveSettings(next);
  return next;
}

export function analysisStorageKey(tabId: number): string {
  return `${ANALYSIS_KEY_PREFIX}${tabId}`;
}

export async function getAnalysisState(
  tabId: number
): Promise<AnalysisState | null> {
  if (!IS_EXTENSION) return null;
  const key = analysisStorageKey(tabId);
  return (await readStoredValue(key) as AnalysisState | undefined) ?? null;
}

export async function saveAnalysisState(state: AnalysisState): Promise<void> {
  if (!IS_EXTENSION || state.tabId == null) {
    return;
  }

  await writeStoredValue(analysisStorageKey(state.tabId), state);
}

export async function clearAnalysisState(tabId: number): Promise<void> {
  if (!IS_EXTENSION) return;
  await removeStoredValue(analysisStorageKey(tabId));
}

export async function getPromptHistory(): Promise<PromptHistoryItem[]> {
  const history = await readStoredValue(HISTORY_KEY);
  if (!Array.isArray(history)) {
    return [];
  }

  return history.map((item) => {
    const normalized = item as Partial<PromptHistoryItem>;
    return {
      id: normalized.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: normalized.createdAt ?? Date.now(),
      sourceType:
        normalized.sourceType === "web"
          ? "web"
          : normalized.sourceType === "enhancer"
            ? "enhancer"
            : "local",
      mediaType:
        normalized.mediaType ??
        (normalized.sourceType === "web" ? "image" : normalized.sourceType === "enhancer" ? "video" : "video"),
      sourceUrl: normalized.sourceUrl,
      pageTitle: normalized.pageTitle,
      thumbnailDataUrl: normalized.thumbnailDataUrl,
      promptText: normalized.promptText ?? "",
      videoSummary: normalized.videoSummary
    };
  });
}

async function savePromptHistory(
  history: PromptHistoryItem[]
): Promise<PromptHistoryItem[]> {
  const next = history.slice(0, 20);
  await writeStoredValue(HISTORY_KEY, next);
  return next;
}

export async function savePromptHistoryItem(
  item: PromptHistoryItem
): Promise<PromptHistoryItem[]> {
  const current = await getPromptHistory();
  return savePromptHistory([item, ...current]);
}

export async function deletePromptHistoryItem(
  id: string
): Promise<PromptHistoryItem[]> {
  const current = await getPromptHistory();
  return savePromptHistory(current.filter((item) => item.id !== id));
}
