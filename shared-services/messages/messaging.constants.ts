import type { Setting } from "@orchestration-ai/sdk/services";

export const asyncMessagingSettingKey = "ASYNC_MESSAGING";

export const defaultSettings: Setting[] = [
  {
    setting_name: asyncMessagingSettingKey,
    setting_description:
      "When true, messages to other agents are submitted as ticker tasks instead of being sent directly. The calling agent receives MESSAGE_RECEIVED immediately. The target agent will only receive and process the message when its ticker is enabled and within its configured work hours - ensure the target agent's ticker config is active.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
