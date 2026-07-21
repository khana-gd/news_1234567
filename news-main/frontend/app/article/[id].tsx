import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  ScrollView, ActivityIndicator, Modal, StatusBar,
  Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Post, formatDate } from '../../utils/api';
import { useLanguage } from '../../context/LanguageContext';
import SocialInteractionBar from '../../components/SocialInteractionBar';

const WHATSAPP_NUMBER = '919591484307';

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showFullArticle, setShowFullArticle] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [showTranslate, setShowTranslate] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getPost(Number(id))
      .then(data => { setPost(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [id]);

  // Load follow state for this article's author
  useEffect(() => {
    if (!post?.author) return;
    AsyncStorage.getItem('followed_reporters').then(val => {
      const followed: string[] = val ? JSON.parse(val) : [];
      setIsFollowing(followed.includes(post.author));
    }).catch(() => {});
  }, [post?.author]);

  const toggleFollow = async () => {
    if (!post?.author) return;
    const val = await AsyncStorage.getItem('followed_reporters').catch(() => null);
    const followed: string[] = val ? JSON.parse(val) : [];
    let updated: string[];
    if (followed.includes(post.author)) {
      updated = followed.filter(r => r !== post.author);
      setIsFollowing(false);
    } else {
      updated = [...followed, post.author];
      setIsFollowing(true);
    }
    await AsyncStorage.setItem('followed_reporters', JSON.stringify(updated));
    Alert.alert(
      '',
      updated.includes(post.author)
        ? (language === 'kn' ? `${post.author} \u0c85\u0ca8\u0cc1\u0cb8\u0cb0\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6!` : `Following ${post.author}!`)
        : (language === 'kn' ? `${post.author} \u0c85\u0ca8\u0cc1\u0cb8\u0cb0\u0ca3\u0cc6 \u0cb0\u0ca6\u0ccd\u0ca6\u0cc1` : `Unfollowed ${post.author}`)
    );
  };

  const reportReasons = [t('inappropriate'), t('spam'), t('fake'), t('other')];
  const reasonKeys = ['inappropriate', 'spam', 'fake', 'other'];

  const handleReport = async (reason: string) => {
    if (!post) return;
    const reasonLabel = reportReasons[reasonKeys.indexOf(reason)] || reason;
    const message = `Hello Public Samachar, I would like to report this article:\n\nTitle: ${post.title}\nReason: ${reasonLabel}\nLink: ${post.link}`;
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    setShowReport(false);
    setReportReason('');
    try {
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        Alert.alert(
          'WhatsApp not found',
          'Please install WhatsApp to report this article, or contact us at mypublicsamachar.com'
        );
      }
    } catch {
      Alert.alert('Error', 'Could not open WhatsApp. Please try again.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.headerBar}>
          <TouchableOpacity testID="back-btn" onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator testID="article-loading" size="large" color="#1AAA94" />
          <Text style={styles.loadingText}>{t('loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !post) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.headerBar}>
          <TouchableOpacity testID="back-btn" onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <MaterialIcons name="error-outline" size={50} color="#E0E0E0" />
          <Text style={styles.errorText}>{t('error')}</Text>
          <TouchableOpacity testID="retry-btn" style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryText}>{t('tryAgain')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar backgroundColor="#fff" barStyle="dark-content" />

      {/* Top Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity testID="back-btn" style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity testID="report-btn-header" style={styles.headerActionBtn}
            onPress={() => setShowReport(true)}>
            <MaterialIcons name="flag" size={22} color="#666" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView testID="article-scroll" showsVerticalScrollIndicator={false}>
        {/* Featured Image */}
        {post.featured_image && (
          <Image
            testID="article-featured-image"
            source={{ uri: post.featured_image }}
            style={styles.featuredImage}
            resizeMode="cover"
          />
        )}

        <View style={styles.articleBody}>
          {/* Category badge */}
          {post.category_names?.[0] && (
            <View style={styles.catBadge}>
              <Text style={styles.catBadgeText}>{post.category_names[0].name}</Text>
            </View>
          )}

          {/* Title */}
          <Text testID="article-title" style={styles.title}>{post.title}</Text>

          {/* Meta */}
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <MaterialIcons name="person-outline" size={14} color="#999" />
              <Text style={styles.metaText}>{post.author}</Text>
            </View>
            <TouchableOpacity
              testID="follow-reporter-btn"
              style={[styles.followBtn, isFollowing && styles.followBtnActive]}
              onPress={toggleFollow}
            >
              <MaterialIcons
                name={isFollowing ? 'person' : 'person-add'}
                size={13}
                color={isFollowing ? '#fff' : '#1AAA94'}
              />
              <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                {isFollowing
                  ? (language === 'kn' ? 'ಅನುಸರಿಸಲಾಗಿದೆ' : 'Following')
                  : (language === 'kn' ? 'ಅನುಸರಿಸಿ' : 'Follow')}
              </Text>
            </TouchableOpacity>
            <View style={styles.metaDot} />
            <View style={styles.metaItem}>
              <MaterialIcons name="access-time" size={14} color="#999" />
              <Text style={styles.metaText}>{formatDate(post.date)}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Excerpt / Content */}
          <Text testID="article-excerpt" style={styles.excerpt}>
            {post.excerpt || (post.content ? post.content.replace(/<[^>]+>/g, '').substring(0, 500) : '')}
          </Text>

          {/* Read Full Article Button */}
          {post.link && (
            <TouchableOpacity
              testID="read-full-btn"
              style={styles.readFullBtn}
              onPress={() => setShowFullArticle(true)}
            >
              <MaterialIcons name="open-in-browser" size={18} color="#fff" />
              <Text style={styles.readFullText}>{t('readFull')}</Text>
            </TouchableOpacity>
          )}

          {/* Translate to Kannada */}
          {post.link && (
            <TouchableOpacity
              testID="translate-btn"
              style={styles.translateBtn}
              onPress={() => setShowTranslate(true)}
              activeOpacity={0.85}
            >
              <MaterialIcons name="translate" size={18} color="#388E3C" />
              <Text style={styles.translateBtnText}>
                {language === 'kn' ? 'ಕನ್ನಡಕ್ಕೆ ಅನುವಾದಿಸಿ' : 'Translate to Kannada'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Report Post Section */}
          <View style={styles.reportSection}>
            <View style={styles.reportDivider} />
            <Text style={styles.reportLabel}>
              {language === 'kn' ? 'ಈ ಸುದ್ದಿಯ ಬಗ್ಗೆ ಸಮಸ್ಯೆ ಇದೆಯೇ?' : 'Problem with this article?'}
            </Text>
            <TouchableOpacity
              testID="report-post-btn"
              style={styles.reportBtn}
              onPress={() => setShowReport(true)}
            >
              <MaterialIcons name="flag" size={16} color="#D32F2F" />
              <Text style={styles.reportBtnText}>{t('reportPost')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* ── Sticky Social Interaction Bar ────────────────────────── */}
      {post && (
        <SocialInteractionBar
          postId={post.id}
          title={post.title}
          url={post.link}
          isLiked={isLiked}
          onLike={() => setIsLiked(v => !v)}
          showDivider
        />
      )}

      {/* Translate to Kannada WebView Modal */}
      <Modal
        visible={showTranslate}
        animationType="slide"
        onRequestClose={() => setShowTranslate(false)}
      >
        <SafeAreaView style={styles.wvSafe}>
          <View style={styles.wvHeader}>
            <TouchableOpacity testID="close-translate" onPress={() => setShowTranslate(false)}>
              <MaterialIcons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.wvTitle}>
              {language === 'kn' ? 'ಕನ್ನಡ ಅನುವಾದ' : 'Translate to Kannada'}
            </Text>
            <MaterialIcons name="translate" size={22} color="#388E3C" />
          </View>
          <WebView
            testID="translate-webview"
            source={{
              uri: `https://translate.google.com/translate?sl=en&tl=kn&u=${encodeURIComponent(post.link)}`,
            }}
            style={{ flex: 1 }}
          />
        </SafeAreaView>
      </Modal>

      {/* Full Article WebView Modal */}
      <Modal
        visible={showFullArticle}
        animationType="slide"
        onRequestClose={() => setShowFullArticle(false)}
      >
        <SafeAreaView style={styles.wvSafe}>
          <View style={styles.wvHeader}>
            <TouchableOpacity testID="close-full-article" onPress={() => setShowFullArticle(false)}>
              <MaterialIcons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.wvTitle} numberOfLines={1}>{post.title}</Text>
            <View style={{ width: 36 }} />
          </View>
          <WebView
            testID="full-article-webview"
            source={{ uri: post.link }}
            style={{ flex: 1 }}
          />
        </SafeAreaView>
      </Modal>

      {/* Report Modal */}
      <Modal
        visible={showReport}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReport(false)}
      >
        <View style={styles.reportOverlay}>
          <View style={styles.reportModal}>
            <View style={styles.reportHandle} />
            <Text style={styles.reportTitle}>{t('reportPost')}</Text>
            <Text style={styles.reportSubtitle}>{t('reportReason')}</Text>

            {reportReasons.map((reason, i) => (
              <TouchableOpacity
                key={i}
                testID={`report-reason-${reasonKeys[i]}`}
                style={[styles.reportOption, reportReason === reasonKeys[i] && styles.reportOptionActive]}
                onPress={() => setReportReason(reasonKeys[i])}
              >
                <View style={[styles.reportRadio, reportReason === reasonKeys[i] && styles.reportRadioActive]} />
                <Text style={[styles.reportOptionText, reportReason === reasonKeys[i] && styles.reportOptionTextActive]}>
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            <View style={styles.reportActions}>
              <TouchableOpacity
                testID="report-cancel-btn"
                style={styles.cancelBtn}
                onPress={() => { setShowReport(false); setReportReason(''); }}
              >
                <Text style={styles.cancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="report-submit-btn"
                style={[styles.submitReportBtn, !reportReason && styles.submitReportBtnDisabled]}
                onPress={() => reportReason && handleReport(reportReason)}
                disabled={!reportReason}
              >
                <Text style={styles.submitReportText}>{t('submit')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: '#999', fontSize: 14 },
  errorText: { color: '#999', fontSize: 15 },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#1AAA94', borderRadius: 20 },
  retryText: { color: '#fff', fontWeight: '700' },

  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerActionBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  featuredImage: { width: '100%', height: 240 },
  articleBody: { padding: 16, paddingBottom: 30 },

  catBadge: { alignSelf: 'flex-start', backgroundColor: '#E91E8C', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, marginBottom: 10 },
  catBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  title: { fontSize: 22, fontWeight: '900', color: '#111', lineHeight: 30, marginBottom: 12 },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 12, color: '#999' },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ccc' },

  divider: { height: 1, backgroundColor: '#F0F0F0', marginBottom: 16 },

  excerpt: { fontSize: 15, color: '#333', lineHeight: 24, marginBottom: 20 },

  readFullBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1AAA94', borderRadius: 12, paddingVertical: 13, marginBottom: 10 },
  readFullText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  translateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#E8F5E9', borderRadius: 12, paddingVertical: 12, marginBottom: 24, borderWidth: 1, borderColor: '#C8E6C9' },
  translateBtnText: { color: '#388E3C', fontWeight: '700', fontSize: 14 },

  followBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, borderWidth: 1, borderColor: '#1AAA94', backgroundColor: '#fff' },
  followBtnActive: { backgroundColor: '#1AAA94' },
  followBtnText: { fontSize: 12, fontWeight: '700', color: '#1AAA94' },
  followBtnTextActive: { color: '#fff' },

  reportSection: { marginTop: 8 },
  reportDivider: { height: 1, backgroundColor: '#F0F0F0', marginBottom: 16 },
  reportLabel: { fontSize: 12, color: '#999', marginBottom: 8 },
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#FFCDD2', borderRadius: 8, alignSelf: 'flex-start' },
  reportBtnText: { color: '#D32F2F', fontSize: 13, fontWeight: '600' },

  wvSafe: { flex: 1, backgroundColor: '#fff' },
  wvHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  wvTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111', textAlign: 'center', marginHorizontal: 8 },

  reportOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  reportModal: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  reportHandle: { width: 40, height: 4, backgroundColor: '#ddd', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  reportTitle: { fontSize: 17, fontWeight: '800', color: '#111', marginBottom: 6 },
  reportSubtitle: { fontSize: 13, color: '#666', marginBottom: 16 },

  reportOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  reportOptionActive: { backgroundColor: '#FFF3F3' },
  reportRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ccc' },
  reportRadioActive: { borderColor: '#D32F2F', backgroundColor: '#D32F2F' },
  reportOptionText: { fontSize: 15, color: '#333' },
  reportOptionTextActive: { color: '#D32F2F', fontWeight: '600' },

  reportActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#666' },
  submitReportBtn: { flex: 1, backgroundColor: '#D32F2F', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  submitReportBtnDisabled: { backgroundColor: '#FFCDD2' },
  submitReportText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
