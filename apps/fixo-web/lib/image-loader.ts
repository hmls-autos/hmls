"use client";

interface ImageLoaderParams {
  src: string;
  width: number;
  quality?: number;
}

export default function imageLoader({ src }: ImageLoaderParams): string {
  // Deno Deploy doesn't have a built-in image optimizer.
  // Return the src as-is, but Next.js still generates sizes/srcSet/loading attributes.
  return src;
}
