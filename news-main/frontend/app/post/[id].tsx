/**
 * Single Post Screen — Public Samachar
 * Deep-link destination for shareable video links.
 * Route: /post/[id]
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VideoNewsCard, { VideoItem } from '../../components/VideoNewsCard';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const PS_GREEN    = '#1B5E20';

export default function SinglePostScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const insets   = useSafeAreaInsets();

  const [post,    setPost]    = useState<VideoItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('Invalid post link.');
      setLoading(false);
      return;
    }
    fetch(`${BACKEND_URL}/api/cf/post/${id}`)
      .then(r => {
        if (!r.ok) throw new Error('Post not found');
        return r.json();
      })
      .then((data: any) => {
        setPost({
          id:           data.id,
          title:        data.title        || '',
          description:  data.description  || '',
          videoUrl:     data.video_url    || '',
          thumbUrl:     data.thumb_url    || '',
          reporterName: data.reporter_name || 'Reporter',
          timestamp:    data.timestamp    || 0,
          location:     data.location     || '',
          source:       'ps',
          cfId:         data.id,
          reach:        data.views        || 0,
        });
      })
      .catch(e => setError(e?.message || 'Could not load post.'))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/video' as any)}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={22} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Public Samachar</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Content */}
      {loading && (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={PS_GREEN} />
          <Text style={styles.loadTxt}>Loading post...</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.centred}>
          <MaterialIcons name="error-outline" size={56} color="#ccc" />
          <Text style={styles.errorTxt}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => router.replace('/(tabs)/video' as any)}
          >
            <Text style={styles.retryTxt}>Go to Feed</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && post && (
        <ScrollView showsVerticalScrollIndicator={false}>
          <VideoNewsCard
            item={post}
            isLiked={isLiked}
            onLike={() => setIsLiked(l => !l)}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#f0f0f0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#1B5E20' },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  loadTxt:  { color: '#666', fontSize: 14, marginTop: 8 },
  errorTxt: { color: '#888', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    backgroundColor: '#E8F5E9',
    borderRadius: 30,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#A5D6A7',
    marginTop: 4,
  },
  retryTxt: { color: '#1B5E20', fontWeight: '700', fontSize: 14 },
});
