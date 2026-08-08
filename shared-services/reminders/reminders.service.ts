import type { Context } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import type { Setting } from "@orchestration-ai/sdk/services";
import { getBooleanSetting } from "@orchestration-ai/sdk/services";
import { taskCreate, taskDeleteById, taskFindActiveByAgent, settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { REMINDER_SIGIL, CAN_USE_RECURRING_REMINDERS_KEY } from "./reminders.constants.ts";

function canUseRecurring(settings: Setting[]): boolean {
  return getBooleanSetting(settings, CAN_USE_RECURRING_REMINDERS_KEY);
}

async function getSettings(context: Context, apiClient: Client): Promise<Setting[]> {
  const { data } = await settingFindByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
  });
  return (data?.settings ?? []) as Setting[];
}

function stripSigil(message: string): string {
  return message.startsWith(REMINDER_SIGIL) ? message.slice(REMINDER_SIGIL.length).trimStart() : message;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listReminders(
  _body: Record<never, never>,
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  const { data } = await taskFindActiveByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
    query: { limit: 1000 },
  });

  const reminders = (data?.tasks ?? [])
    .filter((t) => t.message?.startsWith(REMINDER_SIGIL))
    .map((t) => ({
      id: t.id,
      message: stripSigil(t.message),
      cron_expression: t.cron_expression ?? null,
      value_date: t.value_date ?? null,
    }));

  return { reminders };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createReminder(
  body: { message: string; value_date?: string; cron_expression?: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  if (body.cron_expression) {
    const settings = await getSettings(context, apiClient);
    if (!canUseRecurring(settings)) {
      return { error: "Recurring reminders are disabled for this agent. An orchestrator must enable the CAN_USE_RECURRING_REMINDERS setting." };
    }
  }

  const { data } = await taskCreate({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
    body: {
      message: `${REMINDER_SIGIL} ${body.message}`,
      ...(context.sessionId ? { session_id: context.sessionId } : {}),
      ...(body.value_date ? { value_date: body.value_date } : {}),
      ...(body.cron_expression ? { cron_expression: body.cron_expression } : {}),
    },
  });

  return { reminder: { id: (data as { id?: string })?.id, message: body.message, cron_expression: body.cron_expression ?? null, value_date: body.value_date ?? null } };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateReminder(
  body: { id: string; message: string; value_date?: string; cron_expression?: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  if (body.cron_expression) {
    const settings = await getSettings(context, apiClient);
    if (!canUseRecurring(settings)) {
      return { error: "Recurring reminders are disabled for this agent. An orchestrator must enable the CAN_USE_RECURRING_REMINDERS setting." };
    }
  }

  await taskDeleteById({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
      taskId: body.id,
    },
  });

  const { data } = await taskCreate({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
    body: {
      message: `${REMINDER_SIGIL} ${body.message}`,
      ...(context.sessionId ? { session_id: context.sessionId } : {}),
      ...(body.value_date ? { value_date: body.value_date } : {}),
      ...(body.cron_expression ? { cron_expression: body.cron_expression } : {}),
    },
  });

  return { reminder: { id: (data as { id?: string })?.id, message: body.message, cron_expression: body.cron_expression ?? null, value_date: body.value_date ?? null } };
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteReminder(
  body: { id: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  await taskDeleteById({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
      taskId: body.id,
    },
  });

  return { success: true };
}
