import { createWriteStream } from "fs";
import { Writable } from "stream";
import type { DownloadService } from "../ports/download.js";

/**
 * Create a download service using fetch.
 */
export function createFetchDownloadService(
  fetchImpl: typeof fetch = globalThis.fetch
): DownloadService {
  return {
    async download(url: string, outputPath: string): Promise<void> {
      const response = await fetchImpl(url);

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const fileStream = createWriteStream(outputPath);

      await new Promise<void>((resolve, reject) => {
        const reader = response.body!.getReader();
        const writable = Writable.toWeb(fileStream);
        const writableStream = writable as WritableStream<Uint8Array>;

        new ReadableStream({
          async start(controller) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          },
        })
          .pipeTo(writableStream)
          .then(resolve)
          .catch(reject);
      });
    },
  };
}

/**
 * Default download service instance.
 */
export const fetchDownloadService = createFetchDownloadService();
