import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, Post, formatDate } from '../../utils/api';
import { useLanguage } from '../../context/LanguageContext';
import SocialInteractionBar from '../../components/SocialInteractionBar';

export default function TrendingScreen() {
  const { t, languageCategoryId, language } = useLanguage();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadTrending = useCallback(async (pageNum: number, reset = false) => {
    if (pageNum === 1) setLoading(true); else setLoadingMore(true);
    try {
      const resp = await api.getTrending(pageNum, languageCategoryId);
      setTotalPages(Math.ceil(resp.total / 10));
      setPosts(prev => reset ? resp.posts : [...prev, ...resp.posts]);
    } catch {
      if (reset) setPosts([]);
    }
    if (pageNum === 1) setLoading(false); else setLoadingMore(false);
  }, [languageCategoryId]);

  useEffect(() => { setPage(1); loadTrending(1, true); }, [language, languageCategoryId]);

  const handleLoadMore = () => {
    if (loadingMore || page >= totalPages) return;
    const next = page + 1;
    setPage(next);
    loadTrending(next);
  };

  const renderItem = ({ item, index }: { item: Post; index: number }) => (
    <View style={styles.cardWrapper}>
      {/* ── Horizontal content row ── */}
      <TouchableOpacity
        testID={`trending-card-${item.id}`}
        style={styles.card}
        onPress={() => router.push(`/article/${item.id}`)}
        activeOpacity={0.88}
      >
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{index + 1}</Text>
        </View>
        {item.featured_image
          ? <Image source={{ uri: item.featured_image }} style={styles.cardImage} resizeMode="cover" />
          : <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <MaterialIcons name="whatshot" size={24} color="#E91E8C" />
            </View>}
        <View style={styles.cardBody}>
          {item.category_names?.[0] && (
            <Text style={styles.cardCat}>{item.category_names[0].name}</Text>
          )}
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.cardFooter}>
            <MaterialIcons name="comment" size={12} color="#999" />
            <Text style={styles.cardComments}>{item.comment_count}</Text>
            <Text style={styles.cardMeta}>{formatDate(item.date)}</Text>
          </View>
        </View>
      </TouchableOpacity>
      {/* ── Compact social bar — full width below the row ── */}
      <SocialInteractionBar
        postId={item.id}
        title={item.title}
        url={item.link}
        compact
        showDivider
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar backgroundColor="#fff" barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <MaterialIcons name="whatshot" size={26} color="#E91E8C" />
        <Text style={styles.headerTitle}>{t('trendingNews')}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator testID="trending-loading" size="large" color="#1AAA94" />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="whatshot" size={50} color="#E0E0E0" />
          <Text style={styles.emptyText}>{t('noNews')}</Text>
        </View>
      ) : (
        <FlatList
          testID="trending-list"
          data={posts}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color="#1AAA94" style={{ marginVertical: 16 }} /> : null
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fff' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#1AAA94' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#bbb', fontSize: 15, marginTop: 8 },
  list: { paddingVertical: 8, paddingBottom: 24 },
  cardWrapper: { borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  card: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  rankBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1AAA94', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  cardImage: { width: 85, height: 70, borderRadius: 8, flexShrink: 0 },
  cardImagePlaceholder: { backgroundColor: '#FFF0F5', alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardCat: { fontSize: 10, color: '#E91E8C', fontWeight: '700', marginBottom: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#111', lineHeight: 18 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  cardComments: { fontSize: 11, color: '#999', marginRight: 6 },
  cardMeta: { fontSize: 11, color: '#999' },
});
