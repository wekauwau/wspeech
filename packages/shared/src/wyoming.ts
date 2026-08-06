import net from 'node:net';
import crypto from 'node:crypto';

interface WyomingEvent {
  type: string;
  data?: Record<string, unknown>;
  payload?: Buffer;
}

export interface PiperTtsResult {
  audio: Buffer;
  sampleRate: number;
}

export class WyomingClient {
  private host: string;
  private port: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  async synthesize(text: string): Promise<PiperTtsResult> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let audioBuffer = Buffer.alloc(0);
      let sampleRate = 22050;
      let buffer = Buffer.alloc(0);

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Piper TTS timeout'));
      }, 60_000);

      socket.connect(this.port, this.host, () => {
        // Send describe
        this.sendEvent(socket, { type: 'describe' });
      });

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 4) {
          const eventLength = buffer.readUInt32BE(0);
          if (buffer.length < 4 + eventLength) break;

          const eventJson = buffer
            .subarray(4, 4 + eventLength)
            .toString('utf-8');
          buffer = buffer.subarray(4 + eventLength);

          const event: WyomingEvent = JSON.parse(eventJson);

          if (event.type === 'describe') {
            // After describe, send text-to-speak
            this.sendEvent(socket, {
              type: 'text-to-speak',
              data: { text },
            });
          } else if (event.type === 'audio-start') {
            audioBuffer = Buffer.alloc(0);
            sampleRate =
              (event.data as { sample_rate?: number })?.sample_rate ?? 22050;
          } else if (event.type === 'audio-chunk' && event.payload) {
            audioBuffer = Buffer.concat([audioBuffer, event.payload]);
          } else if (event.type === 'audio-stop') {
            clearTimeout(timeout);
            socket.destroy();
            resolve({ audio: audioBuffer, sampleRate });
            return;
          } else if (event.type === 'error') {
            clearTimeout(timeout);
            socket.destroy();
            reject(
              new Error(
                (event.data as { message?: string })?.message ?? 'Piper error',
              ),
            );
            return;
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      socket.on('close', () => {
        clearTimeout(timeout);
        if (audioBuffer.length > 0) {
          resolve({ audio: audioBuffer, sampleRate });
        } else {
          reject(new Error('Connection closed without audio'));
        }
      });
    });
  }

  private sendEvent(socket: net.Socket, event: WyomingEvent) {
    const json = JSON.stringify({
      ...event,
      id: crypto.randomUUID(),
    });
    const jsonBuffer = Buffer.from(json, 'utf-8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(jsonBuffer.length, 0);
    socket.write(Buffer.concat([lengthBuffer, jsonBuffer]));
  }
}
