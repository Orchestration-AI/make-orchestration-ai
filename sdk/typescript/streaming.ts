export type StreamingChannel = 'response' | 'response_end' | 'response_cancelled' | 'error';

export type ServerMessage = {
  channel: StreamingChannel;
  data: string;
};

export type StreamingChatConfig = {
  engineUrl?: string;
  accessKey?: string;
};

export type StreamingChatEvents = {
  onChunk?: (text: string) => void;
  onResponse?: (fullText: string) => void;
  onCancelled?: () => void;
  onError?: (error: string) => void;
  onClose?: () => void;
  onOpen?: () => void;
};

export type StreamingChat = {
  send: (message: string) => void;
  cancel: () => void;
  close: () => void;
};

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] ?? '';
  }
  return '';
}

export function openStreamingChat(
  agentId: string,
  layerIndex: number,
  events: StreamingChatEvents,
  config?: StreamingChatConfig
): StreamingChat {
  const engineUrl = config?.engineUrl || getEnv('ENGINE_URL') || 'https://engine.orchestration-ai.com';
  const accessKey = config?.accessKey || getEnv('OAI_ACCESS_KEY') || '';

  const wsUrl = engineUrl.replace(/^http/, 'ws');
  const url = `${wsUrl}/agents/${agentId}/layers/${layerIndex}/ws?token=${encodeURIComponent(accessKey)}`;

  const ws = new WebSocket(url);
  let buffer = '';

  ws.onopen = () => {
    events.onOpen?.();
  };

  ws.onmessage = (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return;
    }

    switch (msg.channel) {
      case 'response':
        buffer += msg.data;
        events.onChunk?.(msg.data);
        break;
      case 'response_end':
        events.onResponse?.(buffer);
        buffer = '';
        break;
      case 'response_cancelled':
        buffer = '';
        events.onCancelled?.();
        break;
      case 'error':
        buffer = '';
        events.onError?.(msg.data);
        break;
    }
  };

  ws.onclose = () => {
    events.onClose?.();
  };

  ws.onerror = () => {
    events.onError?.('WebSocket connection error');
  };

  return {
    send(message: string) {
      buffer = '';
      ws.send(JSON.stringify({ message }));
    },
    cancel() {
      ws.send(JSON.stringify({ type: 'cancel' }));
    },
    close() {
      ws.close();
    },
  };
}
