import type { Context, ServiceDescription } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";

export function getDescriptionForContext(context: Context, _engineClient: Client, _apiClient: Client): ServiceDescription {
  const layerBelow = {
    path: "message_layer_below" as const,
    method: "POST" as const,
    description:
      "Part of OAI Messaging Service. Sends a message to the layer immediately below this layer.",
    parameters: {
      message: {
        type: "string" as const,
        optional: false,
        description: "The message to send.",
      },
    },
  };

  const layerAbove = {
    path: "message_layer_above" as const,
    method: "POST" as const,
    description:
      "Part of OAI Messaging Service. Sends a message to the layer immediately above this layer.",
    parameters: {
      message: {
        type: "string" as const,
        optional: false,
        description: "The message to send.",
      },
    },
  };

  return [
    {
      path: "message_other_agent",
      method: "POST",
      description:
        "Part of OAI Messaging Service. Sends a message to another agent.",
      parameters: {
        agentId: {
          type: "string",
          optional: false,
          description: "The id of the agent to message.",
        },
        message: {
          type: "string",
          optional: false,
          description: "The message to send.",
        },
      },
    },

    ...(context.identity.numberOfLayers === 1
      ? []
      : [
          ...(context.identity.layerIndex === 0
            ? [layerBelow]
            : [
                ...(context.identity.layerIndex ===
                context.identity.numberOfLayers - 1
                  ? [layerAbove]
                  : [layerBelow, layerAbove]),
              ]),
        ]),
  ];
}
