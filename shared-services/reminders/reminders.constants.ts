import type { Setting } from "@orchestration-ai/sdk/services";

export const REMINDERS_SERVICE_UNIQUE_NAME = "reminders";
export const REMINDER_SIGIL = "[OAI:REMINDER]";
export const CAN_USE_RECURRING_REMINDERS_KEY = "CAN_USE_RECURRING_REMINDERS";

export const defaultSettings: Setting[] = [
  {
    setting_name: CAN_USE_RECURRING_REMINDERS_KEY,
    setting_description: "Allow this agent to create recurring reminders using cron expressions. Disabled by default to prevent uncontrolled token usage.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
