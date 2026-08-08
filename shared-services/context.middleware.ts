import { getContext as sdkGetContext, createEngineClient } from "@orchestration-ai/sdk/services";
import type { Context } from "@orchestration-ai/sdk/services";
import { getRequiredEnvValue } from "./environment.ts";
import process from "node:process";

export async function getContext(layerId: string): Promise<Context> {
  const client = createEngineClient(
    process.env.ENGINE_URL ?? null,
    getRequiredEnvValue("OAI_ACCESS_KEY")
  );
  return sdkGetContext(layerId, client);
}
