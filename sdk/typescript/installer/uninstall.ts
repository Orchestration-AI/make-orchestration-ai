// Uninstall engine.
//
// Loads the install record from orchestration storage, runs each custom step's
// teardown hook (so third-party side effects are removed first), then deletes
// the OAI resources. Deleting the orchestration cascades to its children, so
// the primary action is a single orchestration delete; the recorded manifest is
// used to drive progress reporting and as a fallback.

import type { Client } from "../client";
import {
  orchestrationDeleteById,
  storageDownloadFileOrch,
  orchestrationFindByWorkspace,
} from "../sdk.gen";
import type { CustomStepDef, InstallRecord, OrchestrationInstaller } from "./define";
import { INSTALL_RECORD_PATH } from "./define";

export type UninstallProgressEvent =
  | { phase: "start"; steps: number }
  | { phase: "step"; id: string; status: "running" | "done" | "failed"; error?: string }
  | { phase: "resource"; kind: string; status: "deleting" | "done" | "failed"; error?: string }
  | { phase: "hook"; name: string; status: "running" | "done" | "failed"; error?: string }
  | { phase: "complete" }
  | { phase: "error"; message: string };

export type UninstallProgressSink = (event: UninstallProgressEvent) => void;

/**
 * Load the install record previously written to orchestration storage. The
 * download endpoint returns a signed URL; we follow it to fetch the JSON.
 */
export async function loadInstallRecord(
  client: Client,
  workspaceId: string,
  orchestrationId: string
): Promise<InstallRecord | null> {
  const { data, error } = await storageDownloadFileOrch({
    client,
    path: { workspaceId, orchestrationId },
    query: { path: INSTALL_RECORD_PATH },
  });
  if (error) return null;

  // The API may return a signed download URL object or the content directly.
  let text: string | null = null;
  if (typeof data === "string") {
    text = data;
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const url = (obj.download_url ?? obj.url ?? obj.signed_url) as string | undefined;
    if (url) {
      const res = await fetch(url);
      if (!res.ok) return null;
      text = await res.text();
    } else {
      text = JSON.stringify(obj);
    }
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as InstallRecord;
  } catch {
    return null;
  }
}

/** A discovered installation of this installer within a workspace. */
export type DiscoveredInstall = {
  orchestration_id: string;
  orchestration_name: string;
  installer_name: string;
  installer_version: string;
  installed_at: string;
};

/**
 * Discover existing installations of `installerName` within a workspace, for
 * cross-session uninstall. Lists the workspace's orchestrations and reads each
 * one's `.installer-state.json`, returning those written by this installer.
 */
export async function findInstalls(
  client: Client,
  workspaceId: string,
  installerName: string
): Promise<DiscoveredInstall[]> {
  const { data, error } = await orchestrationFindByWorkspace({
    client,
    path: { workspaceId },
  });
  if (error) return [];
  const orchestrations = data?.orchestrations ?? [];

  const found: DiscoveredInstall[] = [];
  await Promise.all(
    orchestrations.map(async (o) => {
      if (!o.id) return;
      const record = await loadInstallRecord(client, workspaceId, o.id);
      if (!record) return;
      if (record.installer_name !== installerName) return;
      found.push({
        orchestration_id: o.id,
        orchestration_name: o.orchestration_name,
        installer_name: record.installer_name,
        installer_version: record.installer_version,
        installed_at: record.installed_at,
      });
    })
  );
  // Most recently installed first.
  found.sort((a, b) => (a.installed_at < b.installed_at ? 1 : -1));
  return found;
}

export type UninstallOptions = {
  client: Client;
  record: InstallRecord;
  /** The definition, used to look up custom-step uninstall hooks. */
  def: OrchestrationInstaller;
  onProgress?: UninstallProgressSink;
};

/**
 * Tear down an installation. Returns normally on success; throws on fatal error
 * (after attempting as much teardown as possible).
 */
export async function uninstall(opts: UninstallOptions): Promise<void> {
  const { client, record, def } = opts;
  const emit = opts.onProgress ?? (() => {});
  const stepsById = new Map<string, CustomStepDef>((def.customSteps ?? []).map((s) => [s.id, s]));

  emit({ phase: "start", steps: record.custom_steps.length });

  // 1. Run custom-step teardown hooks first (third-party side effects).
  for (const saved of record.custom_steps) {
    const step = stepsById.get(saved.id);
    if (!step?.uninstall) continue;
    emit({ phase: "step", id: saved.id, status: "running" });
    try {
      await step.uninstall({
        apiClient: client,
        workspaceId: record.workspace_id,
        orchestrationId: record.orchestration_id,
        undo_state: saved.undo_state ?? {},
      });
      emit({ phase: "step", id: saved.id, status: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ phase: "step", id: saved.id, status: "failed", error: message });
      // Continue: a failed third-party teardown shouldn't block OAI cleanup,
      // but surface it so the user can act.
    }
  }

  // 2. Delete the orchestration (cascades to agents/layers/settings/files).
  emit({ phase: "resource", kind: "orchestration", status: "deleting" });
  try {
    const { error } = await orchestrationDeleteById({
      client,
      path: { workspaceId: record.workspace_id, id: record.orchestration_id },
    });
    if (error) throw new Error(JSON.stringify(error));
    emit({ phase: "resource", kind: "orchestration", status: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ phase: "resource", kind: "orchestration", status: "failed", error: message });
    emit({ phase: "error", message });
    throw new Error(`uninstall failed deleting orchestration: ${message}`);
  }

  // Installer-level post-uninstall hook. Non-fatal: reported but does not
  // resurrect the removed installation.
  if (def.onUninstalled) {
    emit({ phase: "hook", name: "onUninstalled", status: "running" });
    try {
      await def.onUninstalled({
        apiClient: client,
        workspaceId: record.workspace_id,
        orchestrationId: record.orchestration_id,
        record,
      });
      emit({ phase: "hook", name: "onUninstalled", status: "done" });
    } catch (hookErr) {
      emit({ phase: "hook", name: "onUninstalled", status: "failed", error: hookErr instanceof Error ? hookErr.message : String(hookErr) });
    }
  }

  emit({ phase: "complete" });
}
