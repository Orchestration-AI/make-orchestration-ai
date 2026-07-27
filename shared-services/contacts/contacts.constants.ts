import type { Setting } from "@orchestration-ai/sdk/services";

import { asyncMessagingSettingKey } from "../messages/messaging.constants.ts";

export const CAN_MODIFY_CONTACTS_KEY = "CAN_MODIFY_CONTACTS";
export const CONTACTS_SERVICE_UNIQUE_NAME = "contacts";
export const CONTACTS_STORAGE_PATH = "contacts/contacts.json";

export { asyncMessagingSettingKey };

export const defaultSettings: Setting[] = [
  {
    setting_name: CAN_MODIFY_CONTACTS_KEY,
    setting_description: "Allow this agent to create, update, and delete contacts.",
    setting_type: "Boolean",
    boolean_value: false,
  },
  {
    setting_name: asyncMessagingSettingKey,
    setting_description: "When true, messages sent via message_contact are submitted as ticker tasks instead of being sent directly. message_group always uses ticker regardless of this setting.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
