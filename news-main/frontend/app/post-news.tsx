import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://public-samachar-api.onrender.com';

const CATEGORIES = [
  'ರಾಜ್ಯ (State)',
  'ಜಿಲ್ಲಾ ಸುದ್ದಿ (District News)',
  'ರಾಜಕೀಯ (Politics)',
  'ಅಪರಾಧ (Crime)',
  'ಕೃಷಿ (Agriculture)',
  'ಕ್ರೀಡೆ (Sports)',
  'ಮನರಂಜನೆ (Cinema)',
  'ವಿಶೇಷ (Special)',
];

export default function PostNewsScreen() {
  const router = useRouter();

  const [reporterName, setReporterName]     = useState('');
  const [reporterUsername, setUsername]     = useState('');
  const [district, setDistrict]             = useState('Karnataka');
  const [jwtToken, setJwtToken]             = useState<string | null>(null);

  const [title, setTitle]                   = useState('');
  const [content, setContent]               = useState('');
  const [category, setCategory]             = useState(CATEGORIES[0]);
  const [selectedImage, setSelectedImage]   = useState<{ uri: string; base64?: string; filename?: string } | null>(null);

  const [loading, setLoading]               = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Load reporter profile and credentials on mount
  useEffect(() => {
    (async () => {
      try {
        const token    = await AsyncStorage.getItem('reporter_jwt_token');
        const name     = await AsyncStorage.getItem('reporter_name');
        const user     = await AsyncStorage.getItem('reporter_username');
        const dist     = await AsyncStorage.getItem('reporter_district');

        if (token) setJwtToken(token);
        if (name) setReporterName(name);
        if (user) setUsername(user);
        if (dist) setDistrict(dist);
      } catch {}
      setInitialLoading(false);
    })();
  }, []);

  // Pick cover photo for the article
  const handlePickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Please grant photo library access to attach a photo.');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
      base64: true,
    });

    if (!res.canceled && res.assets.length > 0) {
      const asset = res.assets[0];
      const filename = asset.uri.split('/').pop() || `news_${Date.now()}.jpg`;
      const ext = filename.split('.').pop()?.toLowerCase();

      if (ext && !['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        Alert.alert('ಅಮಾನ್ಯ ಚಿತ್ರ', 'ದಯವಿಟ್ಟು JPG, PNG ಅಥವಾ WEBP ಚಿತ್ರವನ್ನು ಮಾತ್ರ ಆಯ್ಕೆಮಾಡಿ (Only JPG, PNG or WEBP allowed).');
        return;
      }

      if (asset.fileSize && asset.fileSize > 12 * 1024 * 1024) {
        Alert.alert('ಚಿತ್ರದ ಗಾತ್ರ ಅಧಿಕವಾಗಿದೆ', 'ಚಿತ್ರದ ಗಾತ್ರ 12MB ಗಿಂತ ಕಡಿಮೆಯಿರಬೇಕು (Image must be under 12MB).');
        return;
      }

      setSelectedImage({
        uri: asset.uri,
        base64: asset.base64 || undefined,
        filename,
      });
    }
  };

  const handleSubmit = useCallback(async () => {
    const cleanTitle = title.trim();
    const cleanContent = content.trim();

    if (!cleanTitle) {
      Alert.alert('ಅಗತ್ಯ ಮಾಹಿತಿ', 'ದಯವಿಟ್ಟು ಸುದ್ದಿಯ ಶೀರ್ಷಿಕೆಯನ್ನು ನಮೂದಿಸಿ (Please enter headline)');
      return;
    }
    if (!cleanContent) {
      Alert.alert('ಅಗತ್ಯ ಮಾಹಿತಿ', 'ದಯವಿಟ್ಟು ಸುದ್ದಿಯ ಪೂರ್ಣ ವಿವರವನ್ನು ನಮೂದಿಸಿ (Please enter news content)');
      return;
    }

    setLoading(true);

    try {
      const payload: Record<string, any> = {
        title: cleanTitle,
        content: `[ಜಿಲ್ಲೆ: ${district}]\n[ವರದಿಗಾರ: ${reporterName || 'ಡೆಸ್ಕ್'}]\n\n${cleanContent}`,
        reporter_name: reporterName || 'ಡೆಸ್ಕ್',
        district: district,
        category: category,
      };

      if (selectedImage?.base64) {
        payload.image_base64 = selectedImage.base64;
        payload.image_filename = selectedImage.filename || 'news_image.jpg';
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (jwtToken) {
        headers['Authorization'] = `Bearer ${jwtToken}`;
      }

      let submitted = false;
      let respData: any = null;

      // 1. Try Backend submit-post endpoint
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(`${BACKEND_URL}/api/submit-post`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          respData = await res.json().catch(() => ({}));
          submitted = !!respData.success;
        }
      } catch (beErr) {
        console.warn('Backend submit notice, trying WP direct endpoint:', beErr);
      }

      // 2. Direct fallback to WordPress /wp-json/mps/v1/submit-news
      if (!submitted) {
        try {
          const wpRes = await fetch('https://mypublicsamachar.com/wp-json/mps/v1/submit-news', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              title: cleanTitle,
              content: payload.content,
              category: category,
              district: district,
              reporter_name: reporterName,
            }),
          });
          if (wpRes.ok) {
            respData = await wpRes.json().catch(() => ({}));
            submitted = true;
          }
        } catch (wpErr) {
          console.warn('WP submit notice:', wpErr);
        }
      }

      if (submitted) {
        Alert.alert(
          'ಯಶಸ್ವಿ!',
          'ನಿಮ್ಮ ಸುದ್ದಿಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ಕಳುಹಿಸಲಾಗಿದೆ. ಪರಿಶೀಲನೆಯ ನಂತರ ಪ್ರಕಟವಾಗಲಿದೆ.',
          [{ text: 'ಸರಿ (OK)', onPress: () => router.back() }]
        );
      } else {
        const err = respData?.detail || respData?.message || 'ಸುದ್ದಿ ಕಳುಹಿಸಲು ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಪ್ರಯತ್ನಿಸಿ.';
        Alert.alert('ದೋಷ', err);
      }
    } catch {
      Alert.alert('ದೋಷ', 'ಸರ್ವರ್ ಸಂಪರ್ಕ ವಿಫಲವಾಗಿದೆ. ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ.');
    } finally {
      setLoading(false);
    }
  }, [title, content, district, reporterName, category, selectedImage, jwtToken, router]);

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.centerRoot}>
        <ActivityIndicator size="large" color="#1AAA94" />
      </SafeAreaView>
    );
  }

  // If not logged in as a reporter, prompt to login
  if (!jwtToken) {
    return (
      <SafeAreaView style={styles.centerRoot}>
        <Stack.Screen options={{ headerShown: false }} />
        <MaterialIcons name="lock-outline" size={64} color="#1AAA94" />
        <Text style={styles.authTitle}>ವರದಿಗಾರರ ಲಾಗಿನ್ ಅಗತ್ಯವಿದೆ</Text>
        <Text style={styles.authSub}>ಸುದ್ದಿ ಪ್ರಕಟಿಸಲು ನಿಮ್ಮ ಅಧಿಕೃತ ವರದಿಗಾರ ಖಾತೆಗೆ ಲಾಗಿನ್ ಮಾಡಿ.</Text>
        <TouchableOpacity
          style={styles.loginBtn}
          onPress={() => router.push('/reporter-login' as any)}
        >
          <MaterialIcons name="login" size={20} color="#fff" />
          <Text style={styles.loginBtnText}>ವರದಿಗಾರರ ಲಾಗಿನ್ (Reporter Login)</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>ಸುದ್ದಿ ಕಳುಹಿಸಿ (Post News)</Text>
          <Text style={styles.headerSub}>Public Samachar Reporter Desk</Text>
        </View>
        <TouchableOpacity
          style={[styles.submitTopBtn, loading && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitTopText}>ಪ್ರಕಟಿಸಿ</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Reporter Byline Badge */}
          <View style={styles.reporterBadge}>
            <View style={styles.badgeLeft}>
              <MaterialIcons name="verified" size={20} color="#1AAA94" />
              <View>
                <Text style={styles.badgeName}>{reporterName || 'ವಿಶೇಷ ವರದಿಗಾರ'}</Text>
                <Text style={styles.badgeUsername}>@{reporterUsername || 'reporter'} • {district}</Text>
              </View>
            </View>
            <View style={styles.verifiedTag}>
              <Text style={styles.verifiedText}>ಅಧಿಕೃತ ವರದಿಗಾರ</Text>
            </View>
          </View>

          {/* Headline Input */}
          <Text style={styles.inputLabel}>ಸುದ್ದಿ ಶೀರ್ಷಿಕೆ (Headline) *</Text>
          <TextInput
            testID="post-news-title"
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="ಮುಖ್ಯ ಸುದ್ದಿ ಶೀರ್ಷಿಕೆ ನಮೂದಿಸಿ..."
            placeholderTextColor="#888"
            multiline
          />

          {/* District / Location */}
          <Text style={styles.inputLabel}>ಜಿಲ್ಲೆ / ಸ್ಥಳ (District / Location) *</Text>
          <View style={styles.inputRow}>
            <MaterialIcons name="location-on" size={18} color="#1AAA94" />
            <TextInput
              testID="post-news-district"
              style={styles.fieldInput}
              value={district}
              onChangeText={setDistrict}
              placeholder="e.g. Hubballi, Dharwad, Belagavi..."
              placeholderTextColor="#888"
            />
          </View>

          {/* Category Chips */}
          <Text style={styles.inputLabel}>ವರ್ಗ (Category)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
            {CATEGORIES.map((cat, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.catChip, category === cat && styles.catChipActive]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[styles.catText, category === cat && styles.catTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Photo attachment */}
          <Text style={styles.inputLabel}>ಭಾವಚಿತ್ರ / ಫೋಟೋ (Photo / Cover Image)</Text>
          {selectedImage ? (
            <View style={styles.imagePreviewWrap}>
              <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} />
              <TouchableOpacity
                style={styles.removeImageBtn}
                onPress={() => setSelectedImage(null)}
              >
                <MaterialIcons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage}>
              <MaterialIcons name="add-photo-alternate" size={28} color="#1AAA94" />
              <Text style={styles.attachText}>ಫೋಟೋ ಸೇರಿಸಿ (Attach Photo)</Text>
            </TouchableOpacity>
          )}

          {/* News Content Input */}
          <Text style={styles.inputLabel}>ಸುದ್ದಿ ಪೂರ್ಣ ವಿವರ (Story Content) *</Text>
          <TextInput
            testID="post-news-content"
            style={styles.contentInput}
            value={content}
            onChangeText={setContent}
            placeholder="ಸುದ್ದಿಯ ಸಂಪೂರ್ಣ ವಿವರಗಳನ್ನು ಇಲ್ಲಿ ಬರೆಯಿರಿ..."
            placeholderTextColor="#888"
            multiline
            textAlignVertical="top"
          />

          {/* Bottom Submit Button */}
          <TouchableOpacity
            testID="post-news-submit-btn"
            style={[styles.bottomSubmitBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name="send" size={20} color="#fff" />
                <Text style={styles.bottomSubmitText}>ಸುದ್ದಿ ಕಳುಹಿಸಿ (Submit News)</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  centerRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  scroll: { padding: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  headerSub: { fontSize: 11, color: '#666' },
  submitTopBtn: { backgroundColor: '#1AAA94', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  submitTopText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  reporterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  badgeLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badgeName: { fontSize: 14, fontWeight: '800', color: '#1B5E20' },
  badgeUsername: { fontSize: 11, color: '#2E7D32' },
  verifiedTag: { backgroundColor: '#1B5E20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  verifiedText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  inputLabel: { fontSize: 13, fontWeight: '700', color: '#333', marginTop: 14, marginBottom: 6 },
  titleInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    lineHeight: 22,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  fieldInput: { flex: 1, fontSize: 14, color: '#111' },

  catScroll: { flexDirection: 'row', marginBottom: 4 },
  catChip: { backgroundColor: '#eee', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, marginRight: 8 },
  catChipActive: { backgroundColor: '#1AAA94' },
  catText: { fontSize: 12, color: '#555', fontWeight: '600' },
  catTextActive: { color: '#fff', fontWeight: '700' },

  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#1AAA94',
    borderRadius: 12,
    paddingVertical: 18,
  },
  attachText: { fontSize: 13, fontWeight: '700', color: '#1AAA94' },
  imagePreviewWrap: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
  imagePreview: { width: '100%', height: 200, borderRadius: 12 },
  removeImageBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  contentInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#111',
    minHeight: 180,
    lineHeight: 22,
  },

  bottomSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1AAA94',
    borderRadius: 12,
    paddingVertical: 15,
    marginTop: 24,
  },
  bottomSubmitText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  authTitle: { fontSize: 18, fontWeight: '800', color: '#111', marginTop: 16 },
  authSub: { fontSize: 13, color: '#666', textAlign: 'center', marginTop: 6, marginBottom: 20 },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1AAA94',
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 24,
  },
  loginBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
