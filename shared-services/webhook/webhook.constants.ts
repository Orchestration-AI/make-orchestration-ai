import type { Setting } from "@orchestration-ai/sdk/services";

export const asyncWebhookProcessingSettingKey = "WEBHOOK_ASYNC_PROCESSING";

export const defaultSettings: Setting[] = [
  {
    setting_name: asyncWebhookProcessingSettingKey,
    setting_description:
      "When true, incoming webhook messages are submitted as ticker tasks instead of being processed directly. The webhook receives an immediate acknowledgement. The agent will only process the message when its ticker is enabled and within its configured work hours — ensure the agent's ticker config is active.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
