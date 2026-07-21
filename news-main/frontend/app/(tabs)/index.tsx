import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, StyleSheet,
  StatusBar, ActivityIndicator, Modal, TextInput,
  Dimensions, Animated, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Post, Category, formatDate, YouTubeVideo } from '../../utils/api';
import { fetchCFVideos } from '../../utils/cloudflare';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import SidebarMenu from '../../components/SidebarMenu';
import SocialInteractionBar from '../../components/SocialInteractionBar';
import CommentSheet from '../../components/CommentSheet';
import VideoPlayerModal from '../../components/VideoPlayerModal';
import { showToast } from '../../components/Toast';
import { NewsCardSkeletonList } from '../../components/NewsCardSkeleton';
import { BRAND } from '../../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.82;

// ─── Story Viewer ──────────────────────────────────────────────────────────────
function StoryViewer({ stories, startIndex, visible, onClose }: {
  stories: Post[]; startIndex: number; visible: boolean; onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [isPaused, setIsPaused] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const { t, language } = useLanguage();

  useEffect(() => { if (visible) setIdx(startIndex); }, [visible, startIndex]);

  useEffect(() => {
    if (!visible) return;
    if (isPaused) {
      if (animRef.current) animRef.current.stop();
      return;
    }
    progressAnim.setValue(0);
    if (animRef.current) animRef.current.stop();
    animRef.current = Animated.timing(progressAnim, {
      toValue: 1, duration: 6000, useNativeDriver: false,
    });
    animRef.current.start(({ finished }) => { if (finished) goNext(); });
    return () => { if (animRef.current) animRef.current.stop(); };
  }, [idx, visible, isPaused]);

  const goNext = () => {
    if (idx < stories.length - 1) setIdx(p => p + 1);
    else onClose();
  };
  const goPrev = () => {
    if (idx > 0) { progressAnim.setValue(0); setIdx(p => p - 1); }
    else { progressAnim.setValue(0); if (animRef.current) { animRef.current.stop(); animRef.current.start(); } }
  };

  const story = stories[idx];
  if (!story) return null;

  const cleanExcerpt = story.excerpt
    ? story.excerpt.replace(/<[^>]+>/g, '').trim()
    : '';

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={sv.container}>
        {/* Background Image */}
        {story.featured_image ? (
          <Image source={{ uri: story.featured_image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, sv.fallback]}>
            <MaterialIcons name="newspaper" size={80} color="#333" />
          </View>
        )}

        {/* Top & Bottom Gradients */}
        <LinearGradient
          colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.4)', 'transparent']}
          style={sv.overlayTop}
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.65)', 'rgba(0,0,0,0.95)']}
          style={sv.overlayBottom}
        />

        {/* Progress bars & Header */}
        <SafeAreaView style={sv.safeTop}>
          <View style={sv.progressRow}>
            {stories.map((_, i) => (
              <View key={i} style={sv.progressBg}>
                <Animated.View style={[sv.progressFill, {
                  width: i < idx ? '100%' : i === idx
                    ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                    : '0%',
                }]} />
              </View>
            ))}
          </View>

          <View style={sv.headerRow}>
            <View style={sv.channelInfo}>
              <Image
                source={require('../../assets/images/logo.png')}
                style={sv.channelLogo}
                resizeMode="cover"
              />
              <View>
                <Text style={sv.channelName}>Public Samachar</Text>
                <Text style={sv.storyTime}>{story.author || 'Reporter'} • {formatDate(story.date)}</Text>
              </View>
            </View>
            <TouchableOpacity testID="story-close-btn" style={sv.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Bottom Story Card */}
        <View style={sv.bottom}>
          <View style={sv.glassCard}>
            {story.category_names?.[0] && (
              <View style={sv.categoryBadge}>
                <Text style={sv.categoryText}>{story.category_names[0].name}</Text>
              </View>
            )}
            <Text style={sv.storyTitle} numberOfLines={3}>{story.title}</Text>
            {cleanExcerpt.length > 0 && (
              <Text style={sv.storyExcerpt} numberOfLines={2}>{cleanExcerpt}</Text>
            )}
            <TouchableOpacity
              testID="story-read-btn"
              style={sv.readBtn}
              onPress={() => { onClose(); router.push(`/article/${story.id}`); }}
              activeOpacity={0.88}
            >
              <Text style={sv.readBtnText}>
                {language === 'kn' ? 'ಪೂರ್ಣ ಸುದ್ದಿ ಓದಿ' : 'Read Full Story'}
              </Text>
              <Ionicons name="arrow-forward-circle" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Interactive Tap & Press-and-Hold Zones */}
        <TouchableOpacity
          style={sv.leftTap}
          onPress={goPrev}
          onPressIn={() => setIsPaused(true)}
          onPressOut={() => setIsPaused(false)}
          activeOpacity={1}
        />
        <TouchableOpacity
          style={sv.rightTap}
          onPress={goNext}
          onPressIn={() => setIsPaused(true)}
          onPressOut={() => setIsPaused(false)}
          activeOpacity={1}
        />
      </View>
    </Modal>
  );
}

// ─── Main Home Screen ──────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { t, languageCategoryId, detectLanguageCategory, language } = useLanguage();
  const { isLoggedIn } = useAuth();

  const [stories, setStories] = useState<Post[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [featuredPosts, setFeaturedPosts] = useState<Post[]>([]);
  const [newsPosts, setNewsPosts] = useState<Post[]>([]);
  const [ytVideos, setYtVideos]   = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [storyViewerIdx, setStoryViewerIdx] = useState(-1);
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [followedReporters, setFollowedReporters] = useState<string[]>([]);
  const [showFollowingOnly, setShowFollowingOnly] = useState(false);

  // Speed Dial FAB
  const [fabOpen, setFabOpen] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [questionText, setQuestionText] = useState('');

  // ── Video player modal + comment sheet ─────────────────────────────────────
  const [ytPlayerVideo, setYtPlayerVideo] = useState<YouTubeVideo | null>(null);
  const [commentTarget, setCommentTarget] = useState<{
    source: 'youtube' | 'wp';
    id: string | number;
    title: string;
  } | null>(null);
  const fabAnim = useRef(new Animated.Value(0)).current;

  // ── Location & Story Category Filters ───────────────────────────────────────
  const [userLocation, setUserLocation] = useState<string>('ಹುಬ್ಬಳ್ಳಿ-ಧಾರವಾಡ');
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [activeStoryQueue, setActiveStoryQueue] = useState<Post[]>([]);

  useEffect(() => {
    AsyncStorage.getItem('user_location').then(val => {
      if (val) setUserLocation(val);
    }).catch(() => {});
    AsyncStorage.getItem('followed_reporters').then(val => {
      if (val) setFollowedReporters(JSON.parse(val));
    }).catch(() => {});
  }, []);

  const changeUserLocation = async (loc: string) => {
    setUserLocation(loc);
    setShowLocationModal(false);
    await AsyncStorage.setItem('user_location', loc).catch(() => {});
    showToast(language === 'kn' ? `ಸ್ಥಳ ಬದಲಾಗಿದೆ: ${loc}` : `Location set to ${loc}`, 'info');
  };

  // ── Group all posts for Story Categories ──────────────────────────────────
  const allAvailablePosts = Array.from(
    new Map([...stories, ...newsPosts, ...featuredPosts].map(p => [p.id, p])).values()
  );

  const topStories = allAvailablePosts.slice(0, 10);

  const locationStories = allAvailablePosts.filter(p => {
    const locLower = userLocation.toLowerCase();
    const txt = (p.title + ' ' + p.content + ' ' + (p.category_names?.[0]?.name || '')).toLowerCase();
    return txt.includes(locLower) || txt.includes('ಹುಬ್ಬಳ್ಳಿ') || txt.includes('ಧಾರವಾಡ') || txt.includes('hubballi') || txt.includes('dharwad');
  });

  const sportsStories = allAvailablePosts.filter(p => {
    const txt = (p.title + ' ' + p.content + ' ' + (p.category_names?.[0]?.name || '')).toLowerCase();
    return txt.includes('ಕ್ರೀಡೆ') || txt.includes('sports') || txt.includes('cricket') || txt.includes('ipl') || txt.includes('football');
  });

  const businessStories = allAvailablePosts.filter(p => {
    const txt = (p.title + ' ' + p.content + ' ' + (p.category_names?.[0]?.name || '')).toLowerCase();
    return txt.includes('ಉದ್ದಿಮೆ') || txt.includes('ವ್ಯಾಪಾರ') || txt.includes('business') || txt.includes('invest') || txt.includes('share');
  });

  const astrologyStories = allAvailablePosts.filter(p => {
    const txt = (p.title + ' ' + p.content + ' ' + (p.category_names?.[0]?.name || '')).toLowerCase();
    return txt.includes('ರಾಶಿ') || txt.includes('ಭವಿಷ್ಯ') || txt.includes('ಜ್ಯೋತಿಷ್ಯ') || txt.includes('astrology') || txt.includes('horoscope');
  });

  const followedStories = allAvailablePosts.filter(p => followedReporters.includes(p.author));

  const openStoryCategory = (queue: Post[]) => {
    const list = queue.length > 0 ? queue : allAvailablePosts.slice(0, 10);
    setActiveStoryQueue(list);
    setStoryViewerIdx(0);
  };

  const openStoryList = (list: Post[], index: number) => {
    setActiveStoryQueue(list);
    setStoryViewerIdx(index);
  };

  const toggleFollowReporter = useCallback(async (authorName: string) => {
    const updated = followedReporters.includes(authorName)
      ? followedReporters.filter(r => r !== authorName)
      : [...followedReporters, authorName];
    setFollowedReporters(updated);
    await AsyncStorage.setItem('followed_reporters', JSON.stringify(updated));
    showToast(
      updated.includes(authorName)
        ? (language === 'kn' ? `${authorName} ಅನುಸರಿಸಲಾಗಿದೆ!` : `Now following ${authorName}`)
        : (language === 'kn' ? `ಅನುಸರಣೆ ರದ್ದು ಮಾಡಲಾಗಿದೆ` : `Unfollowed ${authorName}`),
      'success'
    );
  }, [followedReporters, language]);

  const toggleFab = () => {
    Animated.spring(fabAnim, {
      toValue: fabOpen ? 0 : 1,
      useNativeDriver: true,
      tension: 100,
      friction: 7,
    }).start();
    setFabOpen(f => !f);
  };

  // Debounced search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchResults, setSearchResults] = useState<Post[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!text.trim()) { setSearchResults(null); return; }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const resp = await api.search(text.trim(), 20);
        const lower = text.toLowerCase();
        const sorted = [...resp.posts].sort((a, b) => {
          const aM = a.title.toLowerCase().includes(lower);
          const bM = b.title.toLowerCase().includes(lower);
          return aM === bM ? 0 : aM ? -1 : 1;
        });
        setSearchResults(sorted);
      } catch {}
      setIsSearching(false);
    }, 600);
  };

  const saveQuestion = async () => {
    if (!questionText.trim()) return;
    try {
      const existing = await AsyncStorage.getItem('public_questions');
      const list = existing ? JSON.parse(existing) : [];
      list.unshift({ id: Date.now(), text: questionText.trim(), date: new Date().toISOString() });
      await AsyncStorage.setItem('public_questions', JSON.stringify(list));
      setQuestionText('');
      setShowQuestionModal(false);
      showToast(language === 'kn' ? 'ಪ್ರಶ್ನೆ ಉಳಿಸಲಾಗಿದೆ!' : 'Question saved successfully!', 'success');
    } catch {
      showToast(language === 'kn' ? 'ಉಳಿಸಲು ವಿಫಲ' : 'Failed to save. Try again.', 'error');
    }
  };

  const filteredPosts = (() => {
    if (searchQuery.trim() && searchResults !== null) return searchResults;
    let posts = newsPosts;
    if (showFollowingOnly && followedReporters.length > 0) {
      posts = posts.filter(p => followedReporters.includes(p.author));
    }
    return posts;
  })();

  // ── Mixed feed: alternating blog rows → YouTube video (blog, blog, video, blog, blog, video…)
  type FeedItem =
    | { kind: 'post'; data: Post }
    | { kind: 'youtube'; data: YouTubeVideo };

  const combinedFeed: FeedItem[] = (() => {
    // Keep posts newest-first, YouTube videos newest-first
    const sortedPosts: FeedItem[] = [...filteredPosts]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map(p => ({ kind: 'post' as const, data: p }));
    const sortedYT: FeedItem[] = [...ytVideos]
      .sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
      .map(v => ({ kind: 'youtube' as const, data: v }));

    // Interleave: 4 blog posts (2 rows of 2) → 1 YouTube video → repeat
    const result: FeedItem[] = [];
    let pi = 0, yi = 0;
    while (pi < sortedPosts.length || yi < sortedYT.length) {
      for (let i = 0; i < 4 && pi < sortedPosts.length; i++) result.push(sortedPosts[pi++]);
      if (yi < sortedYT.length) result.push(sortedYT[yi++]);
    }
    return result;
  })();

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [storiesData, catsData, featuredData, ytData, cfVideos] = await Promise.all([
        api.getStories(),
        api.getCategories(),
        api.getPosts(1, 6),
        api.getYoutubeFeed().catch(() => ({ videos: [] })),
        fetchCFVideos(1).catch(() => []),
      ]);
      const formattedCF: YouTubeVideo[] = (cfVideos || []).map(v => ({
        video_id: v.id,
        title: v.title,
        published: v.timestamp ? new Date(v.timestamp).toISOString() : new Date().toISOString(),
        thumbnail: v.thumb_url || '',
        url: v.video_url || '',
      }));
      const mergedVideos = [...formattedCF, ...(ytData.videos || [])];
      setStories(storiesData);
      setCategories(catsData);
      setFeaturedPosts(featuredData.posts);
      setYtVideos(mergedVideos);
      detectLanguageCategory(catsData);
      AsyncStorage.setItem('home_cache_v1', JSON.stringify({ featured: featuredData.posts, ts: Date.now() })).catch(() => {});
    } catch (e) {
      console.error('Init load error:', e);
    }
    setLoading(false);
  }, []);

  const loadNews = useCallback(async (pageNum: number, catId: number | null | undefined, reset = false) => {
    if (pageNum === 1) setLoading(true); else setLoadingMore(true);
    try {
      const resp = await api.getPosts(pageNum, 10, catId !== undefined ? catId : languageCategoryId);
      setTotalPages(resp.total_pages);
      setNewsPosts(prev => reset || pageNum === 1 ? resp.posts : [...prev, ...resp.posts]);
      if (pageNum === 1) {
        AsyncStorage.setItem('news_cache_v1', JSON.stringify({ posts: resp.posts, ts: Date.now() })).catch(() => {});
      }
    } catch (e) {
      console.error('News load error:', e);
    }
    if (pageNum === 1) setLoading(false); else setLoadingMore(false);
  }, [languageCategoryId]);

  useEffect(() => {
    // Show cached news immediately on startup
    AsyncStorage.getItem('news_cache_v1').then(v => {
      if (v) { try { const c = JSON.parse(v); if (c.posts?.length) setNewsPosts(c.posts); } catch {} }
    }).catch(() => {});
    AsyncStorage.getItem('home_cache_v1').then(v => {
      if (v) { try { const c = JSON.parse(v); if (c.featured?.length) setFeaturedPosts(c.featured); } catch {} }
    }).catch(() => {});
    loadInitial();
  }, []);

  useEffect(() => {
    setPage(1);
    loadNews(1, selectedCatId !== null ? selectedCatId : languageCategoryId, true);
  }, [selectedCatId, language, languageCategoryId]);

  const handleLoadMore = () => {
    if (loadingMore || page >= totalPages) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadNews(nextPage, selectedCatId !== null ? selectedCatId : languageCategoryId);
  };

  const handleCarouselScroll = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / (CARD_WIDTH + 12));
    setCarouselIdx(Math.max(0, Math.min(i, featuredPosts.length - 1)));
  };

  // ── Helper: render a single 2-col WP news card ─────────────────────────────
  const renderPostCard = (post: Post) => (
    <TouchableOpacity
      key={post.id}
      testID={`news-card-${post.id}`}
      style={styles.newsCard}
      onPress={() => router.push(`/article/${post.id}`)}
      activeOpacity={0.88}
    >
      {post.featured_image
        ? <Image source={{ uri: post.featured_image }} style={styles.newsCardImage} resizeMode="cover" />
        : <View style={[styles.newsCardImage, styles.newsCardImagePlaceholder]}>
            <MaterialIcons name="article" size={30} color="#ccc" />
          </View>}
      <View style={styles.newsCardContent}>
        <Text style={styles.newsCardTitle} numberOfLines={2}>{post.title}</Text>
        <View style={styles.newsCardFooter}>
          <Text style={styles.newsCardMeta} numberOfLines={1}>{post.author || ''}</Text>
          <TouchableOpacity
            style={[styles.miniFollowBtn, followedReporters.includes(post.author) && styles.miniFollowBtnActive]}
            onPress={(e) => { e.stopPropagation(); toggleFollowReporter(post.author); }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons
              name={followedReporters.includes(post.author) ? 'person-remove-outline' : 'person-add-outline'}
              size={11}
              color={followedReporters.includes(post.author) ? '#fff' : '#1AAA94'}
            />
          </TouchableOpacity>
        </View>
      </View>
      <SocialInteractionBar
        postId={post.id}
        title={post.title}
        url={`https://mypublicsamachar.com/?p=${post.id}`}
        compact
        showDivider
        onComment={() => setCommentTarget({ source: 'wp', id: post.id, title: post.title })}
      />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Gradient Background */}
      <LinearGradient
        colors={['#DFF5EF', '#EAF7F3', '#F5FAF8', '#FAFAFA']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar backgroundColor="transparent" translucent barStyle="dark-content" />

        {/* Glassy Header — YouTube + Bell only */}
        <BlurView intensity={80} tint="light" style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              testID="hamburger-btn"
              style={styles.hamburgerBtn}
              onPress={() => setShowSidebar(true)}
            >
              <MaterialIcons name="menu" size={26} color="#1AAA94" />
            </TouchableOpacity>
            <Image
              source={require('../../assets/images/header-logo.png')}
              style={styles.headerLogo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity testID="header-youtube-btn" style={styles.headerIcon}
              onPress={() => Linking.openURL('https://www.youtube.com/@MyPublicSamachar')}>
              <MaterialIcons name="play-circle-filled" size={27} color="#FF0000" />
            </TouchableOpacity>
            <TouchableOpacity testID="header-bell-btn" style={styles.headerIcon}
              onPress={() => showToast(language === 'kn' ? 'ಶೀಘ್ರದಲ್ಲಿ ಬರುತ್ತಿದೆ' : 'Notifications coming soon', 'info')}>
              <MaterialIcons name="notifications" size={27} color="#444" />
            </TouchableOpacity>
          </View>
        </BlurView>

        {/* Glassy Search Bar */}
        <View style={styles.searchWrapper}>
          <BlurView intensity={50} tint="light" style={styles.searchBlur}>
            <MaterialIcons name="search" size={19} color="#666" />
            <TextInput
              testID="home-search-input"
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder={language === 'kn' ? '\u0cb8\u0cc1\u0ca6\u0ccd\u0ca6\u0cbf \u0cb9\u0cc1\u0ca1\u0cc1\u0c95\u0cbf...' : 'Search news, reporters...'}
              placeholderTextColor="#999"
              returnKeyType="search"
            />
            {isSearching
              ? <ActivityIndicator size="small" color="#1AAA94" />
              : searchQuery.length > 0
                ? <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults(null); }}>
                    <MaterialIcons name="close" size={18} color="#999" />
                  </TouchableOpacity>
                : null}
          </BlurView>
        </View>

        <ScrollView
          testID="home-scroll"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
            if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 100) handleLoadMore();
          }}
          scrollEventThrottle={400}
        >
          {/* Stories Row with Location & Category Filter Rings */}
          <View testID="stories-section">
            <View style={styles.storyHeaderRow}>
              <Text style={styles.storySectionTitle}>
                {language === 'kn' ? 'ನ್ಯೂಸ್ ಸ್ಟೋರೀಸ್' : 'News Stories'}
              </Text>
              <TouchableOpacity
                testID="story-location-picker-btn"
                style={styles.locationPickerPill}
                onPress={() => setShowLocationModal(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="location-sharp" size={13} color="#E91E8C" />
                <Text style={styles.locationPickerText}>{userLocation}</Text>
                <MaterialIcons name="arrow-drop-down" size={18} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesContainer}>
              {/* Location Ring */}
              <TouchableOpacity
                testID="story-ring-location"
                style={styles.storyItem}
                onPress={() => openStoryCategory(locationStories)}
              >
                <View style={[styles.storyRing, styles.storyRingLocation]}>
                  <View style={styles.storyRingIconBg}>
                    <Ionicons name="location" size={24} color="#E91E8C" />
                  </View>
                </View>
                <Text style={styles.storyLabel} numberOfLines={1}>
                  {userLocation}
                </Text>
              </TouchableOpacity>

              {/* Followed Reporters Ring (if following) */}
              {followedReporters.length > 0 && (
                <TouchableOpacity
                  testID="story-ring-following"
                  style={styles.storyItem}
                  onPress={() => openStoryCategory(followedStories)}
                >
                  <View style={[styles.storyRing, styles.storyRingFollowing]}>
                    <View style={styles.storyRingIconBg}>
                      <Ionicons name="people" size={24} color="#9C27B0" />
                    </View>
                  </View>
                  <Text style={styles.storyLabel} numberOfLines={1}>
                    {language === 'kn' ? 'ಅನುಸರಿಸಿದ' : 'Following'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Top News Ring */}
              <TouchableOpacity
                testID="story-ring-top"
                style={styles.storyItem}
                onPress={() => openStoryCategory(topStories)}
              >
                <View style={[styles.storyRing, styles.storyRingTop]}>
                  <View style={styles.storyRingIconBg}>
                    <MaterialIcons name="local-fire-department" size={26} color="#FF5722" />
                  </View>
                </View>
                <Text style={styles.storyLabel} numberOfLines={1}>
                  {language === 'kn' ? 'ಪ್ರಮುಖ' : 'Top News'}
                </Text>
              </TouchableOpacity>

              {/* Sports Ring */}
              <TouchableOpacity
                testID="story-ring-sports"
                style={styles.storyItem}
                onPress={() => openStoryCategory(sportsStories)}
              >
                <View style={[styles.storyRing, styles.storyRingSports]}>
                  <View style={styles.storyRingIconBg}>
                    <Ionicons name="football" size={24} color="#2196F3" />
                  </View>
                </View>
                <Text style={styles.storyLabel} numberOfLines={1}>
                  {language === 'kn' ? 'ಕ್ರೀಡೆ' : 'Sports'}
                </Text>
              </TouchableOpacity>

              {/* Business / Investments Ring */}
              <TouchableOpacity
                testID="story-ring-business"
                style={styles.storyItem}
                onPress={() => openStoryCategory(businessStories)}
              >
                <View style={[styles.storyRing, styles.storyRingBusiness]}>
                  <View style={styles.storyRingIconBg}>
                    <Ionicons name="trending-up" size={24} color="#4CAF50" />
                  </View>
                </View>
                <Text style={styles.storyLabel} numberOfLines={1}>
                  {language === 'kn' ? 'ಉದ್ದಿಮೆ' : 'Business'}
                </Text>
              </TouchableOpacity>

              {/* Astrology Ring */}
              <TouchableOpacity
                testID="story-ring-astrology"
                style={styles.storyItem}
                onPress={() => openStoryCategory(astrologyStories)}
              >
                <View style={[styles.storyRing, styles.storyRingAstrology]}>
                  <View style={styles.storyRingIconBg}>
                    <Ionicons name="sparkles" size={24} color="#FF9800" />
                  </View>
                </View>
                <Text style={styles.storyLabel} numberOfLines={1}>
                  {language === 'kn' ? 'ರಾಶಿ ಭವಿಷ್ಯ' : 'Astrology'}
                </Text>
              </TouchableOpacity>

              {/* Individual Stories */}
              {stories.map((story, i) => (
                <TouchableOpacity
                  key={story.id}
                  testID={`story-item-${story.id}`}
                  style={styles.storyItem}
                  onPress={() => openStoryList(stories, i)}
                >
                  <View style={styles.storyRing}>
                    {story.featured_image ? (
                      <Image source={{ uri: story.featured_image }} style={styles.storyImage} />
                    ) : (
                      <View style={[styles.storyImage, styles.storyPlaceholder]}>
                        <MaterialIcons name="article" size={24} color="#1AAA94" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.storyLabel} numberOfLines={1}>
                    {story.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Category Tabs + Following filter */}
          <View testID="category-tabs">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catTabsContainer}>
              <TouchableOpacity
                testID="cat-tab-all"
                style={[styles.catTab, selectedCatId === null && !showFollowingOnly && styles.catTabActive]}
                onPress={() => { setSelectedCatId(null); setShowFollowingOnly(false); }}
              >
                <Text style={[styles.catTabText, selectedCatId === null && !showFollowingOnly && styles.catTabTextActive]}>
                  {t('allNews')}
                </Text>
              </TouchableOpacity>
              {followedReporters.length > 0 && (
                <TouchableOpacity
                  testID="cat-tab-following"
                  style={[styles.catTab, styles.catTabFollowing, showFollowingOnly && styles.catTabFollowingActive]}
                  onPress={() => { setShowFollowingOnly(f => !f); setSelectedCatId(null); }}
                >
                  <Ionicons name="people" size={12} color={showFollowingOnly ? '#fff' : '#E91E8C'} />
                  <Text style={[styles.catTabText, styles.catTabFollowingText, showFollowingOnly && styles.catTabTextWhite]}>
                    {language === 'kn' ? '\u0c85\u0ca8\u0cc1\u0cb8\u0cb0\u0cbf\u0cb8\u0cbf\u0ca6' : 'Following'}
                  </Text>
                </TouchableOpacity>
              )}
              {categories.filter(c => c.slug !== 'uncategorized').map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  testID={`cat-tab-${cat.id}`}
                  style={[styles.catTab, selectedCatId === cat.id && styles.catTabActive]}
                  onPress={() => { setSelectedCatId(cat.id); setShowFollowingOnly(false); }}
                >
                  <Text style={[styles.catTabText, selectedCatId === cat.id && styles.catTabTextActive]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Ad Banner Component — Yellow Gold Style like reference banner */}
          <TouchableOpacity
            testID="ad-banner-btn"
            style={styles.adBannerWrapperYellow}
            onPress={() => Linking.openURL('tel:9591484307')}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={['#FFF59D', '#FDD835', '#FBC02D']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.adBannerGradientYellow}
            >
              <Image
                source={require('../../assets/images/header-logo.png')}
                style={styles.adBannerLogoYellow}
                resizeMode="contain"
              />
              <View style={styles.adBannerTextWrapYellow}>
                <Text style={styles.adBannerTextMainYellow}>
                  {language === 'kn' ? 'ಸುದ್ದಿ ಮತ್ತು ಜಾಹೀರಾತುಗಳಿಗೆ ಸಂಪರ್ಕಿಸಿ' : 'Contact for News & Ads'}
                </Text>
                <Text style={styles.adBannerPhoneYellow}>
                  Mob.NO: 95914 84307
                </Text>
              </View>
              <View style={styles.adBannerClickBtnYellow}>
                <Text style={styles.adBannerClickBtnTextYellow}>
                  CLICK HERE 👆
                </Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Top 5 Latest Videos Feed */}
          {ytVideos.length > 0 && (
            <View testID="top5-videos-section" style={styles.top5Section}>
              <View style={styles.top5Header}>
                <View style={styles.top5TitleRow}>
                  <View style={styles.top5Badge}>
                    <Ionicons name="play" size={12} color="#fff" />
                  </View>
                  <Text style={styles.top5Title}>
                    {language === 'kn' ? 'ಇತ್ತೀಚಿನ ವಿಡಿಯೋಗಳು (Top 5)' : 'Latest Videos (Top 5)'}
                  </Text>
                </View>
                <TouchableOpacity
                  testID="see-all-top5-videos-btn"
                  onPress={() => router.push('/video')}
                  style={styles.top5SeeAllBtn}
                >
                  <Text style={styles.top5SeeAllText}>
                    {language === 'kn' ? 'ಎಲ್ಲವೂ ನೋಡಿ ➔' : 'See All ➔'}
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.top5ScrollContent}
              >
                {ytVideos.slice(0, 5).map((vid, idx) => (
                  <TouchableOpacity
                    key={`top5-${vid.video_id}`}
                    testID={`top5-video-item-${idx}`}
                    style={styles.top5Card}
                    onPress={() => {
                      if (vid.url && !vid.url.includes('youtube.com')) {
                        router.push({ pathname: '/(tabs)/video', params: { videoId: vid.video_id } });
                      } else {
                        setYtPlayerVideo(vid);
                      }
                    }}
                    activeOpacity={0.88}
                  >
                    <View style={styles.top5ThumbWrap}>
                      {vid.thumbnail ? (
                        <Image source={{ uri: vid.thumbnail }} style={styles.top5Thumb} resizeMode="cover" />
                      ) : (
                        <View style={[styles.top5Thumb, styles.top5ThumbFallback]}>
                          <Ionicons name="logo-youtube" size={32} color="#FF0000" />
                        </View>
                      )}
                      <View style={styles.top5PlayIconOverlay}>
                        <Ionicons name="play-circle" size={34} color="rgba(255, 255, 255, 0.95)" />
                      </View>
                      <View style={styles.top5RankBadge}>
                        <Text style={styles.top5RankText}>#{idx + 1}</Text>
                      </View>
                    </View>
                    <View style={styles.top5Body}>
                      <Text style={styles.top5CardTitle} numberOfLines={2}>{vid.title}</Text>
                      <Text style={styles.top5CardDate}>{formatDate(vid.published)}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Featured Carousel */}
          {featuredPosts.length > 0 && (
            <View testID="featured-carousel" style={styles.carouselSection}>
              <ScrollView
                horizontal
                pagingEnabled={false}
                snapToInterval={CARD_WIDTH + 12}
                snapToAlignment="start"
                decelerationRate="fast"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carouselContainer}
                onScroll={handleCarouselScroll}
                scrollEventThrottle={16}
              >
                {featuredPosts.map((post) => (
                  <TouchableOpacity
                    key={post.id}
                    testID={`featured-card-${post.id}`}
                    style={[styles.featuredCard, { width: CARD_WIDTH }]}
                    onPress={() => router.push(`/article/${post.id}`)}
                    activeOpacity={0.92}
                  >
                    {post.featured_image
                      ? <Image source={{ uri: post.featured_image }} style={styles.featuredImage} resizeMode="cover" />
                      : <View style={[styles.featuredImage, styles.featuredPlaceholder]} />}
                    <View style={styles.featuredOverlay}>
                      {post.category_names?.[0] && (
                        <View style={styles.featuredBadge}>
                          <Text style={styles.featuredBadgeText}>{post.category_names[0].name}</Text>
                        </View>
                      )}
                      <Text style={styles.featuredTitle} numberOfLines={2}>{post.title}</Text>
                      <Text style={styles.featuredMeta} numberOfLines={1}>
                        {post.author} • {formatDate(post.date)}
                      </Text>
                    </View>
                    <View style={styles.bookmarkIcon}>
                      <MaterialIcons name="bookmark-border" size={22} color="#fff" />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.dotsRow}>
                {featuredPosts.map((_, i) => (
                  <View key={i} style={[styles.dot, i === carouselIdx && styles.dotActive]} />
                ))}
              </View>
            </View>
          )}

          {/* Top News Grid */}
          <View testID="top-news-section" style={styles.newsSection}>
            <View style={styles.newsSectionHeader}>
              <Text style={styles.newsSectionTitle}>
                {showFollowingOnly
                  ? (language === 'kn' ? '\u0c85\u0ca8\u0cc1\u0cb8\u0cb0\u0cbf\u0cb8\u0cbf\u0ca6 \u0cb8\u0cc1\u0ca6\u0ccd\u0ca6\u0cbf' : 'Following Feed')
                  : t('topNews')}
              </Text>
              <View style={styles.newsSectionUnderline} />
            </View>

            {loading ? (
              <NewsCardSkeletonList rows={4} />
            ) : combinedFeed.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="article" size={56} color="#DADADA" />
                <Text style={styles.emptyTitle}>
                  {showFollowingOnly
                    ? (language === 'kn' ? 'ಇನ್ನೂ ಸುದ್ದಿ ಇಲ್ಲ' : 'No news yet')
                    : t('noNews')}
                </Text>
                <Text style={styles.emptyText}>
                  {showFollowingOnly
                    ? (language === 'kn' ? 'ನೀವು ಅನುಸರಿಸುತ್ತಿರುವ ವರದಿಗಾರರಿಂದ ಇನ್ನೂ ಸುದ್ದಿ ಪ್ರಕಟವಾಗಿಲ್ಲ' : 'None of the reporters you follow have posted yet.')
                    : (language === 'kn' ? 'ಎಳೆದು ಹೊಸ ಸುದ್ದಿಗಾಗಿ ರಿಫ್ರೆಶ್ ಮಾಡಿ' : 'Pull down to refresh feed')}
                </Text>
                {showFollowingOnly && (
                  <TouchableOpacity
                    testID="empty-show-all-btn"
                    style={styles.emptyActionBtn}
                    onPress={() => setShowFollowingOnly(false)}
                  >
                    <Text style={styles.emptyActionText}>
                      {language === 'kn' ? 'ಎಲ್ಲ ಸುದ್ದಿ ತೋರಿಸಿ' : 'Show all news'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <>
                {(() => {
                  // Render combinedFeed: YT items full-width, WP posts in 2-col grid
                  const elements: React.ReactNode[] = [];
                  let pendingPost: Post | null = null;
                  combinedFeed.forEach((item, idx) => {
                    if (item.kind === 'youtube') {
                      // Flush any pending post first (odd grid leftover)
                      if (pendingPost) {
                        elements.push(
                          <View key={`row-flush-${idx}`} style={styles.newsRow}>
                            {renderPostCard(pendingPost)}
                            <View style={styles.newsCardPlaceholder} />
                          </View>
                        );
                        pendingPost = null;
                      }
                      // Full-width YouTube card
                      const vid = item.data;
                      elements.push(
                        <TouchableOpacity
                          key={`yt-${vid.video_id}`}
                          style={styles.ytCard}
                          onPress={() => {
                            if (vid.url && !vid.url.includes('youtube.com')) {
                              router.push({ pathname: '/(tabs)/video', params: { videoId: vid.video_id } });
                            } else {
                              setYtPlayerVideo(vid);
                            }
                          }}
                          activeOpacity={0.88}
                        >
                          <View style={styles.ytThumbContainer}>
                            {vid.thumbnail
                              ? <Image source={{ uri: vid.thumbnail }} style={styles.ytThumb} resizeMode="cover" />
                              : <View style={[styles.ytThumb, { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }]}>
                                  <Ionicons name="logo-youtube" size={40} color="#FF0000" />
                                </View>}
                            <View style={styles.ytPlayOverlay}>
                              <Ionicons name="logo-youtube" size={28} color="#FF0000" />
                            </View>
                          </View>
                          <View style={styles.ytCardBody}>
                            <View style={styles.ytBadgeRow}>
                              <View style={styles.ytBadge}>
                                <Ionicons name="logo-youtube" size={10} color="#fff" />
                                <Text style={styles.ytBadgeTxt}>YouTube</Text>
                              </View>
                              <Text style={styles.ytDate}>{formatDate(vid.published)}</Text>
                            </View>
                            <Text style={styles.ytTitle} numberOfLines={2}>{vid.title}</Text>
                            <SocialInteractionBar
                              postId={vid.video_id}
                              title={vid.title}
                              url={vid.url}
                              compact
                              showDivider
                              onComment={() => setCommentTarget({ source: 'youtube', id: vid.video_id, title: vid.title })}
                            />
                          </View>
                        </TouchableOpacity>
                      );
                    } else {
                      const post = item.data;
                      if (pendingPost) {
                        elements.push(
                          <View key={`row-${idx}`} style={styles.newsRow}>
                            {renderPostCard(pendingPost)}
                            {renderPostCard(post)}
                          </View>
                        );
                        pendingPost = null;
                      } else {
                        pendingPost = post;
                      }
                    }
                  });
                  // Final flush
                  if (pendingPost) {
                    elements.push(
                      <View key="row-last" style={styles.newsRow}>
                        {renderPostCard(pendingPost)}
                        <View style={styles.newsCardPlaceholder} />
                      </View>
                    );
                  }
                  return elements;
                })()}
                {loadingMore && (
                  <ActivityIndicator testID="load-more-indicator" color="#1AAA94" style={{ marginVertical: 16 }} />
                )}
                {!loadingMore && page < totalPages && (
                  <TouchableOpacity testID="load-more-btn" style={styles.loadMoreBtn} onPress={handleLoadMore}>
                    <Text style={styles.loadMoreText}>{t('loadMore')}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </ScrollView>

        {/* Speed Dial — Overlay */}
        {fabOpen && (
          <TouchableOpacity style={styles.fabOverlay} onPress={toggleFab} activeOpacity={1} />
        )}

        {/* Speed Dial FAB */}
        <View style={styles.speedDialContainer}>
          {fabOpen && (
            <Animated.View
              style={[
                styles.fabOptions,
                {
                  opacity: fabAnim,
                  transform: [
                    { scale: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                    { translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                  ],
                },
              ]}
            >
              {/* Public Question */}
              <TouchableOpacity
                testID="fab-question-btn"
                style={styles.fabOption}
                onPress={() => { toggleFab(); setShowQuestionModal(true); }}
                activeOpacity={0.85}
              >
                <View style={styles.fabOptionLabelWrap}>
                  <Text style={styles.fabOptionLabel}>
                    {language === 'kn' ? '\u0cb8\u0cbe\u0cb0\u0ccd\u0cb5\u0c9c\u0ca8\u0cbf\u0c95 \u0caa\u0ccd\u0cb0\u0cb6\u0ccd\u0ca8\u0cc6' : 'Public Question'}
                  </Text>
                </View>
                <View style={[styles.fabActionBtn, { backgroundColor: '#E91E8C' }]}>
                  <MaterialIcons name="help-outline" size={22} color="#fff" />
                </View>
              </TouchableOpacity>

              {/* Upload News */}
              <TouchableOpacity
                testID="fab-upload-btn"
                style={styles.fabOption}
                onPress={() => { toggleFab(); Linking.openURL('https://mypublicsamachar.com/submit-story/'); }}
                activeOpacity={0.85}
              >
                <View style={styles.fabOptionLabelWrap}>
                  <Text style={styles.fabOptionLabel}>
                    {language === 'kn' ? '\u0cb8\u0cc1\u0ca6\u0ccd\u0ca6\u0cbf \u0c85\u0caa\u0ccd\u0cb2\u0cca\u0ca1\u0ccd' : 'Upload News'}
                  </Text>
                </View>
                <View style={[styles.fabActionBtn, { backgroundColor: '#388E3C' }]}>
                  <MaterialIcons name="cloud-upload" size={22} color="#fff" />
                </View>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Main FAB toggle */}
          <TouchableOpacity
            testID="fab-btn"
            style={[styles.fab, fabOpen && styles.fabActive]}
            onPress={toggleFab}
            activeOpacity={0.85}
          >
            <Animated.View
              style={{
                transform: [{
                  rotate: fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }),
                }],
              }}
            >
              <MaterialIcons name="add" size={28} color="#fff" />
            </Animated.View>
          </TouchableOpacity>
        </View>

        {/* Story Viewer */}
        <StoryViewer
          stories={activeStoryQueue.length > 0 ? activeStoryQueue : stories}
          startIndex={Math.max(0, storyViewerIdx)}
          visible={storyViewerIdx >= 0}
          onClose={() => setStoryViewerIdx(-1)}
        />

        {/* Location Selector Modal */}
        <Modal
          visible={showLocationModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowLocationModal(false)}
        >
          <TouchableOpacity
            style={styles.locationModalOverlay}
            activeOpacity={1}
            onPress={() => setShowLocationModal(false)}
          >
            <View style={styles.locationModalCard}>
              <Text style={styles.locationModalTitle}>
                {language === 'kn' ? 'ನಿಮ್ಮ ಜಿಲ್ಲೆ / ಸ್ಥಳ ಆಯ್ಕೆಮಾಡಿ' : 'Select Your District / Location'}
              </Text>
              <ScrollView style={{ maxHeight: 300 }}>
                {[
                  'ಹುಬ್ಬಳ್ಳಿ-ಧಾರವಾಡ',
                  'ಬೆಳಗಾವಿ',
                  'ಉತ್ತರ ಕನ್ನಡ',
                  'ಗದಗ',
                  'ಹಾವೇರಿ',
                  'ಬೆಂಗಳೂರು',
                  'ಮೈಸೂರು',
                  'ದಕ್ಷಿಣ ಕನ್ನಡ',
                  'ಶಿವಮೊಗ್ಗ',
                  'ದಾವಣಗೆರೆ',
                ].map((locName) => (
                  <TouchableOpacity
                    key={locName}
                    style={[
                      styles.locationOptionRow,
                      userLocation === locName && styles.locationOptionActive,
                    ]}
                    onPress={() => changeUserLocation(locName)}
                  >
                    <Ionicons
                      name="location-outline"
                      size={18}
                      color={userLocation === locName ? '#E91E8C' : '#555'}
                    />
                    <Text
                      style={[
                        styles.locationOptionText,
                        userLocation === locName && styles.locationOptionTextActive,
                      ]}
                    >
                      {locName}
                    </Text>
                    {userLocation === locName && (
                      <Ionicons name="checkmark-circle" size={18} color="#E91E8C" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Sidebar Drawer */}
        <SidebarMenu
          visible={showSidebar}
          categories={categories}
          onClose={() => setShowSidebar(false)}
          onCategorySelect={(catId) => {
            setSelectedCatId(catId);
            setPage(1);
          }}
        />

        {/* In-app YouTube Video Player Modal */}
        {ytPlayerVideo && (
          <VideoPlayerModal
            visible={!!ytPlayerVideo}
            videoId={ytPlayerVideo.video_id}
            title={ytPlayerVideo.title}
            onClose={() => setYtPlayerVideo(null)}
          />
        )}

        {/* Native Comment Sheet */}
        {commentTarget && (
          <CommentSheet
            visible={!!commentTarget}
            onClose={() => setCommentTarget(null)}
            source={commentTarget.source}
            contentId={commentTarget.id}
            title={commentTarget.title}
          />
        )}

        {/* Public Question Modal */}
        <Modal
          visible={showQuestionModal}
          transparent
          animationType="slide"
          onRequestClose={() => { setShowQuestionModal(false); setQuestionText(''); }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <TouchableOpacity
              style={styles.qModalOverlay}
              activeOpacity={1}
              onPress={() => { setShowQuestionModal(false); setQuestionText(''); }}
            />
            <View style={styles.qModal}>
              <View style={styles.qModalHandle} />
              <Text style={styles.qModalTitle}>
                {language === 'kn' ? '\u0cb8\u0cbe\u0cb0\u0ccd\u0cb5\u0c9c\u0ca8\u0cbf\u0c95 \u0caa\u0ccd\u0cb0\u0cb6\u0ccd\u0ca8\u0cc6 \u0c95\u0cc7\u0cb3\u0cbf' : 'Ask a Public Question'}
              </Text>
              <Text style={styles.qModalSub}>
                {language === 'kn'
                  ? '\u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0caa\u0ccd\u0cb0\u0cb6\u0ccd\u0ca8\u0cc6 \u0cb8\u0ccd\u0ca5\u0cb3\u0cbf\u0caf \u0cb8\u0c82\u0c97\u0ccd\u0cb0\u0cb9\u0ca6\u0cb2\u0ccd\u0cb2\u0cbf \u0c89\u0cb3\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cc1\u0ca4\u0ccd\u0ca4\u0ca6\u0cc6'
                  : 'Your question will be saved to your local questions list'}
              </Text>
              <TextInput
                style={styles.qModalInput}
                value={questionText}
                onChangeText={setQuestionText}
                placeholder={
                  language === 'kn'
                    ? '\u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0caa\u0ccd\u0cb0\u0cb6\u0ccd\u0ca8\u0cc6 \u0c87\u0cb2\u0ccd\u0cb2\u0cbf \u0cac\u0cb0\u0cc6\u0caf\u0cbf\u0cb0\u0cbf...'
                    : 'Type your question here...'
                }
                placeholderTextColor="#bbb"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                autoFocus
                maxLength={500}
              />
              <Text style={styles.qCharCount}>{questionText.length}/500</Text>
              <View style={styles.qModalActions}>
                <TouchableOpacity
                  style={styles.qCancelBtn}
                  onPress={() => { setShowQuestionModal(false); setQuestionText(''); }}
                >
                  <Text style={styles.qCancelText}>
                    {language === 'kn' ? '\u0cb0\u0ca6\u0ccd\u0ca6\u0cc1' : 'Cancel'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.qSaveBtn, !questionText.trim() && styles.qSaveBtnDisabled]}
                  onPress={saveQuestion}
                  disabled={!questionText.trim()}
                >
                  <MaterialIcons name="save" size={17} color="#fff" />
                  <Text style={styles.qSaveText}>
                    {language === 'kn' ? '\u0c89\u0cb3\u0cbf\u0cb8\u0cbf' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

// ─── Story Viewer Styles ───────────────────────────────────────────────────────
const sv = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlayTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 160, zIndex: 1 },
  overlayBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 320, zIndex: 1 },
  fallback: { backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  safeTop: { paddingHorizontal: 12, zIndex: 10 },
  progressRow: { flexDirection: 'row', gap: 5, paddingTop: 12, paddingHorizontal: 4 },
  progressBg: { flex: 1, height: 3.5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 },
  channelInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  channelLogo: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#fff' },
  channelName: { color: '#fff', fontSize: 14, fontWeight: '800' },
  storyTime: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 40, left: 14, right: 14, zIndex: 10 },
  glassCard: { padding: 16, borderRadius: 20, backgroundColor: 'rgba(20, 20, 20, 0.75)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', gap: 8 },
  categoryBadge: { backgroundColor: '#E91E8C', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start' },
  categoryText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  storyTitle: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 25 },
  storyExcerpt: { color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 17 },
  readBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1AAA94', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, gap: 8, marginTop: 4 },
  readBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  leftTap: { position: 'absolute', left: 0, top: 100, bottom: 200, width: '30%', zIndex: 5 },
  rightTap: { position: 'absolute', right: 0, top: 100, bottom: 200, width: '70%', zIndex: 5 },
});

// ─── Main Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
  },
  searchWrapper: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 },
  searchBlur: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 24, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#222', height: 22 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  hamburgerBtn: { padding: 4, marginRight: 2 },
  headerLogo: { height: 40, width: 180, marginLeft: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIcon: { padding: 6 },
  scroll: { flex: 1 },

  storyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  storySectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#222',
  },
  locationPickerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF0F6',
    borderWidth: 1,
    borderColor: '#F8BBD0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  locationPickerText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E91E8C',
  },

  storiesContainer: { paddingHorizontal: 12, paddingVertical: 12, gap: 14 },
  storyItem: { alignItems: 'center', width: 72 },
  storyRing: { width: 66, height: 66, borderRadius: 33, borderWidth: 2.5, borderColor: '#E91E8C', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  storyRingLocation: { borderColor: '#E91E8C', backgroundColor: '#FFF0F6' },
  storyRingFollowing: { borderColor: '#9C27B0', backgroundColor: '#F3E5F5' },
  storyRingTop: { borderColor: '#FF5722', backgroundColor: '#FBE9E7' },
  storyRingSports: { borderColor: '#2196F3', backgroundColor: '#E3F2FD' },
  storyRingBusiness: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9' },
  storyRingAstrology: { borderColor: '#FF9800', backgroundColor: '#FFF3E0' },
  storyRingIconBg: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  storyRingFirst: { borderColor: '#1AAA94' },
  storyFirstInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#E6F7F3', alignItems: 'center', justifyContent: 'center' },
  storyFirstText: { color: '#1AAA94', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 14 },
  storyImage: { width: 60, height: 60, borderRadius: 30 },
  storyPlaceholder: { backgroundColor: '#E6F7F3', alignItems: 'center', justifyContent: 'center' },
  storyLabel: { marginTop: 4, fontSize: 10, color: '#333', textAlign: 'center', width: 68 },

  // Location Modal
  locationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  locationModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    elevation: 5,
  },
  locationModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1AAA94',
    marginBottom: 14,
    textAlign: 'center',
  },
  locationOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
    backgroundColor: '#F9F9F9',
  },
  locationOptionActive: {
    backgroundColor: '#FFF0F6',
    borderWidth: 1,
    borderColor: '#F8BBD0',
  },
  locationOptionText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  locationOptionTextActive: {
    color: '#E91E8C',
  },

  catTabsContainer: { paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  catTab: {
    paddingHorizontal: 14,
    height: 36,
    marginRight: 4,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    flexDirection: 'row',
    gap: 4,
  },
  catTabActive: {
    backgroundColor: BRAND.primarySoft,
    borderColor: BRAND.primary,
  },
  catTabFollowing: { backgroundColor: '#FCE4EC', borderColor: '#F48FB1' },
  catTabFollowingActive: { backgroundColor: BRAND.accent, borderColor: BRAND.accent },
  catTabText: { fontSize: 13, fontWeight: '600', color: '#666' },
  catTabTextActive: { color: BRAND.primaryDark },
  catTabFollowingText: { color: BRAND.accent },
  catTabTextWhite: { color: '#fff' },

  carouselSection: { paddingTop: 8 },
  carouselContainer: { paddingHorizontal: 16, gap: 12 },
  featuredCard: { height: 220, borderRadius: 14, overflow: 'hidden', backgroundColor: '#1AAA94', elevation: 3 },
  featuredImage: { width: '100%', height: '100%' },
  featuredPlaceholder: { backgroundColor: '#1AAA94' },
  featuredOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, paddingTop: 50, backgroundColor: 'transparent' },
  featuredBadge: { backgroundColor: '#E91E8C', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start', marginBottom: 6 },
  featuredBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  featuredTitle: { color: '#fff', fontSize: 16, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  featuredMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 4 },
  bookmarkIcon: { position: 'absolute', top: 12, right: 12 },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#ccc' },
  dotActive: { backgroundColor: '#1AAA94', width: 18, borderRadius: 4 },

  newsSection: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 120 },
  newsSectionHeader: { marginBottom: 14 },
  newsSectionTitle: { fontSize: 22, fontWeight: '900', color: '#1AAA94' },
  newsSectionUnderline: { height: 3, width: 50, backgroundColor: '#E91E8C', borderRadius: 2, marginTop: 4 },

  newsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  newsCard: { flex: 1, backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', elevation: 2 },
  /* YouTube full-width card in home feed */
  ytCard:          { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', elevation: 3, marginBottom: 0 },
  ytThumbContainer:{ position: 'relative' },
  ytThumb:         { width: '100%', height: 180 },
  ytPlayOverlay:   { position: 'absolute', top: 8, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 5 },
  ytCardBody:      { padding: 10 },
  ytBadgeRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  ytBadge:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FF0000', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  ytBadgeTxt:      { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  ytDate:          { fontSize: 11, color: '#999' },
  ytTitle:         { fontSize: 14, fontWeight: '700', color: '#111', lineHeight: 20, marginBottom: 6 },
  newsCardPlaceholder: { flex: 1 },
  newsCardImage: { width: '100%', height: 110 },
  newsCardImagePlaceholder: { backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  newsCardContent: { padding: 8 },
  newsCardTitle: { fontSize: 13, fontWeight: '700', color: '#111', lineHeight: 18 },
  newsCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, gap: 4 },
  newsCardMeta: { flex: 1, fontSize: 10, color: '#888', fontWeight: '500' },
  miniFollowBtn: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1AAA94', backgroundColor: 'rgba(255,255,255,0.85)' },
  miniFollowBtnActive: { backgroundColor: '#1AAA94', borderColor: '#1AAA94' },
  miniReportBtn: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFCDD2', backgroundColor: '#FFF8F8' },

  emptyState: { alignItems: 'center', paddingVertical: 50, gap: 10, paddingHorizontal: 24 },
  emptyTitle: { color: '#444', fontSize: 17, fontWeight: '800', marginTop: 4 },
  emptyText: { color: '#999', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  emptyActionBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: BRAND.primary,
  },
  emptyActionText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  loadMoreBtn: { backgroundColor: '#E6F7F3', borderRadius: 24, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  loadMoreText: { color: '#1AAA94', fontWeight: '700', fontSize: 14 },

  // Speed Dial FAB
  fabOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    zIndex: 10,
  },
  speedDialContainer: {
    position: 'absolute',
    bottom: 84,
    right: 20,
    alignItems: 'flex-end',
    zIndex: 20,
  },
  fabOptions: {
    alignItems: 'flex-end',
    gap: 10,
    marginBottom: 12,
  },
  fabOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fabOptionLabelWrap: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  fabOptionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
  },
  fabActionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#1AAA94',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  fabActive: { backgroundColor: '#0D8975' },

  // Public Question Modal
  qModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  qModal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
  },
  qModalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  qModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1AAA94',
    marginBottom: 4,
  },
  qModalSub: {
    fontSize: 12,
    color: '#888',
    marginBottom: 14,
  },
  qModalInput: {
    borderWidth: 1.5,
    borderColor: '#D0E4FF',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#F8FBFF',
    minHeight: 110,
    textAlignVertical: 'top',
  },
  qCharCount: {
    fontSize: 11,
    color: '#bbb',
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
  },
  qModalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  qCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  qCancelText: { fontSize: 14, fontWeight: '600', color: '#666' },
  qSaveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1AAA94',
    borderRadius: 14,
    paddingVertical: 13,
  },
  qSaveBtnDisabled: { backgroundColor: '#90CAF9' },
  qSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // ── Ad Banner Yellow Gold (Reference Banner Style) ──────────────────────────
  adBannerWrapperYellow: {
    marginHorizontal: 12,
    marginVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#D84315',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  adBannerGradientYellow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  adBannerLogoYellow: {
    width: 90,
    height: 42,
    borderRadius: 6,
    backgroundColor: '#fff',
    padding: 2,
    borderWidth: 1,
    borderColor: '#D84315',
  },
  adBannerTextWrapYellow: {
    flex: 1,
    justifyContent: 'center',
  },
  adBannerTextMainYellow: {
    color: '#B71C1C',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.1,
  },
  adBannerPhoneYellow: {
    color: '#1B5E20',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  adBannerClickBtnYellow: {
    backgroundColor: '#FFFDE7',
    borderWidth: 1.5,
    borderColor: '#B71C1C',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    elevation: 2,
  },
  adBannerClickBtnTextYellow: {
    color: '#B71C1C',
    fontSize: 10,
    fontWeight: '900',
  },

  // ── Ad Banner ───────────────────────────────────────────────────────────────
  adBannerWrapper: {
    marginHorizontal: 14,
    marginVertical: 10,
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#B71C1C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  adBannerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  adBannerLogo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#fff',
    padding: 2,
  },
  adBannerTextWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  adBannerTextMain: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  adBannerPhone: {
    color: '#FFE082',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  adBannerCallBtn: {
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    elevation: 2,
  },
  adBannerCallBtnText: {
    color: '#C62828',
    fontSize: 11,
    fontWeight: '900',
  },

  // ── Top 5 Latest Videos ─────────────────────────────────────────────────────
  top5Section: {
    marginTop: 6,
    marginBottom: 14,
  },
  top5Header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  top5TitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  top5Badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  top5Title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  top5SeeAllBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  top5SeeAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1AAA94',
  },
  top5ScrollContent: {
    paddingLeft: 16,
    paddingRight: 10,
    gap: 12,
  },
  top5Card: {
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  top5ThumbWrap: {
    width: '100%',
    height: 115,
    backgroundColor: '#111',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  top5Thumb: {
    ...StyleSheet.absoluteFillObject,
  },
  top5ThumbFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#222',
  },
  top5PlayIconOverlay: {
    zIndex: 2,
  },
  top5RankBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 3,
  },
  top5RankText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '900',
  },
  top5Body: {
    padding: 10,
  },
  top5CardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#222',
    lineHeight: 16,
    minHeight: 32,
  },
  top5CardDate: {
    fontSize: 10,
    color: '#888',
    marginTop: 4,
  },
});
