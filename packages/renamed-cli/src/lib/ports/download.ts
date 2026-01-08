/**
 * Abstraction for file download operations.
 * Allows testing without actual network requests.
 */
export interface DownloadService {
  /** Download a file from URL to local path */
  download(url: string, outputPath: string): Promise<void>;
}
