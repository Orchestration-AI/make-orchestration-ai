import type { ServiceDescription } from "../types.ts";

export const sqlServerServiceFunctions: ServiceDescription = [
  {
    path: "run_query",
    method: "POST",
    description:
      "Part of the OAI Sql Server Service. Runs the given t-sql query on the connected database and returns the result.",
    parameters: {
      query: {
        type: "string",
        optional: false,
        description: "The t-sql query to to run.",
      },
    },
  },
];
