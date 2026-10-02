export const IS_EXTENSION =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
