import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// Dynamically load react-native-compressor if available
let VideoCompressor: any = null;
try {
  VideoCompressor = require('react-native-compressor').Video;
} catch {}

export type QualityMode = 'rural' | 'hd';

export interface OptimizationResult {
  uri: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number; // e.g. 0.85 = 85% smaller
  didCompress: boolean;
}

/**
 * Optimizes a video file for uploading, especially over weak rural networks (2G/3G/4G)
 * such as Dharwad, Hubli taluks, and highway dead-zones.
 *
 * Mode 'rural' (default):
 *   - Compresses to 540p/720p @ ~850 kbps
 *   - Reduces a 1-minute 120MB phone recording to ~5-7 MB!
 *   - Ensures news audio and titles stay crisp while taking 90% less upload time.
 *
 * Mode 'hd':
 *   - 720p @ ~1.8 Mbps (~14MB/min) for fast Wi-Fi / 5G.
 */
export async function optimizeVideoForUpload(
  sourceUri: string,
  mode: QualityMode = 'rural',
  onProgress?: (progress: number, statusText: string) => void,
): Promise<OptimizationResult> {
  let fileUri = sourceUri;

  // Handle Android content:// URIs by copying to cache first
  if (Platform.OS === 'android' && fileUri.startsWith('content://')) {
    onProgress?.(2, 'Preparing video file...');
    const dest = `${FileSystem.cacheDirectory}prep_${Date.now()}.mp4`;
    await FileSystem.copyAsync({ from: fileUri, to: dest });
    fileUri = dest;
  }

  // Get original file info
  let originalSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    originalSize = (info as any)?.size ?? 0;
  } catch {}

  const originalMB = (originalSize / (1024 * 1024)).toFixed(1);

  // If file is already tiny (< 4.5 MB), skip re-compression to save battery & time
  if (originalSize > 0 && originalSize < 4.5 * 1024 * 1024) {
    onProgress?.(100, `Video size is already small (${originalMB} MB) ✓`);
    return {
      uri: fileUri,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 0,
      didCompress: false,
    };
  }

  // If VideoCompressor is not available (e.g. web or unsupported runtime), return original
  if (Platform.OS === 'web' || !VideoCompressor) {
    onProgress?.(100, 'Ready for upload');
    return {
      uri: fileUri,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 0,
      didCompress: false,
    };
  }

  const isRural = mode === 'rural';
  const targetBitrate = isRural ? 850_000 : 1_800_000;
  const targetMaxSize = isRural ? 960 : 1280;

  onProgress?.(5, isRural
    ? `Optimizing ${originalMB} MB video for Rural/Weak Network...`
    : `Compressing ${originalMB} MB video (HD)...`
  );

  try {
    const compressedUri = await VideoCompressor.compress(
      fileUri,
      {
        compressionMethod: 'auto',
        maxSize: targetMaxSize,
        bitrate: targetBitrate,
      },
      (p: number) => {
        const pct = Math.round(p * 100);
        onProgress?.(
          5 + Math.round(p * 90),
          isRural
            ? `Rural Network Saver: Compressing ${pct}%...`
            : `Compressing video: ${pct}%...`
        );
      }
    );

    let compressedSize = 0;
    try {
      const cInfo = await FileSystem.getInfoAsync(compressedUri);
      compressedSize = (cInfo as any)?.size ?? 0;
    } catch {}

    const compressedMB = (compressedSize / (1024 * 1024)).toFixed(1);
    const savedPct = originalSize > 0 && compressedSize < originalSize
      ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
      : 0;

    const ratio = originalSize > 0 && compressedSize < originalSize
      ? (originalSize - compressedSize) / originalSize
      : 0;

    onProgress?.(
      100,
      savedPct > 0
        ? `Optimized: ${originalMB} MB → ${compressedMB} MB (${savedPct}% smaller!) ✓`
        : `Ready: ${compressedMB} MB ✓`
    );

    return {
      uri: compressedUri,
      originalSize,
      compressedSize: compressedSize || originalSize,
      compressionRatio: ratio,
      didCompress: true,
    };
  } catch (err) {
    // If compression fails, fall back to the original file gracefully
    onProgress?.(100, 'Proceeding with original video file...');
    return {
      uri: fileUri,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 0,
      didCompress: false,
    };
  }
}
