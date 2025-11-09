import { ServiceDescription } from "../types.ts";

export const mathJsServiceFunctions: ServiceDescription = [
  {
    path: "evaluate",
    method: "POST",
    description: "Evaluates given expression with mathjs.",
    parameters: {
      expression: {
        type: "string",
        optional: false,
        description: "The expression to evaluate.",
      },
    },
  },
];
