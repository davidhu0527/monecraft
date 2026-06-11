/* eslint-disable @next/next/no-img-element -- tiny generated data-URL sprites; next/image cannot optimize them */

type PixelImgProps = {
  src: string;
  alt: string;
  size: number;
  className?: string;
  "aria-hidden"?: boolean;
};

/** An <img> for generated pixel-art sprites: never draggable, always pixelated. */
export default function PixelImg({ src, alt, size, className, "aria-hidden": ariaHidden }: PixelImgProps) {
  return <img src={src} alt={alt} draggable={false} width={size} height={size} className={className} aria-hidden={ariaHidden} style={{ imageRendering: "pixelated" }} />;
}
