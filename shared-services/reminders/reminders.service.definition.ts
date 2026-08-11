import { defineService } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { defaultSettings, REMINDERS_SERVICE_UNIQUE_NAME } from "./reminders.constants.ts";
import { listReminders, createReminder, updateReminder, deleteReminder } from "./reminders.service.ts";

export const remindersService = defineService({
  unique_name: REMINDERS_SERVICE_UNIQUE_NAME,
  service_name: "OAI Reminders",
  service_description: "Set and manage personal reminders as scheduled ticker tasks.",
  defaultSettings,
  description: [
    {
      path: "reminders_now" as const,
      method: "POST" as const,
      description: "Part of OAI Reminders. Returns the current date and time. Use this before creating or updating reminders to get accurate time context.",
      parameters: {},
    },
    {
      path: "list_reminders" as const,
      method: "POST" as const,
      description: "Part of OAI Reminders. Lists all active reminders for this agent.",
      parameters: {},
    },
    {
      path: "create_reminder" as const,
      method: "POST" as const,
      description: "Part of OAI Reminders. Creates a new reminder. Use value_date for a one-time reminder (ISO 8601). Use cron_expression for recurring reminders - requires the CAN_USE_RECURRING_REMINDERS setting to be enabled by an orchestrator.",
      parameters: {
        message: { type: "string" as const, optional: false, description: "The reminder message." },
        value_date: { type: "string" as const, optional: true, description: "ISO 8601 datetime for a one-time reminder, e.g. '2025-12-31T09:00:00Z'." },
        cron_expression: { type: "string" as const, optional: true, description: "Cron expression for a recurring reminder, e.g. '0 9 * * 1' for every Monday at 9am. Requires CAN_USE_RECURRING_REMINDERS setting." },
      },
    },
    {
      path: "update_reminder" as const,
      method: "POST" as const,
      description: "Part of OAI Reminders. Updates an existing reminder by id (deletes and recreates it). Use list_reminders to find the id.",
      parameters: {
        id: { type: "string" as const, optional: false, description: "Id of the reminder to update." },
        message: { type: "string" as const, optional: false, description: "Updated reminder message." },
        value_date: { type: "string" as const, optional: true, description: "Updated ISO 8601 datetime." },
        cron_expression: { type: "string" as const, optional: true, description: "Updated cron expression. Requires CAN_USE_RECURRING_REMINDERS setting." },
      },
    },
    {
      path: "delete_reminder" as const,
      method: "POST" as const,
      description: "Part of OAI Reminders. Permanently deletes a reminder by id. Use list_reminders to find the id.",
      parameters: {
        id: { type: "string" as const, optional: false, description: "Id of the reminder to delete." },
      },
    },
  ],
  tools: {
    reminders_now: () => {
      const now = new Date();
      const iso = now.toISOString();
      const readable = now.toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
      return `${readable} (${iso})`;
    },
    list_reminders: (body: Record<never, never>, context: Context, engineClient: Client, apiClient: Client) =>
      listReminders(body, context, engineClient, apiClient),
    create_reminder: (body: Parameters<typeof createReminder>[0], context: Context, engineClient: Client, apiClient: Client) =>
      createReminder(body, context, engineClient, apiClient),
    update_reminder: (body: Parameters<typeof updateReminder>[0], context: Context, engineClient: Client, apiClient: Client) =>
      updateReminder(body, context, engineClient, apiClient),
    delete_reminder: (body: { id: string }, context: Context, engineClient: Client, apiClient: Client) =>
      deleteReminder(body, context, engineClient, apiClient),
  },
});
