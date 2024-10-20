// The identity of the agent sending the message
export type AgentIdentity = {
  agentId: string;
  agentName: string;

  layerId: string;
  layerIndex: number;
  numberOfLayers: number;

  orchestrationId: string;
};

export type Setting = {
  setting_description: string;
  setting_name: string;
} & (
  | {
      text_value: string;
      setting_type: "Text";
    }
  | {
      boolean_value: boolean;
      setting_type: "Boolean";
    }
);

export type Context = {
  identity: AgentIdentity;
  settings: Setting[];
};

type ServiceDescriptionParameters = Record<
  string,
  {
    optional: boolean;
    description: string;
  } & (
    | {
        type: "string" | "boolean" | "number";
      }
    | {
        type: "enum";
        options: string[];
      }
    | {
        type: "object";
        properties: ServiceDescriptionParameters;
      }
  )
>;

export type ServiceDescriptionPart = {
  path: string;
  description: string;
  method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT";
  parameters: ServiceDescriptionParameters;
};

export type ServiceDescription = ServiceDescriptionPart[];
