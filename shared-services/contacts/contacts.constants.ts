import type { Setting } from "@orchestration-ai/sdk/services";

export const CAN_MODIFY_CONTACTS_KEY = "CAN_MODIFY_CONTACTS";
export const CONTACTS_SERVICE_UNIQUE_NAME = "contacts";
export const CONTACTS_STORAGE_PATH = "contacts/contacts.json";

export const defaultSettings: Setting[] = [
  {
    setting_name: CAN_MODIFY_CONTACTS_KEY,
    setting_description: "Allow this agent to create, update, and delete contacts.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
