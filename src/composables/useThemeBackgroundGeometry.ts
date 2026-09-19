
export interface BackgroundGeometry {
  width: number;
  height: number;
}

export function calculateCoverGeometry(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): BackgroundGeometry | null {
  if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) {
    return null;
  }

  const containerRatio = containerW / containerH;
  const imageRatio = imageW / imageH;

  let width = containerW;
  let height = containerH;

  if (imageRatio > containerRatio) {
    height = containerH;
    width = containerH * imageRatio;
  } else {
    width = containerW;
    height = containerW / imageRatio;
  }

  return { width, height };
}
