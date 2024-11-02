import type { Setting } from "./types.ts";

export function getBooleanSetting(settings: Setting[], key: string): boolean {
  const setting = settings.find((setting) => setting.setting_name === key);

  if (setting?.setting_type === "Boolean") {
    return setting.boolean_value;
  } else {
    return false;
  }
}

export function getTextSetting(
  settings: Setting[],
  key: string
): string | undefined {
  const setting = settings.find((setting) => setting.setting_name === key);

  if (setting?.setting_type === "Text") {
    return setting.text_value;
  } else {
    return undefined;
  }
}
