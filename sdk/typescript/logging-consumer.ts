import { io, Socket } from 'socket.io-client';
import type { LogLevel } from './logging-publisher';

export type { LogLevel };

const DEFAULT_LOGGING_URL = 'https://oai-logging-21142163942.africa-south1.run.app';

export interface LogFilter {
  workspaceId?: string;
  orchestrationId?: string;
  agentId?: string;
}

export interface LogMessage {
  text: string;
  level: LogLevel;
  context: {
    workspaceId: string;
    orchestrationId?: string;
    agentId?: string;
    layerId?: string;
  };
  applicationId: string;
  timestamp: string;
}

export interface LoggingConsumerOptions {
  /** Firebase JWT for the authenticated user. Required. */
  token: string;
  /** The resource context to subscribe to. At least one id is required. */
  filter: LogFilter;
  /** Override the logging service URL. */
  url?: string;
}

export interface LoggingConsumer {
  /** Register a handler to receive log messages */
  onLog(handler: (message: LogMessage) => void): void;
  /** Disconnect from the logging service */
  disconnect(): void;
}

export function createLoggingConsumer(options: LoggingConsumerOptions): LoggingConsumer {
  const url = options.url ?? DEFAULT_LOGGING_URL;

  const socket: Socket = io(`${url}/client`, {
    auth: { token: options.token, filter: options.filter },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  function onLog(handler: (message: LogMessage) => void): void {
    socket.on('log', handler);
  }

  function disconnect(): void {
    socket.disconnect();
  }

  return { onLog, disconnect };
}
