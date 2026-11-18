import { isNullish } from '@dfinity/utils';

/**
 * Client-side image helpers. Kept framework-free so any surface can
 * downscale a user-picked file before handing the bytes to Juno Storage;
 * we never upload the raw camera-resolution original.
 */

/**
 * Downscale an image file to a square cover JPEG `Blob`.
 *
 * The source is drawn cover-fit (centre-cropped to a square, no
 * distortion) into a `size`×`size` canvas, then encoded as JPEG at the
 * given quality. Cover-fit matches how the league logo tile renders the
 * result (`object-fit: cover`), so what the user previews is what they
 * uploaded.
 *
 * Returns `null` when the environment can't paint a canvas (SSR, no 2D
 * context, or `toBlob` unavailable) so callers can surface a friendly
 * error instead of throwing.
 */
export const downscaleImageToSquareJpeg = async ({
	file,
	size,
	quality
}: {
	file: Blob;
	size: number;
	quality: number;
}): Promise<Blob | null> => {
	if (typeof document === 'undefined') {
		return null;
	}

	const bitmap = await loadBitmap(file);

	if (isNullish(bitmap)) {
		return null;
	}

	try {
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;

		const ctx = canvas.getContext('2d');

		if (isNullish(ctx) || typeof canvas.toBlob !== 'function') {
			return null;
		}

		// Cover-fit: scale so the shorter source edge fills the square,
		// then centre the overflow off-canvas (centre crop).
		const scale = Math.max(size / bitmap.width, size / bitmap.height);
		const drawWidth = bitmap.width * scale;
		const drawHeight = bitmap.height * scale;
		const dx = (size - drawWidth) / 2;
		const dy = (size - drawHeight) / 2;

		ctx.drawImage(bitmap, dx, dy, drawWidth, drawHeight);

		return await new Promise<Blob | null>((resolve) => {
			canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
		});
	} finally {
		// `ImageBitmap` holds a decoded copy; release it eagerly.
		if ('close' in bitmap && typeof bitmap.close === 'function') {
			bitmap.close();
		}
	}
};

/**
 * Decode a blob into something `drawImage` accepts. Prefers
 * `createImageBitmap` (off-main-thread decode, no DOM node), falling
 * back to an `<img>` + object URL on engines that lack it. Returns
 * `null` if neither path can decode the bytes.
 */
const loadBitmap = async (file: Blob): Promise<ImageBitmap | HTMLImageElement | null> => {
	if (typeof createImageBitmap === 'function') {
		try {
			return await createImageBitmap(file);
		} catch {
			// Fall through to the <img> path below.
		}
	}

	if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
		return null;
	}

	const url = URL.createObjectURL(file);

	try {
		return await new Promise<HTMLImageElement | null>((resolve) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => resolve(null);
			img.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
};
