import sharp from 'sharp';

const IMAGE_FORMATS: Record<string, string> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  avif: 'heif',
  tif: 'tiff',
  tiff: 'tiff',
};
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_PAGES = 250;

export async function validateImageContent(buffer: Buffer, extension: string) {
  const image = sharp(buffer, {
    animated: true,
    failOn: 'warning',
    limitInputPixels: MAX_IMAGE_PIXELS,
  });
  const metadata = await image.metadata();
  if (
    !IMAGE_FORMATS[extension] ||
    metadata.format !== IMAGE_FORMATS[extension] ||
    (extension === 'avif' && metadata.compression !== 'av1') ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) > MAX_IMAGE_PAGES ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS
  )
    throw new Error('Invalid image format or dimensions');
  // Decode pixel data as well as the header to reject truncated/corrupt images.
  // The original buffer is retained for storage and download.
  await image.timeout({ seconds: 10 }).stats();
}
