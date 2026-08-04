import { io, Socket } from 'socket.io-client';

const DEFAULT_LOGGING_URL = 'https://oai-logging-21142163942.africa-south1.run.app';

export type LogLevel = 'log' | 'debug' | 'info' | 'warn' | 'error';

export interface LoggingPublisherOptions {
  /** The application's access key. */
  accessKey: string;
  /** Override the logging service URL. Defaults to OAI_LOGGING_URL env var or the production URL. */
  url?: string;
}

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

  // Buffer logs emitted before the socket connects or while reconnecting
  const buffer: Array<{ level: LogLevel; text: string }> = [];
  let connected = false;

  const socket: Socket = io(`${url}/app`, {
    auth: { accessKey: options.accessKey },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  socket.on('connect', () => {
    connected = true;
    console.log(`[oai-publisher] socket connected, flushing buffer size=${buffer.length}`);
    for (const entry of buffer.splice(0)) {
      socket.emit('log', entry);
    }
  });

  socket.on('disconnect', (reason) => {
    connected = false;
    console.log(`[oai-publisher] socket disconnected reason=${reason} buffer size=${buffer.length}`);
  });

  socket.on('connect_error', (err) => {
    console.log(`[oai-publisher] connect_error: ${err.message}`);
  });

  function log(level: LogLevel, text: string): void {
    if (connected) {
      socket.emit('log', { level, text });
    } else {
      buffer.push({ level, text });
    }
  }

  function wrapConsole(cons: Console): void {
    const levels: LogLevel[] = ['log', 'debug', 'info', 'warn', 'error'];
    for (const level of levels) {
      const original = cons[level].bind(cons);
      cons[level] = (...args: unknown[]) => {
        original(...args);
        const text = args.map(String).join(' ');
        original(`[oai-publisher] emitting level=${level} connected=${connected} text=${text}`);
        log(level, text);
      };
    }
  }

  function disconnect(): void {
    socket.disconnect();
  }

  return { log, wrapConsole, disconnect };
}
