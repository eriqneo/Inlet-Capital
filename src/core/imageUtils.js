export const dataUrlToBlob = async (dataUrl) => {
  const response = await fetch(dataUrl);
  return await response.blob();
};

export const blobToFile = (blob, filename = 'image.webp') => {
  const extension = blob.type === 'image/jpeg' ? 'jpg' : (blob.type === 'image/png' ? 'png' : 'webp');
  const safeName = filename.replace(/\.[^.]+$/, '');
  return new File([blob], `${safeName}.${extension}`, { type: blob.type || 'image/webp' });
};

export const compressImageSource = async (source, {
  maxWidth = 640,
  maxHeight = 640,
  quality = 0.72,
  mimeType = 'image/webp',
  filename = 'image.webp',
  targetMaxBytes = 450 * 1024
} = {}) => {
  const sourceUrl = typeof source === 'string' ? source : URL.createObjectURL(source);

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not process image.'));
      image.src = sourceUrl;
    });

    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    const renderCanvas = (targetWidth, targetHeight) => {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.getContext('2d').drawImage(img, 0, 0, targetWidth, targetHeight);
    };
    renderCanvas(width, height);

    let currentQuality = quality;
    let dataUrl = canvas.toDataURL(mimeType, currentQuality);
    let blob = await dataUrlToBlob(dataUrl);

    while (blob.size > targetMaxBytes && currentQuality > 0.42) {
      currentQuality = Math.max(0.42, currentQuality - 0.08);
      dataUrl = canvas.toDataURL(mimeType, currentQuality);
      blob = await dataUrlToBlob(dataUrl);
    }

    let currentWidth = width;
    let currentHeight = height;
    while (blob.size > targetMaxBytes && currentWidth > 320 && currentHeight > 320) {
      currentWidth = Math.round(currentWidth * 0.85);
      currentHeight = Math.round(currentHeight * 0.85);
      renderCanvas(currentWidth, currentHeight);
      dataUrl = canvas.toDataURL(mimeType, currentQuality);
      blob = await dataUrlToBlob(dataUrl);
    }

    return {
      dataUrl,
      blob,
      file: blobToFile(blob, filename),
      sizeKb: Math.round(blob.size / 1024)
    };
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(sourceUrl);
  }
};
