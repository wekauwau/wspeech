import net from 'node:net';

export interface PiperTtsResult {
  audio: Buffer;
  sampleRate: number;
}

function createWavHeader(
  pcmLength: number,
  sampleRate: number,
  numChannels = 1,
  bitsPerSample = 16,
): Buffer {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmLength, 40);

  return header;
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  return Buffer.concat([createWavHeader(pcm.length, sampleRate), pcm]);
}

interface ParserState {
  mode: 'line' | 'data' | 'payload';
  lineBuffer: string;
  event: Record<string, unknown> | null;
  remainingBytes: number;
  dataAccumulator: Buffer;
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

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Piper TTS timeout'));
      }, 60_000);

      const state: ParserState = {
        mode: 'line',
        lineBuffer: '',
        event: null,
        remainingBytes: 0,
        dataAccumulator: Buffer.alloc(0),
      };

      const processEvent = (event: Record<string, unknown>) => {
        const type = event.type as string;

        if (type === 'info') {
          const dataBytes = Buffer.from(JSON.stringify({ text }), 'utf-8');
          socket.write(
            JSON.stringify({
              type: 'synthesize',
              data_length: dataBytes.length,
              version: 1,
            }) + '\n',
          );
          socket.write(dataBytes);
        } else if (type === 'audio-start') {
          audioBuffer = Buffer.alloc(0);
          const data = event.data as Record<string, unknown> | undefined;
          sampleRate = (data?.sample_rate as number) ?? 22050;
        } else if (type === 'audio-chunk' && event.payload) {
          audioBuffer = Buffer.concat([audioBuffer, event.payload as Buffer]);
        } else if (type === 'audio-stop') {
          clearTimeout(timeout);
          socket.destroy();
          resolve({ audio: pcmToWav(audioBuffer, sampleRate), sampleRate });
        } else if (type === 'error') {
          clearTimeout(timeout);
          socket.destroy();
          const data = event.data as Record<string, unknown> | undefined;
          reject(new Error((data?.message as string) ?? 'Piper error'));
        }
      };

      const parseChunk = (buf: Buffer): Buffer<ArrayBufferLike> => {
        while (buf.length > 0) {
          if (state.mode === 'line') {
            const nlIdx = buf.indexOf(0x0a); // '\n'
            if (nlIdx === -1) {
              state.lineBuffer += buf.toString('utf-8');
              return Buffer.alloc(0);
            }
            state.lineBuffer += buf.subarray(0, nlIdx).toString('utf-8');
            buf = buf.subarray(nlIdx + 1);

            if (state.lineBuffer.trim()) {
              const event = JSON.parse(state.lineBuffer);
              state.event = event;
              state.lineBuffer = '';

              const dataLen = (event.data_length as number) ?? 0;
              const payloadLen = (event.payload_length as number) ?? 0;

              if (dataLen > 0) {
                state.remainingBytes = dataLen;
                state.mode = 'data';
              } else if (payloadLen > 0) {
                state.remainingBytes = payloadLen;
                state.mode = 'payload';
              } else {
                processEvent(event);
                state.event = null;
              }
            } else {
              state.lineBuffer = '';
            }
          } else if (state.mode === 'data') {
            const needed = state.remainingBytes;
            const take = Math.min(needed, buf.length);

            state.dataAccumulator = Buffer.concat([
              state.dataAccumulator,
              buf.subarray(0, take),
            ]);

            buf = buf.subarray(take);
            state.remainingBytes -= take;

            if (state.remainingBytes <= 0) {
              const event = state.event!;
              const parsed = JSON.parse(
                state.dataAccumulator.toString('utf-8'),
              );
              if (event.data) {
                Object.assign(event.data, parsed);
              } else {
                event.data = parsed;
              }
              state.dataAccumulator = Buffer.alloc(0);

              const payloadLen = (event.payload_length as number) ?? 0;
              if (payloadLen > 0) {
                state.remainingBytes = payloadLen;
                state.mode = 'payload';
              } else {
                processEvent(event);
                state.event = null;
                state.mode = 'line';
              }
            }
          } else if (state.mode === 'payload') {
            const needed = state.remainingBytes;
            const take = Math.min(needed, buf.length);

            state.dataAccumulator = Buffer.concat([
              state.dataAccumulator,
              buf.subarray(0, take),
            ]);

            buf = buf.subarray(take);
            state.remainingBytes -= take;

            if (state.remainingBytes <= 0) {
              const event = state.event!;
              event.payload = state.dataAccumulator;
              state.dataAccumulator = Buffer.alloc(0);

              processEvent(event);
              state.event = null;
              state.mode = 'line';
            }
          }
        }
        return buf;
      };

      socket.connect(this.port, this.host, () => {
        socket.write(JSON.stringify({ type: 'describe', version: 1 }) + '\n');
      });

      let remaining: Buffer<ArrayBufferLike> = Buffer.alloc(0);

      socket.on('data', (chunk: Buffer) => {
        remaining = Buffer.concat([remaining, chunk]);
        remaining = parseChunk(remaining);
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      socket.on('close', () => {
        clearTimeout(timeout);
        if (audioBuffer.length > 0) {
          resolve({ audio: pcmToWav(audioBuffer, sampleRate), sampleRate });
        } else {
          reject(new Error('Connection closed without audio'));
        }
      });
    });
  }
}
