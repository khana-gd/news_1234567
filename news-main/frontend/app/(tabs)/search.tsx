import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  Image, StyleSheet, ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, Post, formatDate } from '../../utils/api';
import { useLanguage } from '../../context/LanguageContext';

export default function SearchScreen() {
  const { t, languageCategoryId } = useLanguage();
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const resp = await api.search(q.trim());
      setPosts(resp.posts);
      setTotal(resp.total);
    } catch {
      setPosts([]); setTotal(0);
    }
    setLoading(false);
  }, [query]);

  const renderItem = ({ item }: { item: Post }) => (
    <TouchableOpacity
      testID={`search-result-${item.id}`}
      style={styles.card}
      onPress={() => router.push(`/article/${item.id}`)}
      activeOpacity={0.88}
    >
      {item.featured_image
        ? <Image source={{ uri: item.featured_image }} style={styles.cardImage} resizeMode="cover" />
        : <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <MaterialIcons name="article" size={24} color="#ccc" />
          </View>}
      <View style={styles.cardBody}>
        {item.category_names?.[0] && (
          <Text style={styles.cardCat}>{item.category_names[0].name}</Text>
        )}
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.cardMeta}>{item.author} • {formatDate(item.date)}</Text>
        {item.excerpt ? (
          <Text style={styles.cardExcerpt} numberOfLines={2}>{item.excerpt}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar backgroundColor="#fff" barStyle="dark-content" />

      {/* Search Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('searchNews')}</Text>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={20} color="#999" style={{ marginLeft: 10 }} />
            <TextInput
              testID="search-input"
              style={styles.searchInput}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor="#999"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => handleSearch()}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => { setQuery(''); setPosts([]); setSearched(false); }}>
                <MaterialIcons name="close" size={18} color="#999" style={{ marginRight: 10 }} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity testID="search-btn" style={styles.searchButton} onPress={() => handleSearch()}>
            <MaterialIcons name="search" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Results */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator testID="search-loading" size="large" color="#1AAA94" />
          <Text style={styles.loadingText}>{t('loading')}</Text>
        </View>
      ) : !searched ? (
        <View style={styles.centered}>
          <MaterialIcons name="search" size={60} color="#E0E0E0" />
          <Text style={styles.emptyText}>{t('searchPlaceholder')}</Text>
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="search-off" size={60} color="#E0E0E0" />
          <Text style={styles.emptyText}>{t('noResults')}</Text>
        </View>
      ) : (
        <FlatList
          testID="search-results"
          data={posts}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.resultsCount}>
              {total} results for &quot;{query}&quot;
            </Text>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fff' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#1AAA94', marginBottom: 10 },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 24, height: 44 },
  searchInput: { flex: 1, fontSize: 14, color: '#111', paddingHorizontal: 8, height: 44 },
  searchButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1AAA94', alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 },
  loadingText: { color: '#999', fontSize: 14 },
  emptyText: { color: '#bbb', fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  resultsCount: { color: '#666', fontSize: 13, paddingHorizontal: 16, paddingVertical: 10 },
  list: { paddingBottom: 20 },
  card: { flexDirection: 'row', padding: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', gap: 12 },
  cardImage: { width: 90, height: 75, borderRadius: 8 },
  cardImagePlaceholder: { backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, justifyContent: 'center' },
  cardCat: { fontSize: 10, color: '#E91E8C', fontWeight: '700', marginBottom: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#111', lineHeight: 19 },
  cardMeta: { fontSize: 11, color: '#999', marginTop: 3 },
  cardExcerpt: { fontSize: 12, color: '#666', marginTop: 4, lineHeight: 17 },
});
