import type {
  Context,
  ServiceDescription,
  ServiceDescriptionPart,
} from "../types.ts";

export function getDescriptionForContext(context: Context): ServiceDescription {
  const layerBelow: ServiceDescriptionPart = {
    path: "message_layer_below",
    method: "POST",
    description:
      "Part of OAI Messaging Service. Sends a message to the layer immediately below this layer.",
    parameters: {
      message: {
        type: "string",
        optional: false,
        description: "The message to send.",
      },
    },
  };

  const layerAbove: ServiceDescriptionPart = {
    path: "message_layer_above",
    method: "POST",
    description:
      "Part of OAI Messaging Service. Sends a message to the layer immediately above this layer.",
    parameters: {
      message: {
        type: "string",
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
