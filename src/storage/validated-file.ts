export interface ValidatedSubmissionFile {
  buffer: Buffer;
  originalName: string;
  format: string;
  bytes: number;
  digest: string;
}
