import type { Setting } from "../types.ts";

export const asyncMessagingSettingKey = "ASYNC_MESSAGING";

export const defaultSettings: Setting[] = [
  {
    setting_name: asyncMessagingSettingKey,
    setting_description:
      "When true, the agent will not await responses for the messages it sends out. The response is MESSAGE_RECEIVED for all async messages.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
