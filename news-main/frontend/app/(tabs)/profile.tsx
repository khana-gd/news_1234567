/**
 * Profile Tab — Reporter Profile Editor
 * Saves Display Name, Location to Cloudflare D1
 * Profile picture stored locally
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, ScrollView, StatusBar,
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguage } from '../../context/LanguageContext';
import { showToast } from '../../components/Toast';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const REPORTER_UNLOCK_KEY = 'reporter_unlocked_v1';
const PROFILE_ID_KEY = 'cf_profile_id';
const PROFILE_CACHE_KEY = 'cf_profile_cache';

function generateId(): string {
  return 'profile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

export default function ProfileScreen() {
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const isKn = language === 'kn';

  const [profileId, setProfileId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [location, setLocation] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [picUri, setPicUri] = useState<string | null>(null);
  const [isReporter, setIsReporter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      let id = await AsyncStorage.getItem(PROFILE_ID_KEY);
      if (!id) {
        id = generateId();
        await AsyncStorage.setItem(PROFILE_ID_KEY, id);
      }
      setProfileId(id);

      // Load local cache first (fast)
      const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        const c = JSON.parse(cached);
        setDisplayName(c.display_name || '');
        setLocation(c.location || '');
        setPicUri(c.pic_uri || null);
      }

      // Load reporter name from settings
      const rName = await AsyncStorage.getItem('reporter_name');
      if (rName) setReporterName(rName);

      const isUnlocked = await AsyncStorage.getItem(REPORTER_UNLOCK_KEY);
      setIsReporter(isUnlocked === 'true');

      // Sync from D1 in background
      try {
        const resp = await fetch(`${BACKEND_URL}/api/cf/profile/${id}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.display_name && data.display_name !== 'Reporter') {
            setDisplayName(data.display_name);
          }
          if (data.location) setLocation(data.location);
        }
      } catch {}
    } catch (e) {
      console.error('Profile load error:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadProfile(); }, []);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast(isKn ? 'ಫೋಟೋ ಪ್ರವೇಶ ಅಗತ್ಯ' : 'Photo library access needed', 'warning');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (!result.canceled && result.assets[0]) {
      setPicUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      showToast(isKn ? 'ಹೆಸರು ಅಗತ್ಯ' : 'Display name is required', 'warning');
      return;
    }
    setSaving(true);
    try {
      // Save to D1
      await fetch(`${BACKEND_URL}/api/cf/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: profileId,
          display_name: displayName.trim(),
          location: location.trim(),
          profile_pic_url: '',
          is_reporter: isReporter ? 1 : 0,
        }),
      });

      // Cache locally
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
        display_name: displayName.trim(),
        location: location.trim(),
        pic_uri: picUri,
      }));

      // Also save reporter name if changed
      if (reporterName.trim()) {
        await AsyncStorage.setItem('reporter_name', reporterName.trim());
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      showToast(isKn ? 'ಸಂರಕ್ಷಿಸಲು ವಿಫಲ' : `Save failed: ${e?.message}`, 'error');
    }
    setSaving(false);
  };

  const initials = (displayName || 'R').charAt(0).toUpperCase();
  const avatarColors = ['#E91E63', '#9C27B0', '#3F51B5', '#009688', '#FF5722'];
  const avatarColor = avatarColors[initials.charCodeAt(0) % avatarColors.length];

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1AAA94" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#E6F7F3', '#EDE7F6', '#FCE4EC']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="person-circle" size={26} color="#1AAA94" />
          <Text style={styles.headerTitle}>
            {isKn ? 'ಪ್ರೊಫೈಲ್' : 'Profile'}
          </Text>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Avatar ──────────────────────────────── */}
            <View style={styles.avatarSection}>
              <TouchableOpacity onPress={pickPhoto} activeOpacity={0.85} style={styles.avatarWrap}>
                {picUri ? (
                  <Image source={{ uri: picUri }} style={styles.avatarImg} />
                ) : (
                  <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                )}
                <View style={styles.avatarEditBadge}>
                  <MaterialIcons name="camera-alt" size={14} color="#fff" />
                </View>
              </TouchableOpacity>
              <Text style={styles.avatarName}>
                {displayName || (isKn ? 'ನಿಮ್ಮ ಹೆಸರು' : 'Your Name')}
              </Text>
              {isReporter && (
                <View style={styles.reporterBadge}>
                  <MaterialIcons name="verified" size={14} color="#1AAA94" />
                  <Text style={styles.reporterBadgeTxt}>
                    {isKn ? 'ವರದಿಗಾರ' : 'Reporter'}
                  </Text>
                </View>
              )}
            </View>

            {/* ── Form ────────────────────────────────── */}
            <View style={styles.formCard}>
              <Text style={styles.sectionTitle}>
                {isKn ? 'ಪ್ರೊಫೈಲ್ ಮಾಹಿತಿ' : 'Profile Info'}
              </Text>

              <View style={styles.fieldWrap}>
                <Text style={styles.label}>
                  {isKn ? 'ಪ್ರದರ್ಶನ ಹೆಸರು *' : 'Display Name *'}
                </Text>
                <View style={styles.inputRow}>
                  <MaterialIcons name="person" size={18} color="#1AAA94" />
                  <TextInput
                    style={styles.input}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder={isKn ? 'ಹೆಸರು ನಮೂದಿಸಿ...' : 'Enter your name...'}
                    placeholderTextColor="#bbb"
                    maxLength={50}
                    returnKeyType="next"
                  />
                </View>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.label}>
                  {isKn ? 'ಸ್ಥಳ' : 'Location'}
                </Text>
                <View style={styles.inputRow}>
                  <MaterialIcons name="location-on" size={18} color="#1AAA94" />
                  <TextInput
                    style={styles.input}
                    value={location}
                    onChangeText={setLocation}
                    placeholder={isKn ? 'ನಗರ / ಜಿಲ್ಲೆ...' : 'City / District...'}
                    placeholderTextColor="#bbb"
                    maxLength={80}
                    returnKeyType="next"
                  />
                </View>
              </View>

              {/* Reporter Name — only for unlocked reporters */}
              {isReporter && (
                <View style={styles.fieldWrap}>
                  <Text style={styles.label}>
                    {isKn ? 'ವರದಿಗಾರ ಹೆಸರು (ವಿಡಿಯೋಗಾಗಿ)' : 'Reporter Name (for videos)'}
                  </Text>
                  <View style={styles.inputRow}>
                    <MaterialIcons name="videocam" size={18} color="#E91E63" />
                    <TextInput
                      style={styles.input}
                      value={reporterName}
                      onChangeText={setReporterName}
                      placeholder={isKn ? 'ವಿಡಿಯೋದಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತದೆ' : 'Shown on uploaded videos'}
                      placeholderTextColor="#bbb"
                      maxLength={50}
                      returnKeyType="done"
                    />
                  </View>
                  <Text style={styles.hint}>
                    {isKn
                      ? 'ಇದು Cloudflare ವಿಡಿಯೋ ಓವರ್ಲೇಯಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತದೆ'
                      : 'This name appears on video overlays in the feed'}
                  </Text>
                </View>
              )}
            </View>

            {/* ── Cloud Sync Info ──────────────────────── */}
            <View style={styles.infoCard}>
              <MaterialIcons name="cloud" size={18} color="#1AAA94" />
              <Text style={styles.infoTxt}>
                {isKn
                  ? 'ಪ್ರೊಫೈಲ್ Cloudflare D1 ನಲ್ಲಿ ಸಂರಕ್ಷಿಸಲಾಗಿದೆ'
                  : 'Profile synced with Cloudflare D1 database'}
              </Text>
            </View>

            {/* ── Save Button ──────────────────────────── */}
            {saved ? (
              <View style={styles.savedBanner}>
                <MaterialIcons name="check-circle" size={20} color="#4CAF50" />
                <Text style={styles.savedTxt}>
                  {isKn ? '✅ ಸಂರಕ್ಷಿಸಲಾಗಿದೆ!' : '✅ Profile saved!'}
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialIcons name="save" size={20} color="#fff" />
                )}
                <Text style={styles.saveBtnTxt}>
                  {saving
                    ? (isKn ? 'ಸಂರಕ್ಷಿಸಲಾಗುತ್ತಿದೆ...' : 'Saving...')
                    : (isKn ? 'ಪ್ರೊಫೈಲ್ ಸಂರಕ್ಷಿಸಿ' : 'Save Profile')}
                </Text>
              </TouchableOpacity>
            )}

            {/* ── Profile ID (for debugging) */}
            <Text style={styles.pidTxt} numberOfLines={1}>
              ID: {profileId.slice(0, 24)}...
            </Text>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#1AAA94' },
  scroll: { padding: 16, paddingBottom: 80, gap: 16 },

  avatarSection: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  avatarWrap: { position: 'relative' },
  avatarImg: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: '#fff',
  },
  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    elevation: 3,
  },
  avatarInitials: { color: '#fff', fontSize: 36, fontWeight: '900' },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1AAA94',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarName: { fontSize: 18, fontWeight: '800', color: '#111' },
  reporterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E6F7F3',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reporterBadgeTxt: { color: '#1AAA94', fontSize: 12, fontWeight: '700' },

  formCard: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 18,
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    elevation: 1,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#111', marginBottom: 4 },
  fieldWrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: '#555', letterSpacing: 0.5 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8f9ff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: '#E3E8F0',
  },
  input: { flex: 1, fontSize: 15, color: '#111', paddingVertical: 10 },
  hint: { fontSize: 11, color: '#888', lineHeight: 15, marginTop: 2 },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(227,242,253,0.8)',
    borderRadius: 12,
    padding: 12,
  },
  infoTxt: { flex: 1, fontSize: 12, color: '#1AAA94', lineHeight: 17 },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1AAA94',
    borderRadius: 16,
    paddingVertical: 16,
    elevation: 3,
    shadowColor: '#1AAA94',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  saveBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },

  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(76,175,80,0.1)',
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.3)',
  },
  savedTxt: { color: '#388E3C', fontWeight: '700', fontSize: 15 },

  pidTxt: {
    textAlign: 'center',
    fontSize: 10,
    color: 'rgba(0,0,0,0.25)',
    marginTop: 4,
  },
});
