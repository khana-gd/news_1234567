/**
 * Social News Feed — Public Samachar
 * Card-based scrollable FlatList using VideoNewsCard component
 * Layout: Header → FlatList of VideoNewsCard items
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useLanguage } from '../../context/LanguageContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import UploadVideoModal from '../../components/UploadVideoModal';
import VideoNewsCard, { VideoItem } from '../../components/VideoNewsCard';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const UNLOCK_KEY  = 'reporter_unlocked_v1';
const PS_GREEN    = '#1B5E20';

// ── Fetch Cloudflare / PS videos — 8 retries, up to 30s total ───────────────
async function fetchCFVideos(page = 1): Promise<VideoItem[]> {
  const MAX = 8;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(
        `${BACKEND_URL}/api/cf/videos?page=${page}&limit=20`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        const videos = (data.videos || []).map((v: any) => ({
          id:           `cf_${v.id}`,
          title:        v.title        || '',
          description:  v.description  || '',
          videoUrl:     v.video_url    || '',
          thumbUrl:     v.thumb_url    || '',
          reporterName: v.reporter_name || 'Reporter',
          timestamp:    v.timestamp    || 0,
          location:     v.location     || '',
          source:       'ps'            as const,
          cfId:         v.id,
          reach:        v.views         || 0,
          cautionFlag:  !!v.caution_flag,
          verified:     !!v.verified,
        }));
        if (videos.length > 0) return videos; // success
      }
    } catch { /* network error — retry */ }
    // Wait before retry: 1s, 2s, 3s … up to 5s
    const delay = Math.min(attempt * 1000, 5000);
    await new Promise(r => setTimeout(r, delay));
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// VideoScreen — Social Feed
// ═══════════════════════════════════════════════════════════════════════════════
export default function VideoScreen() {
  const { language }  = useLanguage();
  const insets        = useSafeAreaInsets();
  const isKn          = language === 'kn';

  const [videos,              setVideos]              = useState<VideoItem[]>([]);
  const [loading,             setLoading]             = useState(true);
  const [refreshing,          setRefreshing]          = useState(false);
  const [error,               setError]               = useState<string | null>(null);
  const [likedIds,            setLikedIds]            = useState<Set<string>>(new Set());
  const [showUpload,          setShowUpload]          = useState(false);
  const [isReporterUnlocked,  setIsReporterUnlocked]  = useState(false);

  // Notification deep-link: scroll to the video the user tapped on
  const { videoId } = useLocalSearchParams<{ videoId?: string }>();
  const listRef = useRef<FlatList<VideoItem>>(null);

  useEffect(() => {
    if (!videoId || videos.length === 0) return;
    const idx = videos.findIndex(v => v.cfId === videoId || v.id === `cf_${videoId}`);
    if (idx > 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
      }, 500);
    }
  }, [videoId, videos]);

  useEffect(() => {
    AsyncStorage.getItem(UNLOCK_KEY)
      .then(v => setIsReporterUnlocked(v === 'true'))
      .catch(() => {});
  }, []);

  const loadVideos = useCallback(async (isRefresh = false) => {
    if (!isRefresh) {
      // Show cached data instantly — no blank loading screen
      try {
        const cached = await AsyncStorage.getItem('cf_videos_cache_v2');
        if (cached) {
          const { videos: cv } = JSON.parse(cached);
          if (cv?.length > 0) { setVideos(cv); setLoading(false); }
        }
      } catch {}
    }

    if (!isRefresh) setLoading(prev => prev); // keep false if cache set it
    else            setRefreshing(true);
    setError(null);

    // Load ONLY Cloudflare D1/R2 videos — no YouTube, no WordPress mixed in
    const cfItems = await fetchCFVideos(1);

    if (cfItems.length > 0) {
      setVideos(cfItems);
      setLoading(false);
      // Save to cache for next app open
      AsyncStorage.setItem('cf_videos_cache_v2', JSON.stringify({ videos: cfItems, ts: Date.now() })).catch(() => {});
    } else {
      setLoading(false);
      setError(isKn ? 'ಇನ್ನೂ ವಿಡಿಯೋ ಲಭ್ಯವಿಲ್ಲ' : 'No videos yet. Be the first to upload!');
    }

    setRefreshing(false);
  }, [isKn]);

  useEffect(() => { loadVideos(); }, []);

  const handleLike = useCallback((id: string) => {
    setLikedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const renderItem = useCallback(({ item }: { item: VideoItem }) => (
    <VideoNewsCard
      item={item}
      isLiked={likedIds.has(item.id)}
      onLike={handleLike}
    />
  ), [likedIds, handleLike]);

  const ItemSeparator = useCallback(() => <View style={styles.separator} />, []);

  const keyExtractor = useCallback((item: VideoItem) => item.id, []);

  // ── Loading screen ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
        <ActivityIndicator size="large" color={PS_GREEN} />
        <Text style={styles.loadTxt}>
          {isKn ? 'ವಿಡಿಯೋ ಲೋಡ್ ಆಗುತ್ತಿದೆ...' : 'Loading videos...'}
        </Text>
      </View>
    );
  }

  // ── Error / Empty screen ────────────────────────────────────────────────────
  if (error && videos.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
        <MaterialIcons name="videocam-off" size={72} color="rgba(0,0,0,0.18)" />
        <Text style={styles.errTxt}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => loadVideos()}>
          <Text style={styles.retryTxt}>{isKn ? 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ' : 'Try Again'}</Text>
        </TouchableOpacity>
        {isReporterUnlocked && (
          <TouchableOpacity style={styles.uploadBtn} onPress={() => setShowUpload(true)}>
            <MaterialIcons name="add-circle" size={20} color={PS_GREEN} />
            <Text style={styles.uploadBtnTxt}>
              {isKn ? 'ಮೊದಲ ವಿಡಿಯೋ ಅಪ್‌ಲೋಡ್' : 'Upload first video'}
            </Text>
          </TouchableOpacity>
        )}
        <UploadVideoModal visible={showUpload} onClose={() => setShowUpload(false)} language={language} />
      </View>
    );
  }

  // ── Social Feed ─────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Feed top header bar */}
      <View style={styles.feedHeader}>
        <Image
          source={require('../../assets/images/logo.png')}
          style={styles.feedLogo}
          resizeMode="contain"
        />
        <Text style={styles.feedTitle}>Public Samachar</Text>
        <View style={{ flex: 1 }} />
        {isReporterUnlocked && (
          <TouchableOpacity
            style={styles.headerUploadBtn}
            onPress={() => setShowUpload(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="video-call" size={22} color={PS_GREEN} />
          </TouchableOpacity>
        )}
      </View>

      {/* Video news cards */}
      <FlatList
        ref={listRef}
        data={videos}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={ItemSeparator}
        onScrollToIndexFailed={info => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadVideos(true)}
            colors={[PS_GREEN]}
            tintColor={PS_GREEN}
          />
        }
        showsVerticalScrollIndicator={false}
        windowSize={5}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={styles.listContent}
      />

      <UploadVideoModal visible={showUpload} onClose={() => setShowUpload(false)} language={language} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f0f0f0' },

  // Feed header
  feedHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    gap: 8,
  },
  feedLogo: { width: 34, height: 34, borderRadius: 8 },
  feedTitle: { fontSize: 18, fontWeight: '900', color: PS_GREEN, letterSpacing: 0.3 },
  headerUploadBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: { paddingBottom: 16 },
  separator:   { height: 8, backgroundColor: '#f0f0f0' },

  // States
  centered: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  loadTxt: { color: '#555', fontSize: 15 },
  errTxt: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    backgroundColor: '#E8F5E9',
    borderRadius: 30,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#A5D6A7',
  },
  retryTxt:  { color: PS_GREEN, fontWeight: '700', fontSize: 14 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E8F5E9',
    borderRadius: 30,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 4,
  },
  uploadBtnTxt: { color: PS_GREEN, fontWeight: '600', fontSize: 14 },
});
