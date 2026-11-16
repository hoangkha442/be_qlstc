import { validateZipContent } from './zip-validator.js';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'csv',
  'md',
  'json',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'php',
  'py',
  'java',
  'cs',
  'go',
  'rs',
  'sql',
  'c',
  'cpp',
  'h',
  'hpp',
  'rb',
  'kt',
  'swift',
  'dart',
  'yaml',
  'yml',
  'ipynb',
  'd.ts',
]);

export async function validateDocumentContent(
  buffer: Buffer,
  extension: string,
) {
  if (extension === 'zip') return validateZipContent(buffer);
  if (extension === 'pdf') {
    if (
      !/^%PDF-[12]\.\d/.test(buffer.subarray(0, 8).toString('ascii')) ||
      !buffer
        .subarray(Math.max(0, buffer.length - 1024))
        .includes(Buffer.from('%%EOF'))
    )
      throw new Error('Invalid PDF signature');
  } else if (extension === 'rar') {
    if (
      !buffer.subarray(0, 7).equals(Buffer.from('526172211a0700', 'hex')) &&
      !buffer.subarray(0, 8).equals(Buffer.from('526172211a070100', 'hex'))
    )
      throw new Error('Invalid RAR signature');
  } else if (extension === '7z') {
    if (
      buffer.length < 32 ||
      !buffer.subarray(0, 6).equals(Buffer.from('377abcaf271c', 'hex'))
    )
      throw new Error('Invalid 7z signature');
  } else if (extension === 'gz' || extension.endsWith('.gz')) {
    if (
      buffer.length < 18 ||
      !buffer.subarray(0, 3).equals(Buffer.from('1f8b08', 'hex'))
    )
      throw new Error('Invalid gzip signature');
  } else if (TEXT_EXTENSIONS.has(extension)) {
    const utf16 =
      buffer[0] === 0xff && buffer[1] === 0xfe
        ? 'utf-16le'
        : buffer[0] === 0xfe && buffer[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    const text = new TextDecoder(utf16, { fatal: true }).decode(buffer);
    if (text.includes('\0')) throw new Error('Binary content in text file');
    if (extension === 'json' || extension === 'ipynb') JSON.parse(text);
  }
  // Other extensions explicitly configured by the lecturer are retained as
  // private attachments; never execute, render or extract them on the server.
}
