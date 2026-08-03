import { io, Socket } from 'socket.io-client';
import type { Client } from './client';
import { authGeneratePasskey } from './sdk.gen';

const DEFAULT_LOGGING_URL = 'https://oai-logging-21142163942.africa-south1.run.app';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LoggingPublisherOptions = {
  /** Override the logging service URL. Defaults to OAI_LOGGING_URL env var or the production URL. */
  url?: string;
} & (
  | { passkey: string; apiClient?: never }
  | { apiClient: Client; passkey?: never }
);

export interface LoggingPublisher {
  /** Publish a log message with an explicit level */
  log(level: LogLevel, message: string): void;
  /** Wrap the provided console object so all calls are also published to the logging service */
  wrapConsole(console: Console): void;
  /** Disconnect from the logging service */
  disconnect(): void;
}

export function createLoggingPublisher(options: LoggingPublisherOptions): LoggingPublisher {
  const url =
    options.url ??
    (typeof process !== 'undefined' ? process.env.OAI_LOGGING_URL : undefined) ??
    DEFAULT_LOGGING_URL;

  let socket: Socket | null = null;
  // Buffer logs emitted before the socket is ready
  const buffer: Array<{ level: LogLevel; text: string }> = [];

  async function connect(): Promise<void> {
    let passkey: string;

    if (options.apiClient) {
      const res = await authGeneratePasskey({ client: options.apiClient });
      const pk = (res.data as { passkey?: string })?.passkey;
      if (!pk) throw new Error('Failed to generate passkey from API client');
      passkey = pk;
    } else {
      passkey = options.passkey;
    }

    socket = io(`${url}/app`, {
      auth: { passkey },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socket.on('connect', () => {
      // Flush buffered logs once connected
      for (const entry of buffer.splice(0)) {
        socket!.emit('log', entry);
      }
    });
  }

  // Kick off connection immediately — fire and forget
  connect().catch(() => {
    // Connection failure is silent; logs will remain buffered or be dropped
  });

  function log(level: LogLevel, text: string): void {
    if (socket?.connected) {
      socket.emit('log', { level, text });
    } else {
      buffer.push({ level, text });
    }
  }

  function wrapConsole(cons: Console): void {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    for (const level of levels) {
      const original = cons[level].bind(cons);
      cons[level] = (...args: unknown[]) => {
        original(...args);
        log(level, args.map(String).join(' '));
      };
    }
  }

  function disconnect(): void {
    socket?.disconnect();
    socket = null;
  }

  return { log, wrapConsole, disconnect };
}
