import { defineService } from "@orchestration-ai/sdk/app-builder";
import { mathJsServiceFunctions } from "./mathjs.description.ts";
import { create, all } from "npm:mathjs";

const math = create(all, {});

export const mathjsService = defineService({
  unique_name: "mathjs",
  service_name: "OAI MathJs",
  service_description: "Allows agents to evaluate mathjs expression with mathjs.",
  description: mathJsServiceFunctions,
  tools: {
    evaluate: (body: { expression: string }) => {
      const result = math.evaluate(body.expression);
      return result;
    },
  },
});
