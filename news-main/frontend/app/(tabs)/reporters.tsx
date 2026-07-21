import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  ActivityIndicator, Alert, StatusBar, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Post, formatDate } from '../../utils/api';
import { useLanguage } from '../../context/LanguageContext';
import UploadVideoModal from '../../components/UploadVideoModal';
import ReporterLeaderboard from '../../components/ReporterLeaderboard';
import { showToast } from '../../components/Toast';

const UNLOCK_KEY = 'reporter_unlocked_v1';

export default function ReportersTab() {
  const { language } = useLanguage();
  const [followed, setFollowed]             = useState<string[]>([]);
  const [feedPosts, setFeedPosts]           = useState<Post[]>([]);
  const [loading, setLoading]               = useState(false);
  const [activeView, setActiveView]         = useState<'reporters' | 'feed'>('reporters');
  const isKn = language === 'kn';

  // ── Reporter Access State ─────────────────────────────────────────────────
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadFollowed();
      // Reload unlock state each time the tab gains focus (in case user set it in Settings)
      AsyncStorage.getItem(UNLOCK_KEY).then(v => setIsUnlocked(v === 'true')).catch(() => {});
    }, [])
  );

  // Tapping the lock icon directs user to Settings to enter the code
  const handleLockTap = () => {
    if (isUnlocked) {
      Alert.alert(
        isKn ? 'ವರದಿಗಾರ ಪ್ರವೇಶ ಸಕ್ರಿಯ' : 'Reporter Access Active',
        isKn
          ? 'ರಿಪೋರ್ಟರ್ ಅಪ್ಲೋಡ್ ಮೋಡ್ ಸಕ್ರಿಯವಾಗಿದೆ. ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ ನಿರ್ವಹಿಸಿ.'
          : 'Reporter upload mode is active. Manage it in Settings.',
        [
          { text: isKn ? 'ಸೆಟ್ಟಿಂಗ್ಸ್' : 'Go to Settings', onPress: () => router.navigate('/(tabs)/user') },
          { text: 'OK' },
        ]
      );
    } else {
      Alert.alert(
        isKn ? 'ಪ್ರವೇಶ ಕೋಡ್ ಅಗತ್ಯ' : 'Access Code Required',
        isKn
          ? 'ಅಪ್ಲೋಡ್ ಬಟನ್ ಅನ್ಲಾಕ್ ಮಾಡಲು ಸೆಟ್ಟಿಂಗ್ಸ್ → ರಿಪೋರ್ಟರ್ ಅಪ್ಲೋಡ್ ಪ್ರವೇಶ ತೆರೆಯಿರಿ.'
          : 'To unlock the Upload button, go to Settings → Reporter Upload Access and enter your code.',
        [
          { text: isKn ? 'ಸೆಟ್ಟಿಂಗ್ಸ್ ತೆರೆಯಿರಿ' : 'Open Settings', onPress: () => router.navigate('/(tabs)/user') },
          { text: isKn ? 'ರದ್ದು' : 'Cancel', style: 'cancel' },
        ]
      );
    }
  };

  const loadFollowed = async () => {
    try {
      const val = await AsyncStorage.getItem('followed_reporters');
      setFollowed(val ? JSON.parse(val) : []);
    } catch {}
  };

  const loadFollowedFeed = async (reporters: string[]) => {
    if (reporters.length === 0) return;
    setLoading(true);
    try {
      const resp = await api.getPosts(1, 50);
      setFeedPosts(resp.posts.filter(p => reporters.includes(p.author)));
    } catch {}
    setLoading(false);
  };

  const handleViewChange = (view: 'reporters' | 'feed') => {
    setActiveView(view);
    if (view === 'feed' && feedPosts.length === 0) loadFollowedFeed(followed);
  };

  const unfollow = async (name: string) => {
    Alert.alert(
      isKn ? 'ಅನುಸರಣೆ ರದ್ದು' : 'Unfollow',
      isKn ? `${name} ಅನುಸರಣೆ ರದ್ದು ಮಾಡಲೇ?` : `Stop following ${name}?`,
      [
        { text: isKn ? 'ರದ್ದು' : 'Cancel', style: 'cancel' },
        {
          text: isKn ? 'ಹೌದು' : 'Yes, Unfollow',
          style: 'destructive',
          onPress: async () => {
            const updated = followed.filter(r => r !== name);
            setFollowed(updated);
            setFeedPosts(prev => prev.filter(p => p.author !== name));
            await AsyncStorage.setItem('followed_reporters', JSON.stringify(updated));
          },
        },
      ]
    );
  };

  // Toggle follow — used by the leaderboard so users can follow with one tap
  const toggleFollowFromLeaderboard = useCallback(async (name: string) => {
    const isCurrentlyFollowed = followed.includes(name);
    const updated = isCurrentlyFollowed
      ? followed.filter(r => r !== name)
      : [...followed, name];
    setFollowed(updated);
    if (isCurrentlyFollowed) {
      setFeedPosts(prev => prev.filter(p => p.author !== name));
    }
    await AsyncStorage.setItem('followed_reporters', JSON.stringify(updated));
    showToast(
      isCurrentlyFollowed
        ? (isKn ? `${name} ಅನುಸರಣೆ ರದ್ದು` : `Unfollowed ${name}`)
        : (isKn ? `${name} ಅನುಸರಿಸಲಾಗಿದೆ!` : `Now following ${name}`),
      'success'
    );
  }, [followed, isKn]);

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#DFF5EF', '#EAF7F3', '#F5FAF8', '#FAFAFA']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={s.safe} edges={['top']}>
        <StatusBar backgroundColor="transparent" translucent barStyle="dark-content" />

        {/* Header */}
        <View style={s.header}>
          <Ionicons name="people" size={26} color="#1AAA94" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.headerTitle}>{isKn ? 'ವರದಿಗಾರರು' : 'Reporters'}</Text>
            <Text style={s.headerSub}>
              {followed.length > 0
                ? (isKn ? `${followed.length} ಅನುಸರಣೆ` : `Following ${followed.length}`)
                : (isKn ? 'ಯಾರನ್ನೂ ಅನುಸರಿಸುತ್ತಿಲ್ಲ' : 'Not following anyone')}
            </Text>
          </View>
          {/* Hidden 5-tap lock — opens Reporter Login modal */}
          <TouchableOpacity
            onPress={handleLockTap}
            activeOpacity={1}
            style={s.lockBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name={isUnlocked ? 'lock-open-outline' : 'lock-closed-outline'}
              size={18}
              color={isUnlocked ? '#4CAF50' : '#bbb'}
            />
          </TouchableOpacity>
        </View>

        {/* View Toggle (only when following) */}
        {followed.length > 0 && (
          <View style={s.toggleRow}>
            <TouchableOpacity
              style={[s.toggleBtn, activeView === 'reporters' && s.toggleBtnActive]}
              onPress={() => handleViewChange('reporters')}
            >
              <Ionicons
                name="people-outline"
                size={14}
                color={activeView === 'reporters' ? '#fff' : '#1AAA94'}
              />
              <Text style={[s.toggleText, activeView === 'reporters' && s.toggleTextActive]}>
                {isKn ? 'ವರದಿಗಾರರು' : 'Following List'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.toggleBtn, activeView === 'feed' && s.toggleBtnActive]}
              onPress={() => handleViewChange('feed')}
            >
              <MaterialIcons
                name="dynamic-feed"
                size={14}
                color={activeView === 'feed' ? '#fff' : '#1AAA94'}
              />
              <Text style={[s.toggleText, activeView === 'feed' && s.toggleTextActive]}>
                {isKn ? 'ಅವರ ಫೀಡ್' : 'Their Feed'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView
          testID="reporters-scroll"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ═════ Reporter of the Week Leaderboard ═════ */}
          <ReporterLeaderboard
            isKn={isKn}
            followed={followed}
            onFollow={toggleFollowFromLeaderboard}
            onOpenArticle={(postId) => router.push(`/article/${postId}`)}
          />

          {/* Empty state — no one followed */}
          {followed.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="person-add-outline" size={64} color="#D0E8E2" />
              <Text style={s.emptyTitle}>
                {isKn ? 'ಇನ್ನೂ ಯಾರನೂ ಅನುಸರಿಸುತ್ತಿಲ್ಲ' : 'Not following anyone yet'}
              </Text>
              <Text style={s.emptyDesc}>
                {isKn
                  ? 'ಮೇಲಿನ ಲೀಡರ್\u200Cಬೋರ್ಡ್\u200Cನಿಂದ ವರದಿಗಾರರನ್ನು ಅನುಸರಿಸಿ, ಅಥವಾ ಸುದ್ದಿ ಕಾರ್ಡ್\u200Cಗಳಲ್ಲಿನ + ಬಟನ್ ಬಳಸಿ'
                  : 'Follow top reporters from the leaderboard above, or tap + on any news card.'}
              </Text>
              <TouchableOpacity testID="browse-news-btn" style={s.browseBtn} onPress={() => router.navigate('/(tabs)')}>
                <Text style={s.browseBtnText}>{isKn ? 'ಸುದ್ದಿ ನೋಡಿ' : 'Browse News'}</Text>
              </TouchableOpacity>
            </View>
          ) : activeView === 'reporters' ? (
            <View style={s.list}>
              <Text style={s.listHeader}>
                {isKn
                  ? `${followed.length} ವರದಿಗಾರರನ್ನು ಅನುಸರಿಸುತ್ತಿದ್ದೀರಿ`
                  : `You follow ${followed.length} reporter${followed.length !== 1 ? 's' : ''}`}
              </Text>
              {followed.map(item => (
                <View key={item} style={s.reporterCard}>
                  <View style={s.avatarWrap}>
                    <Ionicons name="person" size={22} color="#1AAA94" />
                  </View>
                  <View style={s.reporterInfo}>
                    <Text style={s.reporterName}>{item}</Text>
                    <Text style={s.reporterSub}>{isKn ? 'ವರದಿಗಾರ' : 'Reporter'}</Text>
                  </View>
                  <TouchableOpacity style={s.unfollowBtn} onPress={() => unfollow(item)}>
                    <Ionicons name="person-remove-outline" size={14} color="#D32F2F" />
                    <Text style={s.unfollowText}>{isKn ? 'ರದ್ದು' : 'Unfollow'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : loading ? (
            <View style={s.centered}>
              <ActivityIndicator size="large" color="#1AAA94" />
              <Text style={s.loadingText}>{isKn ? 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...' : 'Loading feed...'}</Text>
            </View>
          ) : feedPosts.length === 0 ? (
            <View style={s.empty}>
              <MaterialIcons name="article" size={60} color="#D0E8E2" />
              <Text style={s.emptyTitle}>{isKn ? 'ಸುದ್ದಿ ಕಂಡುಬಂದಿಲ್ಲ' : 'No posts found'}</Text>
              <Text style={s.emptyDesc}>
                {isKn
                  ? 'ನೀವು ಅನುಸರಿಸುವ ವರದಿಗಾರರ ಯಾವುದೇ ಸುದ್ದಿ ಕಂಡುಬಂದಿಲ್ಲ'
                  : 'No recent posts from reporters you follow'}
              </Text>
            </View>
          ) : (
            <View style={s.list}>
              <Text style={s.listHeader}>
                {isKn ? 'ಅನುಸರಿಸಿದ ವರದಿಗಾರರ ಸುದ್ದಿ' : 'Latest from followed reporters'}
              </Text>
              {feedPosts.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={s.newsCard}
                  onPress={() => router.push(`/article/${item.id}`)}
                  activeOpacity={0.88}
                >
                  <View style={s.newsCardLeft}>
                    <View style={s.newsAuthorRow}>
                      <Ionicons name="person-circle-outline" size={14} color="#1AAA94" />
                      <Text style={s.newsAuthor}>{item.author}</Text>
                    </View>
                    <Text style={s.newsTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={s.newsMeta}>{formatDate(item.date)}</Text>
                  </View>
                  {item.featured_image ? (
                    <Image source={{ uri: item.featured_image }} style={s.newsThumb} resizeMode="cover" />
                  ) : (
                    <View style={[s.newsThumb, s.newsThumbPlaceholder]}>
                      <MaterialIcons name="article" size={22} color="#ccc" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        {/* ── Reporter Upload FAB (only when unlocked) ──────────────────── */}
        {isUnlocked && (
          <TouchableOpacity
            style={s.fab}
            onPress={() => setShowUploadModal(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="camera" size={26} color="#fff" />
            <Text style={s.fabTxt}>Upload</Text>
          </TouchableOpacity>
        )}

        {/* ── Upload Video Modal ─────────────────────────────────────────── */}
        <UploadVideoModal
          visible={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          language={language}
        />

      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#1AAA94' },
  headerSub:   { fontSize: 12, color: '#888', marginTop: 1 },
  lockBtn:     { padding: 6 },

  /* Upload FAB */
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1AAA94', borderRadius: 30,
    paddingVertical: 12, paddingHorizontal: 20,
    elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  fabTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.4)',
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1AAA94',
  },
  toggleBtnActive: { backgroundColor: '#1AAA94', borderColor: '#1AAA94' },
  toggleText: { fontSize: 13, fontWeight: '700', color: '#1AAA94' },
  toggleTextActive: { color: '#fff' },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#333', textAlign: 'center' },
  emptyDesc: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 21 },
  browseBtn: {
    backgroundColor: '#1AAA94',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 4,
  },
  browseBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 40 },
  loadingText: { color: '#999', fontSize: 14 },
  list: { padding: 16, gap: 10 },
  listHeader: { fontSize: 13, color: '#888', marginBottom: 8 },
  reporterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    elevation: 1,
  },
  avatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#E6F7F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reporterInfo: { flex: 1 },
  reporterName: { fontSize: 15, fontWeight: '700', color: '#222' },
  reporterSub: { fontSize: 11, color: '#888', marginTop: 2 },
  unfollowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    backgroundColor: '#FFF8F8',
  },
  unfollowText: { color: '#D32F2F', fontSize: 12, fontWeight: '600' },
  newsCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    elevation: 1,
  },
  newsCardLeft: { flex: 1 },
  newsAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  newsAuthor: { fontSize: 11, color: '#1AAA94', fontWeight: '700' },
  newsTitle: { fontSize: 14, fontWeight: '700', color: '#111', lineHeight: 19 },
  newsMeta: { fontSize: 11, color: '#999', marginTop: 4 },
  newsThumb: { width: 82, height: 72, borderRadius: 8 },
  newsThumbPlaceholder: { backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
});
