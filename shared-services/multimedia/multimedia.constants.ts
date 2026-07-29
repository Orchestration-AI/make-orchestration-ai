import type { Setting } from "@orchestration-ai/sdk/services";

export const bodyMaxCharsSettingKey = "BODY_MAX_CHARS";

export const defaultSettings: Setting[] = [
  {
    setting_name: bodyMaxCharsSettingKey,
    setting_description: "Maximum number of characters returned to the LLM per tool response. Keep this low to avoid filling the LLM context window.",
    setting_type: "Text",
    text_value: "20480",
  },
];
