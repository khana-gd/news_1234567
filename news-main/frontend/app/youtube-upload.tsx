/**
 * YouTubeUploadScreen — No Login Required
 *
 * All reporter uploads go directly to the central Public Samachar YouTube channel.
 * The access token is obtained server-side (backend/.env holds the refresh token).
 * No user login or Google Sign-In is ever shown.
 *
 * Flow:
 *   1. Screen mounts → POST /api/youtube-token → get fresh access token silently
 *   2. Reporter fills in Title / Description / Location
 *   3. Tap "Upload to YouTube" → resumable upload to YouTube Data API v3
 *   4. videoId saved to MongoDB
 *   5. Local files deleted from device
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { uploadToYouTube } from '../utils/youtube';

type Status = 'init' | 'ready' | 'uploading' | 'done' | 'error';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function YouTubeUploadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { uri, rawUri, title: pTitle, location: pLoc, description: pDesc } =
    useLocalSearchParams<{
      uri: string;
      rawUri?: string;
      title?: string;
      location?: string;
      description?: string;
    }>();

  // ── State ──────────────────────────────────────────────────────────────────
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [title, setTitle]             = useState(pTitle || 'Public Samachar Report');
  const [location, setLoc]            = useState(pLoc  || '');
  const [description, setDesc]        = useState(pDesc || '');
  const [status, setStatus]           = useState<Status>('init');
  const [progress, setProgress]       = useState(0);
  const [progMsg, setProgMsg]         = useState('');
  const [errorMsg, setError]          = useState<string | null>(null);
  const [youtubeUrl, setYTUrl]        = useState<string | null>(null);

  // ── Silently obtain access token from backend on mount ─────────────────────
  useEffect(() => {
    let mounted = true;
    const fetchToken = async () => {
      try {
        const resp = await fetch(`${BACKEND}/api/youtube-token`, { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.detail || `HTTP ${resp.status}`);
        if (!data.access_token) throw new Error('No access_token in response');
        if (mounted) {
          setAccessToken(data.access_token);
          setStatus('ready');
        }
      } catch (e: any) {
        if (mounted) {
          setError(
            `Could not connect to YouTube upload channel.\n\n` +
            `Details: ${e?.message || String(e)}\n\n` +
            `Make sure YT_CLIENT_SECRET and YT_REFRESH_TOKEN are set in backend/.env`
          );
          setStatus('error');
        }
      }
    };
    fetchToken();
    return () => { mounted = false; };
  }, []);

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!accessToken) { Alert.alert('Channel not ready', 'Please wait…'); return; }
    if (!uri)          { Alert.alert('No video', 'No video file found.'); return; }
    if (!title.trim()) { Alert.alert('Title required', 'Enter a headline.'); return; }

    setStatus('uploading');
    setProgress(0);
    setProgMsg('Connecting to YouTube...');
    setError(null);

    try {
      const videoTitle = `${title.trim()} | Public Samachar${location ? ` | ${location}` : ''}`;

      const result = await uploadToYouTube({
        accessToken,
        videoUri: uri,
        title:    videoTitle,
        description: [
          description.trim() || title.trim(),
          location ? `Location: ${location}` : '',
          '',
          'Brought to you by Public Samachar — Kannada News',
          'https://mypublicsamachar.com',
        ].filter(Boolean).join('\n'),
        tags: ['Public Samachar', 'Kannada News', 'Karnataka', location].filter(Boolean) as string[],
        onProgress: (pct) => {
          setProgress(pct);
          if      (pct < 20) setProgMsg('Connecting to YouTube...');
          else if (pct < 55) setProgMsg('Uploading video...');
          else if (pct < 88) setProgMsg('Almost there...');
          else               setProgMsg('Processing on YouTube...');
        },
      });

      setProgress(100);
      setProgMsg('Saving to database...');

      // ── Persist videoId to MongoDB ────────────────────────────────────────
      try {
        await fetch(`${BACKEND}/api/save-video-upload`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ videoId: result.videoId, title: videoTitle, location }),
        });
      } catch {/* non-critical */}

      // ── Delete ALL local video files to protect storage ───────────────────
      try {
        if (uri)                       await FileSystem.deleteAsync(uri, { idempotent: true });
        if (rawUri && rawUri !== uri)  await FileSystem.deleteAsync(rawUri, { idempotent: true });
      } catch (e) { console.warn('[YouTube] cleanup:', e); }

      setYTUrl(result.videoUrl);
      setStatus('done');
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
      setStatus('error');
    }
  }, [accessToken, uri, rawUri, title, location, description]);

  const retryToken = useCallback(() => {
    setStatus('init');
    setError(null);
    const fetchToken = async () => {
      try {
        const resp = await fetch(`${BACKEND}/api/youtube-token`, { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.detail || `HTTP ${resp.status}`);
        setAccessToken(data.access_token);
        setStatus('ready');
      } catch (e: any) {
        setError(e?.message || 'Retry failed');
        setStatus('error');
      }
    };
    fetchToken();
  }, []);

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <LinearGradient colors={['#1a0000', '#0d0000', '#080808']} style={StyleSheet.absoluteFill} />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.hdrCenter}>
            <Ionicons name="logo-youtube" size={22} color="#FF0000" />
            <Text style={styles.hdrTitle}>Upload Video</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        >

          {/* ── Channel Status Banner ───────────────────────────────────── */}
          {status === 'init' && (
            <View style={styles.bannerInit}>
              <ActivityIndicator color="#FF0000" size="small" />
              <Text style={styles.bannerTxt}>Connecting to Public Samachar channel...</Text>
            </View>
          )}

          {status === 'ready' && (
            <View style={styles.bannerReady}>
              <MaterialIcons name="check-circle" size={18} color="#4CAF50" />
              <Text style={[styles.bannerTxt, { color: '#4CAF50' }]}>
                Connected to Public Samachar YouTube channel
              </Text>
            </View>
          )}

          {/* ── Video Details Form ──────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Video Details</Text>

            <Text style={styles.fieldLbl}>HEADLINE *</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Enter news headline..."
              placeholderTextColor="rgba(255,255,255,0.28)"
              maxLength={100}
              returnKeyType="next"
            />

            <Text style={styles.fieldLbl}>DESCRIPTION (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDesc}
              placeholder="Describe the news story, context, details..."
              placeholderTextColor="rgba(255,255,255,0.28)"
              maxLength={500}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.fieldLbl}>LOCATION (optional)</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLoc}
              placeholder="City or area..."
              placeholderTextColor="rgba(255,255,255,0.28)"
              maxLength={60}
              returnKeyType="done"
            />

            <Text style={styles.previewLbl}>
              {`YouTube title: "${title} | Public Samachar${location ? ` | ${location}` : ''}"`}
            </Text>
          </View>

          {/* ── Upload Button ───────────────────────────────────────────── */}
          {(status === 'ready' || status === 'error') && (
            <TouchableOpacity
              style={[styles.uploadBtn, status !== 'ready' && { opacity: 0.38 }]}
              onPress={handleUpload}
              disabled={status !== 'ready'}
              activeOpacity={0.85}
            >
              <Ionicons name="cloud-upload" size={22} color="#fff" />
              <Text style={styles.uploadBtnTxt}>Upload</Text>
            </TouchableOpacity>
          )}

          {/* ── Uploading Progress ──────────────────────────────────────── */}
          {status === 'uploading' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Uploading to YouTube...</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${progress}%` as any }]} />
              </View>
              <View style={styles.progRow}>
                <Text style={styles.progPct}>{progress}%</Text>
                <Text style={styles.progMsg}>{progMsg}</Text>
              </View>
              <ActivityIndicator color="#FF0000" style={{ marginTop: 8 }} />
            </View>
          )}

          {/* ── Error ──────────────────────────────────────────────────── */}
          {status === 'error' && errorMsg ? (
            <View style={[styles.card, { borderColor: '#F44336' }]}>
              <Text style={[styles.cardTitle, { color: '#F44336' }]}>Error</Text>
              <Text style={styles.errTxt}>{errorMsg}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={retryToken} activeOpacity={0.8}>
                <MaterialIcons name="refresh" size={18} color="#fff" />
                <Text style={styles.retryTxt}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── Done ───────────────────────────────────────────────────── */}
          {status === 'done' && youtubeUrl ? (
            <View style={[styles.card, { borderColor: 'rgba(76,175,80,0.4)' }]}>
              <MaterialIcons name="check-circle" size={52} color="#4CAF50" style={{ alignSelf: 'center', marginBottom: 12 }} />
              <Text style={[styles.cardTitle, { textAlign: 'center' }]}>Uploaded Successfully!</Text>
              <Text style={styles.cardSub}>
                Video is processing on YouTube. All local files have been deleted.
              </Text>
              <TouchableOpacity
                style={styles.openYTBtn}
                onPress={() => Linking.openURL(youtubeUrl)}
                activeOpacity={0.85}
              >
                <Ionicons name="logo-youtube" size={20} color="#fff" />
                <Text style={styles.openYTTxt}>Open on YouTube</Text>
              </TouchableOpacity>
            </View>
          ) : null}

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  hdr:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  backBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  hdrCenter:     { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hdrTitle:      { fontSize: 17, fontWeight: '800', color: '#fff' },
  scroll:        { padding: 16, gap: 14 },

  bannerInit:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  bannerReady:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(76,175,80,0.08)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(76,175,80,0.25)' },
  bannerTxt:     { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },

  card:          { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', gap: 4 },
  cardTitle:     { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 6 },
  cardSub:       { fontSize: 13, color: 'rgba(255,255,255,0.52)', lineHeight: 19 },

  fieldLbl:      { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  input:         { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', marginBottom: 4 },
  inputMultiline:{ minHeight: 90, paddingTop: 12 },
  previewLbl:    { fontSize: 11, color: 'rgba(255,255,255,0.38)', lineHeight: 16, fontStyle: 'italic', marginTop: 8 },

  uploadBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FF0000', borderRadius: 30, paddingVertical: 16, elevation: 3 },
  uploadBtnTxt:  { color: '#fff', fontWeight: '800', fontSize: 16 },

  barTrack:      { height: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 5, overflow: 'hidden', marginBottom: 10, marginTop: 8 },
  barFill:       { height: '100%', backgroundColor: '#FF0000', borderRadius: 5 },
  progRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progPct:       { fontSize: 20, fontWeight: '900', color: '#FF0000' },
  progMsg:       { fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 },

  errTxt:        { fontSize: 12, color: '#FF8A80', lineHeight: 18 },
  retryBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 12, marginTop: 10, alignSelf: 'flex-start' },
  retryTxt:      { color: '#fff', fontWeight: '700', fontSize: 14 },

  openYTBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FF0000', borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  openYTTxt:     { color: '#fff', fontWeight: '700', fontSize: 14 },
});
