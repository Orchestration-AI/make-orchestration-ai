import type { ServiceDescription } from "@orchestration-ai/sdk/services";

export const timeServiceFunctions: ServiceDescription = [
  {
    path: "now",
    method: "POST",
    description: "Returns the current date and time.",
    parameters: {},
  },
  {
    path: "add",
    method: "POST",
    description: "Adds a duration to a given ISO 8601 datetime and returns the resulting ISO 8601 string.",
    parameters: {
      datetime: {
        type: "string",
        optional: false,
        description: "The base ISO 8601 datetime string.",
      },
      amount: {
        type: "number",
        optional: false,
        description: "The numeric amount to add.",
      },
      unit: {
        type: "string",
        optional: false,
        description: "The unit of the duration: milliseconds, seconds, minutes, hours, days, weeks.",
      },
    },
  },
  {
    path: "diff",
    method: "POST",
    description: "Calculates the difference between two ISO 8601 datetimes and returns the result in the specified unit.",
    parameters: {
      from: {
        type: "string",
        optional: false,
        description: "The start ISO 8601 datetime string.",
      },
      to: {
        type: "string",
        optional: false,
        description: "The end ISO 8601 datetime string.",
      },
      unit: {
        type: "string",
        optional: false,
        description: "The unit to express the difference in: milliseconds, seconds, minutes, hours, days, weeks.",
      },
    },
  },
];
