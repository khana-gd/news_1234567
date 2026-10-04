import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  Share,
  Linking,
  BackHandler,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { BRAND } from '../constants/theme';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { optimizeVideoForUpload, QualityMode } from '../utils/videoOptimizer';
import { uploadVideoResiliently } from '../utils/resilientUpload';
import { enqueueUpload } from '../utils/uploadQueue';

// ── Video Thumbnails (non-critical) ──────────────────────────────────────────
let VideoThumbnails: any = null;
try { VideoThumbnails = require('expo-video-thumbnails'); } catch {}

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// ── Resilient fetch with auto-retry ──────────────────────────────────────────
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 4,
  onRetry?: (attempt: number, total: number) => void,
): Promise<Response> {
  const delays = [0, 2000, 4000, 7000];
  for (let i = 0; i < retries; i++) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, delays[i]));
      onRetry?.(i + 1, retries);
    }
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (i < retries - 1 && [404, 502, 503, 504].includes(res.status)) {
        onRetry?.(i + 1, retries);
        continue;
      }
      return res;
    } catch (err) {
      if (i < retries - 1) continue;
      throw err;
    }
  }
  throw new Error('Server unavailable after multiple attempts. Please try again in a moment.');
}

type CfStatus = 'idle' | 'uploading' | 'done' | 'error' | 'queued_saved';

const { height: SCREEN_H } = Dimensions.get('window');
const PREVIEW_H = Math.round(SCREEN_H * 0.38);

export default function VideoEditorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    uri,
    title:       paramTitle,
    location:    paramLocation,
    description: paramDescription,
    aspectRatio: paramAspectRatio,
  } = useLocalSearchParams<{
    uri: string; title?: string; location?: string; description?: string; aspectRatio?: string;
  }>();

  // ── Cloudflare R2 upload state ────────────────────────────────────────────
  const [cfStatus, setCfStatus]         = useState<CfStatus>('idle');
  const [cfProgress, setCfProgress]     = useState(0);
  const [cfMsg, setCfMsg]               = useState('');
  const [cfError, setCfError]           = useState<string | null>(null);
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null);
  const [qualityMode, setQualityMode]   = useState<QualityMode>('rural');
  const [optStats, setOptStats]         = useState<{ origMB: string; compMB: string; savedPct: number } | null>(null);

  const player = useVideoPlayer(
    (Platform.OS === 'web' ? '' : (uri ?? '')),
    (p) => { p.loop = false; p.muted = false; }
  );

  // ── Block hardware back during upload ────────────────────────────────────
  useEffect(() => {
    if (cfStatus !== 'uploading') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Upload in Progress',
        'Please wait for the upload to complete before leaving.',
        [{ text: 'OK', style: 'cancel' }],
      );
      return true;
    });
    return () => sub.remove();
  }, [cfStatus]);

  // ── Upload to Cloudflare R2 — Direct Architecture ──────────────────────
  //  1. JWT auth check
  //  2. GET /api/generate-upload-url  → presigned PUT URL + video_id
  //  3. XHR PUT (real onprogress %)   → video goes directly to R2
  //  4. Optional thumbnail generation
  //  5. POST /api/cf/save-video-meta  → backend saves D1 metadata
  //
  const handleUploadToCloudflare = useCallback(async () => {
    if (!uri) {
      Alert.alert('Error', 'No video found. Please go back and pick a video.');
      return;
    }
    if (!paramTitle?.trim()) {
      Alert.alert('Title required', 'Please go back and enter a headline.');
      return;
    }

    // ── JWT auth check ──────────────────────────────────────────────────────
    const jwtToken = await AsyncStorage.getItem('reporter_jwt_token').catch(() => null);
    if (!jwtToken) {
      Alert.alert(
        'Login Required',
        'Please login as a reporter before uploading videos.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Login', onPress: () => router.push('/reporter-login' as any) },
        ],
      );
      return;
    }
    try {
      const base64Payload = jwtToken.split('.')[1] || '';
      const padded = base64Payload + '='.repeat((4 - base64Payload.length % 4) % 4);
      const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        await AsyncStorage.multiRemove(['reporter_jwt_token', 'reporter_unlocked_v1']);
        router.replace({ pathname: '/reporter-login', params: { expired: 'true' } } as any);
        return;
      }
    } catch { /* If decode fails, let backend validate */ }

    const authHeaders: Record<string, string> = { Authorization: `Bearer ${jwtToken}` };

    setCfStatus('uploading');
    setCfProgress(5);
    setCfMsg('Preparing resilient upload...');
    setCfError(null);
    setOptStats(null);

    let finalUploadUri = uri;

    try {
      // ── Step 1: Optimize Video for Rural / Weak Network ───────────────────
      setCfProgress(8);
      setCfMsg(qualityMode === 'rural'
        ? '⚡ Rural Network Saver: Optimizing video...'
        : 'Compressing video...'
      );

      const optResult = await optimizeVideoForUpload(
        uri,
        qualityMode,
        (progressPct, statusTxt) => {
          setCfProgress(Math.min(22, 8 + Math.round(progressPct * 0.14)));
          setCfMsg(statusTxt);
        }
      );

      finalUploadUri = optResult.uri;

      if (optResult.didCompress && optResult.originalSize > 0) {
        const origMB = (optResult.originalSize / (1024 * 1024)).toFixed(1);
        const compMB = (optResult.compressedSize / (1024 * 1024)).toFixed(1);
        const savedPct = Math.round(optResult.compressionRatio * 100);
        setOptStats({ origMB, compMB, savedPct });
      }

      // Get reporter name
      const savedReporterName = await AsyncStorage.getItem('reporter_name').catch(() => null);
      const reporterName = savedReporterName || 'Public Samachar Reporter';

      // ── Step 2: Native Stream Off-Heap Resilient Upload ───────────────────
      setCfProgress(24);
      setCfMsg('Connecting to Cloudflare storage...');

      const { videoId, videoKey } = await uploadVideoResiliently(
        finalUploadUri,
        authHeaders,
        (u) => {
          // Map 0-100% of resilient upload to 24% - 86% of overall flow
          const mappedPct = Math.min(86, 24 + Math.round((u.percent / 100) * 62));
          setCfProgress(mappedPct);
          setCfMsg(u.statusText);
        },
        5 // Up to 5 auto-retries with exponential backoff on network drop
      );

      // ── Step 3: Thumbnail (non-critical) ─────────────────────────────────
      setCfProgress(88);
      setCfMsg('Generating thumbnail...');
      let thumbKey = '';
      try {
        if (Platform.OS !== 'web' && VideoThumbnails) {
          const { uri: rawThumbUri } = await VideoThumbnails.getThumbnailAsync(finalUploadUri, {
            time: 1000,
            quality: 0.8,
          });

          let thumbUri = rawThumbUri;
          try {
            const ImageManipulator = require('expo-image-manipulator');
            const manipResult = await ImageManipulator.manipulateAsync(
              rawThumbUri,
              [{ resize: { width: 720 } }],
              { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
            );
            thumbUri = manipResult.uri;
          } catch { /* compression non-critical */ }

          const thumbUrlRes = await fetchWithRetry(
            `${BACKEND}/api/generate-thumb-url`,
            { headers: authHeaders },
            2,
          );
          if (thumbUrlRes.ok) {
            const { upload_url: thumbPresigned, key: tk } = await thumbUrlRes.json();
            if (thumbPresigned && tk) {
              const thumbBlob = await fetch(thumbUri).then(r => r.blob());
              const thumbOk = await new Promise<boolean>(res => {
                const txhr = new XMLHttpRequest();
                txhr.open('PUT', thumbPresigned, true);
                txhr.setRequestHeader('Content-Type', 'image/jpeg');
                txhr.timeout = 25000;
                txhr.onload  = () => res(txhr.status >= 200 && txhr.status < 300);
                txhr.onerror = () => res(false);
                txhr.send(thumbBlob);
              });
              if (thumbOk) thumbKey = tk;
            }
          }
          try { await (FileSystem as any).deleteAsync(rawThumbUri, { idempotent: true }); } catch {}
          if (thumbUri !== rawThumbUri) {
            try { await (FileSystem as any).deleteAsync(thumbUri, { idempotent: true }); } catch {}
          }
        }
      } catch { /* thumbnail is non-critical */ }

      // ── Step 4: Save metadata to D1 ───────────────────────────────────────
      setCfProgress(92);
      setCfMsg('Publishing to Public Samachar feed...');

      const metaRes = await fetchWithRetry(`${BACKEND}/api/cf/save-video-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          video_id:      videoId,
          video_key:     videoKey,
          title:         paramTitle.trim(),
          description:   paramDescription?.trim() || '',
          location:      paramLocation?.trim() || '',
          reporter_name: reporterName,
          reporter_id:   `reporter_${Date.now()}`,
          thumb_key:     thumbKey,
          aspect_ratio:  paramAspectRatio || '16:9',
        }),
      }, 3);

      if (metaRes.status === 401) {
        await AsyncStorage.multiRemove(['reporter_jwt_token', 'reporter_unlocked_v1']);
        setCfStatus('idle');
        router.replace({ pathname: '/reporter-login', params: { expired: 'true' } } as any);
        return;
      }
      if (!metaRes.ok) {
        const txt = await metaRes.text().catch(() => '');
        throw new Error(`Metadata save failed (${metaRes.status}): ${txt.slice(0, 150)}`);
      }

      setUploadedVideoId(videoId);

      // Clean up temp optimized file if different from original
      try {
        if (finalUploadUri !== uri) await (FileSystem as any).deleteAsync(finalUploadUri, { idempotent: true });
      } catch {}

      setCfProgress(100);
      setCfMsg('Live on Public Samachar! 🚀');
      setCfStatus('done');

    } catch (e: any) {
      if (e?.message === 'AUTH_EXPIRED') {
        await AsyncStorage.multiRemove(['reporter_jwt_token', 'reporter_unlocked_v1']);
        setCfStatus('idle');
        router.replace({ pathname: '/reporter-login', params: { expired: 'true' } } as any);
        return;
      }

      const raw = e?.message || 'Upload failed. Check your connection and try again.';
      let friendlyMsg = raw;
      if (
        raw.toLowerCase().includes('network') ||
        raw.toLowerCase().includes('connection') ||
        raw.toLowerCase().includes('timed out') ||
        raw.toLowerCase().includes('storage error')
      ) {
        friendlyMsg = '📶 Weak network detected (Dharwad/Hubli area). Video couldn\'t complete. You can Retry or Save Offline to auto-upload once internet is detected.';
      }
      setCfError(friendlyMsg);
      setCfStatus('error');
    }
  }, [uri, paramTitle, paramDescription, paramLocation, paramAspectRatio, qualityMode, router]);

  // ── Save to Offline Queue for Auto-Sync ────────────────────────────────────
  const handleSaveOffline = useCallback(async () => {
    if (!uri || !paramTitle?.trim()) return;
    try {
      setCfMsg('Saving video to offline queue...');
      const savedReporterName = await AsyncStorage.getItem('reporter_name').catch(() => null);
      const reporterName = savedReporterName || 'Public Samachar Reporter';

      await enqueueUpload({
        videoUri: uri,
        title: paramTitle.trim(),
        description: paramDescription?.trim() || '',
        location: paramLocation?.trim() || '',
        reporterName,
        reporterId: `reporter_${Date.now()}`,
        aspectRatio: paramAspectRatio || '16:9',
        qualityMode,
      });

      setCfStatus('queued_saved');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not save to offline queue');
    }
  }, [uri, paramTitle, paramDescription, paramLocation, paramAspectRatio, qualityMode]);

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.hdr}>
        <TouchableOpacity
          onPress={() => {
            if (cfStatus === 'uploading') {
              Alert.alert('Upload in Progress', 'Please wait for the upload to complete before leaving.');
              return;
            }
            router.back();
          }}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.hdrTitle}>Upload Video</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Video Preview ── */}
        <View style={[styles.previewWrap, { height: PREVIEW_H }]}>
          {uri ? (
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              nativeControls
            />
          ) : (
            <View style={styles.noVideo}>
              <MaterialIcons name="videocam-off" size={48} color="rgba(255,255,255,0.28)" />
              <Text style={styles.noVideoTxt}>No video selected</Text>
            </View>
          )}

          {/* Public Samachar logo badge overlay */}
          <View pointerEvents="none" style={styles.videoBadge}>
            <Image
              source={require('../assets/images/video-badge.png')}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          </View>
        </View>

        <View style={styles.body}>

          {/* Video headline chip */}
          {paramTitle ? (
            <View style={styles.titleChip}>
              <MaterialIcons name="title" size={15} color="#2196F3" />
              <Text style={styles.titleChipTxt} numberOfLines={2}>{paramTitle}</Text>
            </View>
          ) : null}

          {/* Location chip */}
          {paramLocation ? (
            <View style={styles.locationChip}>
              <MaterialIcons name="location-on" size={15} color="#FF7043" />
              <Text style={styles.locationChipTxt} numberOfLines={1}>{paramLocation}</Text>
            </View>
          ) : null}

          {/* ── Network Optimization Selector ── */}
          {cfStatus === 'idle' && (
            <View style={styles.modeCard}>
              <View style={styles.modeHdrRow}>
                <MaterialIcons name="network-check" size={18} color="#1AAA94" />
                <Text style={styles.modeCardTitle}>ನೆಟ್‌ವರ್ಕ್ ಆಪ್ಟಿಮೈಜರ್ / Network Optimizer</Text>
              </View>

              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeChip, qualityMode === 'rural' && styles.modeChipActive]}
                  onPress={() => setQualityMode('rural')}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="bolt" size={16} color={qualityMode === 'rural' ? '#fff' : '#1AAA94'} />
                  <Text style={[styles.modeChipTxt, qualityMode === 'rural' && styles.modeChipTxtActive]}>
                    ⚡ Rural Fast (ಗ್ರಾಮೀಣ ವೇಗ)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modeChip, qualityMode === 'hd' && styles.modeChipActive]}
                  onPress={() => setQualityMode('hd')}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="hd" size={16} color={qualityMode === 'hd' ? '#fff' : '#1AAA94'} />
                  <Text style={[styles.modeChipTxt, qualityMode === 'hd' && styles.modeChipTxtActive]}>
                    Standard HD
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modeDesc}>
                {qualityMode === 'rural'
                  ? '⚡ ಧಾರವಾಡ, ಹುಬ್ಬಳ್ಳಿ ಹಾಗೂ ಗ್ರಾಮೀಣ ಭಾಗಗಳಿಗೆ ಶಿಫಾರಸು: ವಿಡಿಯೋ ಗಾತ್ರವನ್ನು 90% ಕಡಿಮೆ ಮಾಡುತ್ತದೆ (~5-7 MB), 2G/3G ನೆಟ್‌ವರ್ಕ್‌ನಲ್ಲೂ ವೇಗವಾಗಿ ಅಪ್ಲೋಡ್ ಆಗುತ್ತದೆ.'
                  : '🎬 Standard HD: ಪೂರ್ಣ ರೆಸಲ್ಯೂಶನ್ ಅಪ್ಲೋಡ್. ಉತ್ತಮ ವೈ-ಫೈ (Wi-Fi) ಅಥವಾ 5G ಇದ್ದಾಗ ಮಾತ್ರ ಬಳಸಿ.'}
              </Text>
            </View>
          )}

          {/* ── Upload Progress ── */}
          {cfStatus === 'uploading' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>☁️ Uploading to Video Feed...</Text>

              {optStats && (
                <View style={styles.optBadge}>
                  <MaterialIcons name="check-circle" size={14} color="#4CAF50" />
                  <Text style={styles.optBadgeTxt}>
                    ⚡ Optimized: {optStats.origMB} MB → {optStats.compMB} MB ({optStats.savedPct}% smaller!)
                  </Text>
                </View>
              )}

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${cfProgress}%` as any }]} />
              </View>
              <View style={styles.progressMeta}>
                <Text style={styles.progressPct}>{cfProgress}%</Text>
                <Text style={styles.progressMsg}>{cfMsg}</Text>
              </View>
              <Text style={styles.keepAwakeTip}>
                💡 ಸುಳಿವು: ಅಪ್ಲೋಡ್ ಆಗುವವರೆಗೆ ಆ್ಯಪ್ ತೆರೆದಿಡಿ (Keep app open)
              </Text>
              <ActivityIndicator size="small" color="#1AAA94" style={{ marginTop: 8 }} />
            </View>
          )}

          {/* ── Upload Error with Offline Queue Option ── */}
          {cfStatus === 'error' && cfError && (
            <View style={[styles.card, styles.cardError]}>
              <Text style={[styles.cardTitle, { color: '#F44336' }]}>☁️ Upload Interrupted</Text>
              <Text style={styles.errTxt}>{cfError}</Text>

              <View style={styles.errBtnRow}>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={handleUploadToCloudflare}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="refresh" size={16} color="#fff" />
                  <Text style={styles.retryTxt}>ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ / Try Again</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.saveOfflineBtn}
                  onPress={handleSaveOffline}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="cloud-queue" size={16} color="#1AAA94" />
                  <Text style={styles.saveOfflineTxt}>ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಉಳಿಸಿ (Save Offline)</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.offlineHint}>
                💡 ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಉಳಿಸಿದರೆ, ನೀವು ನೆಟ್‌ವರ್ಕ್ ಸಿಗುವ ಜಾಗಕ್ಕೆ (ಧಾರವಾಡ/ಹುಬ್ಬಳ್ಳಿ ನಗರ) ಹೋದಾಗ ಅಥವಾ ವೈಫೈ ಸಿಕ್ಕಾಗ ವಿಡಿಯೋ ತಂತಾನೇ ಅಪ್ಲೋಡ್ ಆಗುತ್ತದೆ.
              </Text>
            </View>
          )}

          {/* ── SAVED IN OFFLINE QUEUE ── */}
          {cfStatus === 'queued_saved' && (
            <View style={styles.queuedCard}>
              <MaterialIcons name="cloud-done" size={64} color="#1AAA94" />
              <Text style={styles.queuedTitle}>ಆಫ್‌ಲೈನ್ ಕ್ಯೂನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ! 💾</Text>
              <Text style={styles.queuedSub}>
                ನಿಮ್ಮ ಸುದ್ದಿ ವರದಿ ಮತ್ತು ವಿಡಿಯೋ ಫೋನ್‌ನಲ್ಲಿ ಸುರಕ್ಷಿತವಾಗಿದೆ.{'\n\n'}
                ನೀವು ಧಾರವಾಡ, ಹುಬ್ಬಳ್ಳಿ ನಗರಕ್ಕೆ ಹೋದಾಗ ಅಥವಾ ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಸಿಕ್ಕಿದಾಗ ಇದು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಪ್ಲೋಡ್ ಆಗಿ ಪಬ್ಲಿಕ್ ಸಮಾಚಾರ ಫೀಡ್‌ನಲ್ಲಿ ಪ್ರಕಟವಾಗುತ್ತದೆ.
              </Text>

              <TouchableOpacity
                style={[styles.doneBtn, { backgroundColor: '#1AAA94', marginTop: 12 }]}
                onPress={() => router.replace('/(tabs)/video' as any)}
                activeOpacity={0.85}
              >
                <Text style={styles.doneTxt}>ಫೀಡ್‌ಗೆ ಹಿಂತಿರುಗಿ (Done) →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Upload Button (idle or error) ── */}
          {(cfStatus === 'idle' || cfStatus === 'error') && (
            <TouchableOpacity
              style={[styles.uploadBtn, !uri && { opacity: 0.4 }]}
              onPress={handleUploadToCloudflare}
              disabled={!uri}
              activeOpacity={0.85}
            >
              <MaterialIcons name="cloud-upload" size={22} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadBtnTitle}>Upload to Video Feed</Text>
                <Text style={styles.uploadBtnSub}>Saves to cloud · Appears in Public Samachar Feed</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#fff" />
            </TouchableOpacity>
          )}

          {/* ── SUCCESS ── */}
          {cfStatus === 'done' && (
            <View style={styles.successCard}>
              <MaterialIcons name="check-circle" size={64} color="#1AAA94" />
              <Text style={styles.successTitle}>Published! 🎉</Text>
              <Text style={styles.successSub}>
                Your video is live on Public Samachar!{'\n'}
                Share it with your audience below.
              </Text>

              {uploadedVideoId && (
                <View style={styles.shareUrlRow}>
                  <MaterialIcons name="link" size={16} color="#1AAA94" />
                  <Text style={styles.shareUrlTxt} numberOfLines={1}>
                    {`${BACKEND}/api/cf/share/${uploadedVideoId}`}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.copyBtn}
                onPress={async () => {
                  const url = uploadedVideoId
                    ? `${BACKEND}/api/cf/share/${uploadedVideoId}`
                    : 'https://mypublicsamachar.com';
                  try {
                    await Share.share({
                      message: `${paramTitle || 'Watch on Public Samachar'}\n${url}`,
                      url,
                      title: 'Share Post Link',
                    });
                  } catch {}
                }}
                activeOpacity={0.85}
              >
                <MaterialIcons name="content-copy" size={18} color="#1AAA94" />
                <Text style={styles.copyBtnTxt}>Copy Share Link</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.waBtn}
                onPress={() => {
                  const url = uploadedVideoId
                    ? `${BACKEND}/api/cf/share/${uploadedVideoId}`
                    : 'https://mypublicsamachar.com';
                  const loc = paramLocation ? `\n📍 ${paramLocation}` : '';
                  const msg = `📺 *${paramTitle || 'Public Samachar Report'}*${loc}\n\nWatch on Public Samachar:\n${url}`;
                  Linking.openURL(`whatsapp://send?text=${encodeURIComponent(msg)}`).catch(() =>
                    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`)
                  );
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="logo-whatsapp" size={20} color="#fff" />
                <Text style={styles.waBtnTxt}>Share to WhatsApp</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.doneBtn, { backgroundColor: '#1AAA94', marginTop: 4 }]}
                onPress={() => router.replace('/(tabs)/video' as any)}
                activeOpacity={0.85}
              >
                <Text style={styles.doneTxt}>View in Feed →</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <Text style={styles.appShareLabel}>📲 Share the app so people can watch this video:</Text>

              <TouchableOpacity
                style={[styles.copyBtn, { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(255,255,255,0.2)' }]}
                onPress={async () => {
                  const appLink = BACKEND ? `${BACKEND}/download` : 'https://public-samachar-api.onrender.com/download';
                  try {
                    await Share.share({
                      message: `📺 Watch news videos on Public Samachar!\n\nDownload the app:\n${appLink}`,
                      url: appLink,
                      title: 'Download Public Samachar App',
                    });
                  } catch {}
                }}
                activeOpacity={0.85}
              >
                <MaterialIcons name="file-download" size={18} color="#fff" />
                <Text style={[styles.copyBtnTxt, { color: '#fff' }]}>Share App Download Link</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.waBtn, { backgroundColor: '#075E54' }]}
                onPress={() => {
                  const appLink = BACKEND ? `${BACKEND}/download` : 'https://public-samachar-api.onrender.com/download';
                  const msg = `📺 *Public Samachar* — Watch local news videos!\n\nDownload the app:\n${appLink}`;
                  Linking.openURL(`whatsapp://send?text=${encodeURIComponent(msg)}`).catch(() =>
                    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`)
                  );
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="logo-whatsapp" size={20} color="#fff" />
                <Text style={styles.waBtnTxt}>Send App Link on WhatsApp</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#111' },
  hdr:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  backBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  hdrTitle:      { fontSize: 17, fontWeight: '800', color: '#fff' },
  scroll:        { paddingBottom: 60 },
  previewWrap:   { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  noVideo:       { alignItems: 'center', gap: 12 },
  noVideoTxt:    { color: 'rgba(255,255,255,0.38)', fontSize: 14 },
  videoBadge:    { position: 'absolute', top: 10, right: 12, width: 42, height: 42, borderRadius: 8, overflow: 'hidden' },
  body:          { padding: 16, gap: 14 },
  titleChip:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(33,150,243,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(33,150,243,0.25)' },
  titleChipTxt:  { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  locationChip:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,112,67,0.1)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,112,67,0.25)' },
  locationChipTxt:{ color: '#FF8A65', fontSize: 12, fontWeight: '600', flex: 1 },
  card:          { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', gap: 4 },
  cardError:     { borderColor: '#F44336' },
  cardTitle:     { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 10 },
  progressTrack: { height: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 5, overflow: 'hidden', marginBottom: 8 },
  progressFill:  { height: '100%', backgroundColor: '#1AAA94', borderRadius: 5 },
  progressMeta:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressPct:   { fontSize: 20, fontWeight: '900', color: '#1AAA94' },
  progressMsg:   { fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 },
  errTxt:        { fontSize: 12, color: '#FF8A80', lineHeight: 18 },
  retryBtn:      { alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(244,67,54,0.18)', marginTop: 8 },
  retryTxt:      { color: '#F44336', fontWeight: '700', fontSize: 13 },
  uploadBtn:     { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#1AAA94', borderRadius: 16, padding: 18, elevation: 4 },
  uploadBtnTitle:{ fontSize: 16, fontWeight: '800', color: '#fff' },
  uploadBtnSub:  { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  // Success
  successCard:   { backgroundColor: 'rgba(76,175,80,0.08)', borderRadius: 20, padding: 24, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)' },
  divider:       { width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 },
  appShareLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 18 },
  successTitle:  { fontSize: 22, fontWeight: '900', color: '#4CAF50' },
  successSub:    { fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 20 },
  doneBtn:       { backgroundColor: '#1AAA94', borderRadius: 30, paddingVertical: 13, paddingHorizontal: 40, marginTop: 8 },
  doneTxt:       { color: '#fff', fontWeight: '800', fontSize: 16 },
  shareUrlRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: BRAND.primarySoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, width: '100%' },
  shareUrlTxt:   { flex: 1, fontSize: 11, color: BRAND.primary, fontWeight: '600' },
  copyBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND.primarySoft, borderRadius: 24, paddingVertical: 12, paddingHorizontal: 28, width: '100%', borderWidth: 1, borderColor: BRAND.primaryLight },
  copyBtnTxt:    { color: BRAND.primary, fontWeight: '700', fontSize: 14 },
  waBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#25D366', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 28, width: '100%' },
  waBtnTxt:      { color: '#fff', fontWeight: '700', fontSize: 14 },
  // Network Mode Optimizer Styles
  modeCard:      { backgroundColor: 'rgba(26,170,148,0.08)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(26,170,148,0.25)', gap: 8 },
  modeHdrRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeCardTitle: { fontSize: 13, fontWeight: '800', color: '#1AAA94', textTransform: 'uppercase', letterSpacing: 0.5 },
  modeRow:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  modeChip:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  modeChipActive:{ backgroundColor: '#1AAA94', borderColor: '#1AAA94' },
  modeChipTxt:   { fontSize: 12, fontWeight: '700', color: '#fff' },
  modeChipTxtActive: { color: '#fff', fontWeight: '800' },
  modeDesc:      { fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 16, marginTop: 2 },
  // Optimization & Progress Badges
  optBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 8 },
  optBadgeTxt:   { fontSize: 11, fontWeight: '700', color: '#81C784' },
  keepAwakeTip:  { fontSize: 11, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 4 },
  // Error & Offline Queue Styles
  errBtnRow:     { flexDirection: 'column', gap: 8, marginTop: 10 },
  saveOfflineBtn:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(26,170,148,0.15)', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(26,170,148,0.3)' },
  saveOfflineTxt:{ color: '#1AAA94', fontWeight: '700', fontSize: 13 },
  offlineHint:   { fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 16, marginTop: 8 },
  // Queued Saved Card
  queuedCard:    { backgroundColor: 'rgba(26,170,148,0.1)', borderRadius: 20, padding: 24, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(26,170,148,0.35)' },
  queuedTitle:   { fontSize: 19, fontWeight: '900', color: '#1AAA94', textAlign: 'center' },
  queuedSub:     { fontSize: 13, color: 'rgba(255,255,255,0.78)', textAlign: 'center', lineHeight: 20 },
});
