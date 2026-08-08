import { defineService } from "@orchestration-ai/sdk/app-builder";
import type { Context, Setting, Client } from "@orchestration-ai/sdk/app-builder";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { defaultSettings } from "./sql-server.constants.ts";
import { sqlServerServiceFunctions } from "./sql-server.description.ts";
import { runQuery } from "./sql-server.service.ts";

export const sqlServerService = defineService({
  unique_name: "sql-server",
  service_name: "OAI Sql Server",
  service_description: "Run queries on a SQL Server database.",
  defaultSettings,
  description: sqlServerServiceFunctions,
  tools: {
    run_query: async (body: { query: string }, context: Context, _engineClient: Client, apiClient: Client) => {
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });
      return runQuery(body.query, data!.settings! as Setting[]);
    },
  },
});
