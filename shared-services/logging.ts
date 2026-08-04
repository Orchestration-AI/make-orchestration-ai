import { createLoggingPublisher } from "@orchestration-ai/sdk/logging-publisher";
import { getRequiredEnvValue } from "./environment.ts";

const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
const publisher = createLoggingPublisher({ accessKey });
publisher.wrapConsole(console);
