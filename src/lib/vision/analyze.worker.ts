/// <reference lib="webworker" />

import { type AnalyzeRequest, analyzePhoto } from './analyze';

export interface WorkerRequest extends AnalyzeRequest {
  requestId: string;
}

export type WorkerResponse =
  | { requestId: string; ok: true; result: ReturnType<typeof analyzePhoto> }
  | { requestId: string; ok: false; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, ...request } = event.data;
  try {
    const result = analyzePhoto(request);
    const response: WorkerResponse = { requestId, ok: true, result };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
