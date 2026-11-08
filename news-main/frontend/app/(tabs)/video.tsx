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
import PendingUploadsSheet from '../../components/PendingUploadsSheet';
import { startQueueSyncWatcher } from '../../utils/uploadQueue';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://public-samachar-api.onrender.com';
const UNLOCK_KEY  = 'reporter_unlocked_v1';
const PS_GREEN    = '#1B5E20';

// In-memory module cache for instant (0ms) feed display across tab switches
let inMemoryVideoFeedCache: VideoItem[] = [];

// High-speed fallback bootstrap feed so app never opens with a blank screen
const BOOTSTRAP_VIDEOS: VideoItem[] = [
  {
    id: 'cf_fe6390dd-ba7c-4919-b745-28d3131d7580',
    title: 'ದೀಪಾವಳಿ ಹಬ್ಬದ ಶುಭಾಶಯ ಕೋರಿದ ಕಾಂಗ್ರೆಸ್ ಮುಖಂಡ ಶಿವಾನಂದ ಬೆಂತೂರ',
    description: 'ದೀಪಾವಳಿಯು ಕೆಡುಕಿನ ಮೇಲೆ ಒಳಿತಿನ ವಿಜಯವನ್ನು ಪ್ರತಿಬಿಂಬಿಸುವ ಹಬ್ಬವಾಗಿದೆ...',
    videoUrl: 'https://pub-053fe10649264831be10ca4454fe912c.r2.dev/news_feed/videos/fe6390dd-ba7c-4919-b745-28d3131d7580.mp4',
    thumbUrl: 'https://pub-053fe10649264831be10ca4454fe912c.r2.dev/news_feed/thumbs/129cdd9a-b4da-479c-85cb-40ba9a1fe42e.jpg',
    reporterName: 'Girish G',
    timestamp: 1794133827452,
    location: 'ಕುಂದಗೋಳ',
    source: 'ps',
    cfId: 'fe6390dd-ba7c-4919-b745-28d3131d7580',
    reach: 1850,
    cautionFlag: false,
    verified: true,
    aspectRatio: '9:16',
  },
  {
    id: 'cf_82bc46e8-00fe-46e0-bb70-b3fc4f7396b2',
    title: 'ದೀಪಾವಳಿ ಹಬ್ಬದ ಶುಭಾಶಯ ಕೋರಿದ ಸತೀಶ ಕೊಬ್ಬಯ್ಯನವರ',
    description: 'ದೀಪಾವಳಿ ಹಬ್ಬದ ಶುಭಾಶಯ ಕೋರಿದ ಸತೀಶ ಕೊಬ್ಬಯ್ಯನವರ...',
    videoUrl: 'https://pub-053fe10649264831be10ca4454fe912c.r2.dev/news_feed/videos/82bc46e8-00fe-46e0-bb70-b3fc4f7396b2.mp4',
    thumbUrl: 'https://pub-053fe10649264831be10ca4454fe912c.r2.dev/news_feed/thumbs/22909407-2a62-4217-be08-f4ee0b93dc49.jpg',
    reporterName: 'Girish G',
    timestamp: 1794133179261,
    location: 'ಕುಂದಗೋಳ',
    source: 'ps',
    cfId: '82bc46e8-00fe-46e0-bb70-b3fc4f7396b2',
    reach: 2420,
    cautionFlag: false,
    verified: true,
    aspectRatio: '9:16',
  },
  {
    id: 'cf_5de2a48c-84ed-4ef7-b948-22d5e2241cd7',
    title: 'ಗುಡ್ಡೆಪ್ಪನವರ ಮನೆಗೆ ದೀಪಾವಳಿ ಹಬ್ಬದ ಪ್ರಯುಕ್ತ ಶುಭಾಶಯ ಕೋರಿದ ಪ್ರವೀಣ್ ಗುಡಿಸಾಗರ',
    description: 'ಗುಡ್ಡೆಪ್ಪನವರ ಮನೆಗೆ ದೀಪಾವಳಿ ಹಬ್ಬದ ಪ್ರಯುಕ್ತ ಶುಭಾಶಯ ಕೋರಿದ ಪ್ರವೀಣ್ ಗುಡಿಸಾಗರ...',
    videoUrl: 'https://pub-053fe10649264831be10ca4454fe912c.r2.dev/news_feed/videos/5de2a48c-84ed-4ef7-b948-22d5e2241cd7.mp4',
    thumbUrl: 'https://pub-053fe10649264831be10ca4454fe912c.r2.dev/news_feed/thumbs/7ec3eeb7-0f8c-4f1d-b50a-e39d391bc151.jpg',
    reporterName: 'Girish G',
    timestamp: 1794132483842,
    location: 'ಕುಂದಗೋಳ',
    source: 'ps',
    cfId: '5de2a48c-84ed-4ef7-b948-22d5e2241cd7',
    reach: 3200,
    cautionFlag: false,
    verified: true,
    aspectRatio: '9:16',
  },
];

// ── Fetch Cloudflare / PS videos with fast timeout and SWR caching ─────
async function fetchCFVideos(page = 1): Promise<VideoItem[]> {
  const MAX = 2;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500); // 4.5s fast timeout
      const resp = await fetch(
        `${BACKEND_URL}/api/cf/videos?page=${page}&limit=20`,
        {
          signal: ctrl.signal,
          headers: { 'Accept': 'application/json' },
        }
      );
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        const rawList = Array.isArray(data?.videos) ? data.videos : [];
        if (rawList.length > 0) {
          const videos: VideoItem[] = rawList.map((v: any) => ({
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
            aspectRatio:  v.aspect_ratio  || '9:16',
          }));
          return videos;
        }
      }
    } catch (err) {
      console.warn(`[VideoFeed] Fetch attempt ${attempt} error:`, err);
    }
    if (attempt < MAX) {
      await new Promise(r => setTimeout(r, 600));
    }
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

  // Fast zero-delay start: use in-memory cache or bootstrap data immediately
  const [videos,              setVideos]              = useState<VideoItem[]>(() => {
    return inMemoryVideoFeedCache.length > 0 ? inMemoryVideoFeedCache : BOOTSTRAP_VIDEOS;
  });
  const [loading,             setLoading]             = useState(false);
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
    const stopWatcher = startQueueSyncWatcher();
    return stopWatcher;
  }, []);

  const loadVideos = useCallback(async (isRefresh = false) => {
    if (!isRefresh) {
      // Restore latest persistent cache without blocking the UI
      try {
        const cached = await AsyncStorage.getItem('cf_videos_cache_v2');
        if (cached) {
          const { videos: cv } = JSON.parse(cached);
          if (cv?.length > 0) {
            inMemoryVideoFeedCache = cv;
            setVideos(cv);
          }
        }
      } catch {}
    }

    if (isRefresh) {
      setRefreshing(true);
    }
    setError(null);

    // Stale-While-Revalidate: fetch in background, update smoothly
    const cfItems = await fetchCFVideos(1);

    if (cfItems.length > 0) {
      inMemoryVideoFeedCache = cfItems;
      setVideos(cfItems);
      AsyncStorage.setItem('cf_videos_cache_v2', JSON.stringify({ videos: cfItems, ts: Date.now() })).catch(() => {});
    } else {
      setVideos(prev => {
        if (prev.length === 0) {
          setError(isKn ? 'ಇನ್ನೂ ವಿಡಿಯೋ ಲಭ್ಯವಿಲ್ಲ' : 'No videos yet. Be the first to upload!');
        }
        return prev;
      });
    }

    setRefreshing(false);
  }, [isKn]);

  useEffect(() => { loadVideos(); }, []);

  const handleLike = useCallback((id: string) => {
    setLikedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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

  // ── Error / Empty screen ────────────────────────────────────────────────────
  if (error && videos.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
        <PendingUploadsSheet language={language} />
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
      <PendingUploadsSheet language={language} />

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
