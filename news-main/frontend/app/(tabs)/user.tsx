import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, Alert, StatusBar, ScrollView,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import UploadVideoModal from '../../components/UploadVideoModal';
import { useRouter, useFocusEffect } from 'expo-router';

const WP_LOGIN_URL = process.env.EXPO_PUBLIC_WP_LOGIN_URL || 'https://mypublicsamachar.com/user-2/';
const SUBMIT_NEWS_URL = process.env.EXPO_PUBLIC_SUBMIT_NEWS_URL || 'https://mypublicsamachar.com/submit-story/';
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const REPORTER_UNLOCK_KEY = 'reporter_unlocked_v1';
const PRIVACY_POLICY_URL = 'https://mypublicsamachar.com/privacy-policy/';
const TERMS_URL = 'https://mypublicsamachar.com/terms-of-service/';
const DELETE_ACCOUNT_EMAIL = 'publicsamachar75@gmail.com';

export default function UserScreen() {
  const { t, language, setLanguage } = useLanguage();
  const { isLoggedIn, setIsLoggedIn, logout } = useAuth();
  const router = useRouter();

  const [showWebView, setShowWebView] = useState(false);
  const [webViewLoading, setWebViewLoading] = useState(true);
  const [showUploadVideo, setShowUploadVideo] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState('');
  const [videoDesc, setVideoDesc] = useState('');
  const [uploadingVideo, setUploadingVideo] = useState(false);

  // ── Reporter Upload Access ─────────────────────────────────────────────────
  const [isReporterUnlocked, setIsReporterUnlocked] = useState(false);
  const [showReporterUpload, setShowReporterUpload] = useState(false);
  const [reporterName, setReporterNameState] = useState('');
  const [reporterNameSaved, setReporterNameSaved] = useState(false);

  // Refresh reporter state every time this tab is focused (e.g. returning from reporter-login)
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(REPORTER_UNLOCK_KEY)
        .then(v => setIsReporterUnlocked(v === 'true'))
        .catch(() => {});
      AsyncStorage.getItem('reporter_name')
        .then(n => { if (n) setReporterNameState(n); })
        .catch(() => {});
    }, [])
  );

  const saveReporterName = async (name: string) => {
    setReporterNameState(name);
    await AsyncStorage.setItem('reporter_name', name).catch(() => {});
    setReporterNameSaved(true);
    setTimeout(() => setReporterNameSaved(false), 2000);
  };

  const openLegalLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url).catch(() => {});
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      language === 'kn' ? 'ಖಾತೆ ಅಳಿಸಿ' : 'Delete My Account',
      language === 'kn'
        ? `ನಿಮ್ಮ ಖಾತೆ ಮತ್ತು ಸಂಬಂಧಿತ ಡೇಟಾವನ್ನು ಅಳಿಸಲು, ದಯವಿಟ್ಟು ನಿಮ್ಮ ನೋಂದಾಯಿತ ಇಮೇಲ್‌ನಿಂದ ${DELETE_ACCOUNT_EMAIL} ಗೆ ವಿನಂತಿಯನ್ನು ಕಳುಹಿಸಿ. 7 ಕೆಲಸದ ದಿನಗಳಲ್ಲಿ ನಾವು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುತ್ತೇವೆ.`
        : `To delete your account and associated data, please send a request from your registered email to ${DELETE_ACCOUNT_EMAIL}. We will process it within 7 business days.`,
      [
        { text: language === 'kn' ? 'ರದ್ದುಮಾಡಿ' : 'Cancel', style: 'cancel' },
        {
          text: language === 'kn' ? 'ಇಮೇಲ್ ಕಳುಹಿಸಿ' : 'Send Email',
          onPress: () => {
            const subject = encodeURIComponent('Account Deletion Request');
            Linking.openURL(`mailto:${DELETE_ACCOUNT_EMAIL}?subject=${subject}`).catch(() => {});
          },
        },
      ],
    );
  };

  const revokeReporterAccess = () => {
    Alert.alert(
      language === 'kn' ? 'ಪ್ರವೇಶ ರದ್ದು' : 'Revoke Access',
      language === 'kn' ? 'ರಿಪೋರ್ಟರ್ ಅಪ್ಲೋಡ್ ಪ್ರವೇಶ ರದ್ದು ಮಾಡಲೇ?' : 'Remove reporter upload access?',
      [
        { text: language === 'kn' ? 'ರದ್ದು' : 'Cancel', style: 'cancel' },
        {
          text: language === 'kn' ? 'ಹೌದು, ರದ್ದು' : 'Yes, Revoke',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.multiRemove([REPORTER_UNLOCK_KEY, 'reporter_jwt_token']);
            setIsReporterUnlocked(false);
          },
        },
      ]
    );
  };

  const handleNavChange = (navState: any) => {
    const { url } = navState;
    if (!url) return;
    if (
      url.includes('mypublicsamachar.com') &&
      !url.includes('/user-2/') &&
      !url.includes('wp-login.php') &&
      !url.includes('wp-signup.php') &&
      !url.includes('action=register')
    ) {
      setIsLoggedIn(true);
      setTimeout(() => setShowWebView(false), 600);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      t('logout'),
      language === 'kn' ? 'ನೀವು ಖಚಿತವಾಗಿ ಲಾಗ್‌ಔಟ್ ಮಾಡಲು ಬಯಸುವಿರಾ?' : 'Are you sure you want to logout?',
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('logout'), style: 'destructive', onPress: () => logout() },
      ]
    );
  };

  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        language === 'kn' ? 'ಅನುಮತಿ ಅಗತ್ಯ' : 'Permission needed',
        language === 'kn' ? 'ದಯವಿಟ್ಟು ಮೀಡಿಯಾ ಲೈಬ್ರರಿ ಪ್ರವೇಶ ಅನುಮತಿಸಿ.' : 'Please allow media library access.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
    }
  };

  const handleSubmitVideo = async () => {
    if (!videoTitle.trim()) {
      Alert.alert('', language === 'kn' ? 'ಶೀರ್ಷಿಕೆ ಅಗತ್ಯ' : 'Title is required');
      return;
    }
    if (!videoUri) {
      Alert.alert('', language === 'kn' ? 'ದಯವಿಟ್ಟು ಒಂದು ವಿಡಿಯೋ ಆಯ್ಕೆ ಮಾಡಿ' : 'Please pick a video first');
      return;
    }
    setUploadingVideo(true);
    try {
      const formData = new FormData();
      formData.append('title', videoTitle);
      formData.append('description', videoDesc);
      formData.append('video', { uri: videoUri, type: 'video/mp4', name: `video_${Date.now()}.mp4` } as any);
      const resp = await fetch(`${BACKEND_URL}/api/submit-video`, { method: 'POST', body: formData });
      if (resp.ok) {
        Alert.alert('', language === 'kn' ? 'ವಿಡಿಯೋ ಪರಿಶೀಲನೆಗೆ ಸಲ್ಲಿಸಲಾಗಿದೆ!' : 'Video submitted for review!');
        setVideoUri(null); setVideoTitle(''); setVideoDesc('');
        setShowUploadVideo(false);
      } else {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
      }
    } catch (e: any) {
      Alert.alert(
        language === 'kn' ? 'ದೋಷ' : 'Error',
        e.message || (language === 'kn' ? 'ಅಪ್ಲೋಡ್ ವಿಫಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.' : 'Upload failed. Try again.')
      );
    }
    setUploadingVideo(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar backgroundColor="#fff" barStyle="dark-content" />

      {/* Reporter Upload Modal — opened from PS2026-unlocked section */}
      <UploadVideoModal
        visible={showReporterUpload}
        onClose={() => setShowReporterUpload(false)}
        language={language}
      />

      <View style={styles.header}>
        <MaterialIcons name="person" size={26} color="#1AAA94" />
        <Text style={styles.headerTitle}>{t('profile')}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Brand */}
        <View style={styles.brandSection}>
          <View style={styles.brandLogo}>
            <Text style={styles.brandLogoText}>My</Text>
          </View>
          <View>
            <Text style={styles.brandName}>My Public Samachara</Text>
            <Text style={styles.brandTagline}>
              {language === 'kn' ? 'ನಿಮ್ಮ ಸ್ವಂತ ಸುದ್ದಿ ವೇದಿಕೆ' : 'Your own news platform'}
            </Text>
          </View>
        </View>

        {/* Submit News Button - visible to all */}
        <View style={styles.section}>
          <TouchableOpacity
            testID="submit-news-btn"
            style={styles.submitNewsBtn}
            onPress={() => Linking.openURL(SUBMIT_NEWS_URL)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="edit" size={22} color="#fff" />
            <Text style={styles.submitNewsBtnText}>
              {language === 'kn' ? 'ಸುದ್ದಿ ಸಲ್ಲಿಸಿ' : 'Submit News'}
            </Text>
            <MaterialIcons name="open-in-new" size={16} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
          <Text style={styles.submitNewsNote}>
            {language === 'kn'
              ? 'ಸ್ಟೋರಿ ಸಲ್ಲಿಸಲು ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ'
              : 'Tap to submit a story on our website'}
          </Text>
        </View>

        {/* Reporter Access */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {language === 'kn' ? 'ವರದಿಗಾರ ಪ್ರವೇಶ' : 'Reporter Access'}
          </Text>

          {!isLoggedIn ? (
            <TouchableOpacity testID="login-btn" style={styles.loginBtn} onPress={() => setShowWebView(true)}>
              <MaterialIcons name="login" size={20} color="#fff" />
              <Text style={styles.loginBtnText}>{t('login')}</Text>
            </TouchableOpacity>
          ) : (
            <View>
              <View style={styles.loggedInCard}>
                <View style={styles.loggedInRow}>
                  <View style={styles.loggedInIcon}>
                    <MaterialIcons name="verified-user" size={22} color="#388E3C" />
                  </View>
                  <View>
                    <Text style={styles.loggedInTitle}>{t('loggedIn')}</Text>
                    <Text style={styles.loggedInDesc}>
                      {language === 'kn' ? 'ವರದಿಗಾರರಾಗಿ ಲಾಗ್ ಇನ್' : 'Logged in as reporter'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity testID="logout-btn" style={styles.logoutBtn} onPress={handleLogout}>
                  <MaterialIcons name="logout" size={16} color="#D32F2F" />
                  <Text style={styles.logoutBtnText}>{t('logout')}</Text>
                </TouchableOpacity>
              </View>

              {/* Upload Video */}
              <TouchableOpacity testID="upload-video-btn" style={styles.uploadVideoBtn} onPress={() => setShowUploadVideo(true)}>
                <MaterialIcons name="video-call" size={22} color="#fff" />
                <Text style={styles.uploadVideoBtnText}>
                  {language === 'kn' ? 'ವಿಡಿಯೋ ಅಪ್ಲೋಡ್ ಮಾಡಿ' : 'Upload Video'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.infoBox}>
            <MaterialIcons name="info-outline" size={16} color="#1AAA94" />
            <Text style={styles.infoText}>
              {language === 'kn'
                ? 'ಲಾಗಿನ್ ನಂತರ ವಿಡಿಯೋ ಅಪ್ಲೋಡ್ ಮಾಡಬಹುದು'
                : 'Login to upload video content for review'}
            </Text>
          </View>
        </View>

        {/* Reporter Upload Access (PS2026) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {language === 'kn' ? 'ರಿಪೋರ್ಟರ್ ಅಪ್ಲೋಡ್ ಪ್ರವೇಶ' : 'Reporter Upload Access'}
          </Text>
          {isReporterUnlocked ? (
            <View style={styles.reporterUnlockedCard}>
              <View style={styles.reporterUnlockedRow}>
                <View style={styles.reporterUnlockedIcon}>
                  <MaterialIcons name="videocam" size={22} color="#1AAA94" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reporterUnlockedTitle}>
                    {language === 'kn' ? '✅ ಅಪ್ಲೋಡ್ ಮೋಡ್ ಸಕ್ರಿಯ' : '✅ Upload mode active'}
                  </Text>
                  <Text style={styles.reporterUnlockedDesc}>
                    {language === 'kn'
                      ? 'ವಿಡಿಯೋ ನೇರ ವೆಬ್‌ಸೈಟ್‌ಗೆ ಅಪ್ಲೋಡ್ ಮಾಡಿ'
                      : 'Upload videos directly to the website'}
                  </Text>
                </View>
              </View>
              {/* Direct Upload Button */}
              <TouchableOpacity
                style={styles.directUploadBtn}
                onPress={() => setShowReporterUpload(true)}
                activeOpacity={0.85}
              >
                <MaterialIcons name="cloud-upload" size={20} color="#fff" />
                <Text style={styles.directUploadTxt}>
                  {language === 'kn' ? 'ವಿಡಿಯೋ ಅಪ್ಲೋಡ್ ಮಾಡಿ' : 'Upload Video to Website'}
                </Text>
              </TouchableOpacity>

              {/* ── Reporter Name for Video Overlays ── */}
              <View style={{ marginTop: 12, gap: 6 }}>
                <Text style={styles.reporterNameLabel}>
                  {language === 'kn' ? '🎬 ವಿಡಿಯೋ ವರದಿಗಾರ ಹೆಸರು' : '🎬 Reporter Name (on videos)'}
                </Text>
                <View style={styles.reporterNameRow}>
                  <TextInput
                    style={styles.reporterNameInput}
                    value={reporterName}
                    onChangeText={setReporterNameState}
                    placeholder={language === 'kn' ? 'ಹೆಸರು ನಮೂದಿಸಿ...' : 'Your name for video overlays...'}
                    placeholderTextColor="#bbb"
                    maxLength={50}
                    returnKeyType="done"
                    onSubmitEditing={() => saveReporterName(reporterName)}
                  />
                  <TouchableOpacity
                    style={styles.reporterNameSaveBtn}
                    onPress={() => saveReporterName(reporterName)}
                  >
                    <MaterialIcons name={reporterNameSaved ? 'check' : 'save'} size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 11, color: '#888' }}>
                  {language === 'kn'
                    ? 'ಇದು Cloudflare ವಿಡಿಯೋ ಫೀಡ್‌ನಲ್ಲಿ ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತದೆ'
                    : 'Shown as reporter credit on Cloudflare video feed'}
                </Text>
              </View>

              <TouchableOpacity style={styles.revokeBtn} onPress={revokeReporterAccess}>
                <MaterialIcons name="lock" size={14} color="#D32F2F" />
                <Text style={styles.revokeBtnText}>
                  {language === 'kn' ? 'ಪ್ರವೇಶ ರದ್ದು' : 'Revoke Access'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.reporterCodeDesc}>
                {language === 'kn'
                  ? 'ರಿಪೋರ್ಟರ್ ಅಪ್ಲೋಡ್ ಮೋಡ್ ಅನ್‌ಲಾಕ್ ಮಾಡಲು ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಕೋಡ್ ನಮೂದಿಸಿ.'
                  : 'Login with your reporter name and access code to unlock video upload.'}
              </Text>
              <TouchableOpacity
                style={styles.reporterUnlockBtn}
                onPress={() => router.push({
                  pathname: '/reporter-login',
                  params: { returnTo: '/(tabs)/user' },
                } as any)}
                activeOpacity={0.85}
              >
                <MaterialIcons name="login" size={18} color="#fff" />
                <Text style={styles.reporterUnlockBtnText}>
                  {language === 'kn' ? 'ರಿಪೋರ್ಟರ್ ಲಾಗಿನ್' : 'Reporter Login'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Language */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('language')}</Text>
          <View style={styles.langCard}>
            <TouchableOpacity
              testID="lang-english-btn"
              style={[styles.langOption, language === 'en' && styles.langOptionActive]}
              onPress={() => setLanguage('en')}
            >
              <Text style={styles.langFlag}>🇬🇧</Text>
              <Text style={[styles.langText, language === 'en' && styles.langTextActive]}>{t('english')}</Text>
              {language === 'en' && <MaterialIcons name="check-circle" size={18} color="#1AAA94" />}
            </TouchableOpacity>
            <View style={styles.langDivider} />
            <TouchableOpacity
              testID="lang-kannada-btn"
              style={[styles.langOption, language === 'kn' && styles.langOptionActive]}
              onPress={() => setLanguage('kn')}
            >
              <Text style={styles.langFlag}>🇮🇳</Text>
              <Text style={[styles.langText, language === 'kn' && styles.langTextActive]}>{t('kannada')}</Text>
              {language === 'kn' && <MaterialIcons name="check-circle" size={18} color="#1AAA94" />}
            </TouchableOpacity>
          </View>
          <Text style={styles.langNote}>
            {language === 'kn'
              ? '* ಭಾಷೆ ಬದಲಾಯಿಸಿದರೆ ಸುದ್ದಿ ಫಿಲ್ಟರ್ ಆಗುತ್ತದೆ'
              : '* Language change filters news by WordPress category'}
          </Text>
        </View>

        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('about')}</Text>
          <View style={styles.aboutCard}>
            <View style={styles.aboutRow}>
              <MaterialIcons name="info" size={18} color="#666" />
              <Text style={styles.aboutText}>{t('appVersion')}</Text>
            </View>
            <View style={styles.aboutRow}>
              <MaterialIcons name="language" size={18} color="#666" />
              <Text style={styles.aboutText}>mypublicsamachar.com</Text>
            </View>
            <View style={styles.aboutRow}>
              <MaterialIcons name="policy" size={18} color="#666" />
              <Text style={styles.aboutText}>
                {language === 'kn' ? 'ಬಳಕೆದಾರ ವಿಷಯ ನೀತಿ' : 'User Content Policy'}
              </Text>
            </View>
          </View>
        </View>

        {/* Legal & Account */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {language === 'kn' ? 'ಕಾನೂನು ಮತ್ತು ಖಾತೆ' : 'Legal & Account'}
          </Text>
          <View style={styles.aboutCard}>
            <TouchableOpacity
              testID="privacy-policy-btn"
              style={styles.legalRow}
              onPress={() => openLegalLink(PRIVACY_POLICY_URL)}
              activeOpacity={0.7}
            >
              <MaterialIcons name="privacy-tip" size={18} color="#666" />
              <Text style={styles.legalText}>
                {language === 'kn' ? 'ಗೌಪ್ಯತಾ ನೀತಿ' : 'Privacy Policy'}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color="#bbb" />
            </TouchableOpacity>
            <TouchableOpacity
              testID="terms-btn"
              style={styles.legalRow}
              onPress={() => openLegalLink(TERMS_URL)}
              activeOpacity={0.7}
            >
              <MaterialIcons name="description" size={18} color="#666" />
              <Text style={styles.legalText}>
                {language === 'kn' ? 'ಸೇವಾ ನಿಯಮಗಳು' : 'Terms of Service'}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color="#bbb" />
            </TouchableOpacity>
            <TouchableOpacity
              testID="delete-account-btn"
              style={[styles.legalRow, { borderBottomWidth: 0 }]}
              onPress={handleDeleteAccount}
              activeOpacity={0.7}
            >
              <MaterialIcons name="delete-forever" size={18} color="#D32F2F" />
              <Text style={[styles.legalText, { color: '#D32F2F' }]}>
                {language === 'kn' ? 'ನನ್ನ ಖಾತೆ ಅಳಿಸಿ' : 'Delete My Account'}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color="#bbb" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Login WebView Modal */}
      <Modal visible={showWebView} animationType="slide" onRequestClose={() => setShowWebView(false)}>
        <SafeAreaView style={styles.wvSafe}>
          <View style={styles.wvHeader}>
            <TouchableOpacity testID="close-webview-btn" onPress={() => setShowWebView(false)}>
              <MaterialIcons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.wvTitle}>{t('login')}</Text>
            <View style={{ width: 36 }} />
          </View>
          {webViewLoading && <View style={styles.wvLoadingBar} />}
          <WebView
            testID="login-webview"
            source={{ uri: WP_LOGIN_URL }}
            onNavigationStateChange={handleNavChange}
            onLoadStart={() => setWebViewLoading(true)}
            onLoadEnd={() => setWebViewLoading(false)}
            style={{ flex: 1 }}
            userAgent="Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Mobile Safari/537.36"
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
          />
        </SafeAreaView>
      </Modal>

      {/* Upload Video Modal */}
      <Modal visible={showUploadVideo} animationType="slide" onRequestClose={() => setShowUploadVideo(false)}>
        <SafeAreaView style={styles.wvSafe}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={styles.wvHeader}>
              <TouchableOpacity testID="close-upload-video" onPress={() => setShowUploadVideo(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.wvTitle}>
                {language === 'kn' ? 'ವಿಡಿಯೋ ಅಪ್ಲೋಡ್ ಮಾಡಿ' : 'Upload Video'}
              </Text>
              <TouchableOpacity
                testID="submit-video-btn"
                style={[styles.submitVideoBtn, uploadingVideo && styles.submitVideoBtnDisabled]}
                onPress={handleSubmitVideo}
                disabled={uploadingVideo}
              >
                {uploadingVideo
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.submitVideoBtnText}>
                      {language === 'kn' ? 'ಸಲ್ಲಿಸಿ' : 'Submit'}
                    </Text>}
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.uploadBody} keyboardShouldPersistTaps="handled">
              <TouchableOpacity testID="pick-video-btn" style={styles.videoPicker} onPress={pickVideo}>
                <MaterialIcons name={videoUri ? 'videocam' : 'video-library'} size={32} color={videoUri ? '#1AAA94' : '#bbb'} />
                <Text style={[styles.videoPickerText, videoUri && styles.videoPickerTextSelected]}>
                  {videoUri
                    ? (language === 'kn' ? '✓ ವಿಡಿಯೋ ಆಯ್ಕೆಯಾಗಿದೆ — ಬದಲಿಸಲು ಟ್ಯಾಪ್ ಮಾಡಿ' : '✓ Video selected — Tap to change')
                    : (language === 'kn' ? 'ಲೈಬ್ರರಿಯಿಂದ ವಿಡಿಯೋ ಆಯ್ಕೆ ಮಾಡಿ' : 'Pick a video from your library')}
                </Text>
                {videoUri && (
                  <Text style={styles.videoNote}>
                    {language === 'kn' ? 'ಗರಿಷ್ಠ 50MB ಶಿಫಾರಸು' : 'Recommended max 50MB'}
                  </Text>
                )}
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>
                {language === 'kn' ? 'ವಿಡಿಯೋ ಶೀರ್ಷಿಕೆ *' : 'Video Title *'}
              </Text>
              <TextInput
                testID="video-title-input"
                style={styles.input}
                value={videoTitle}
                onChangeText={setVideoTitle}
                placeholder={language === 'kn' ? 'ವಿಡಿಯೋ ಶೀರ್ಷಿಕೆ ನಮೂದಿಸಿ' : 'Enter video title'}
                placeholderTextColor="#999"
                maxLength={200}
              />

              <Text style={styles.fieldLabel}>
                {language === 'kn' ? 'ವಿವರಣೆ' : 'Description'}
              </Text>
              <TextInput
                testID="video-desc-input"
                style={[styles.input, styles.textArea]}
                value={videoDesc}
                onChangeText={setVideoDesc}
                placeholder={language === 'kn' ? 'ವಿಡಿಯೋ ಬಗ್ಗೆ ಬರೆಯಿರಿ...' : 'Describe the video...'}
                placeholderTextColor="#999"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              <View style={styles.noteBox}>
                <MaterialIcons name="info-outline" size={15} color="#1AAA94" />
                <Text style={styles.noteText}>
                  {language === 'kn'
                    ? 'ವಿಡಿಯೋ ಪರಿಶೀಲನೆಗಾಗಿ "Video Submissions" ವಿಭಾಗದಲ್ಲಿ ಸಲ್ಲಿಸಲಾಗುತ್ತದೆ'
                    : 'Video will be submitted as pending in "Video Submissions" category for review'}
                </Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#1AAA94' },

  brandSection: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, backgroundColor: '#E6F7F3', margin: 16, borderRadius: 14 },
  brandLogo: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#1AAA94', alignItems: 'center', justifyContent: 'center' },
  brandLogoText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  brandName: { fontSize: 18, fontWeight: '900', color: '#1AAA94' },
  brandTagline: { fontSize: 12, color: '#555', marginTop: 2 },

  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#111', marginBottom: 12 },

  submitNewsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#E91E8C', borderRadius: 14, paddingVertical: 15, marginBottom: 8 },
  submitNewsBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  submitNewsNote: { fontSize: 11, color: '#888', textAlign: 'center', marginBottom: 8 },

  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1AAA94', borderRadius: 12, paddingVertical: 14, marginBottom: 12 },
  loginBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  loggedInCard: { backgroundColor: '#F1F8E9', borderRadius: 12, padding: 14, marginBottom: 12 },
  loggedInRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  loggedInIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center' },
  loggedInTitle: { fontSize: 15, fontWeight: '700', color: '#388E3C' },
  loggedInDesc: { fontSize: 12, color: '#555', marginTop: 1 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#FFCDD2', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start' },
  logoutBtnText: { color: '#D32F2F', fontWeight: '600', fontSize: 13 },

  uploadVideoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1AAA94', borderRadius: 12, paddingVertical: 13, marginBottom: 12 },
  uploadVideoBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#E6F7F3', borderRadius: 8, padding: 10 },
  infoText: { flex: 1, fontSize: 12, color: '#1AAA94', lineHeight: 17 },

  langCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#eee', overflow: 'hidden' },
  langOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  langOptionActive: { backgroundColor: '#E6F7F3' },
  langFlag: { fontSize: 24 },
  langText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#333' },
  langTextActive: { color: '#1AAA94', fontWeight: '700' },
  langDivider: { height: 1, backgroundColor: '#eee', marginHorizontal: 16 },
  langNote: { fontSize: 11, color: '#888', marginTop: 8, lineHeight: 16 },

  aboutCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#eee', overflow: 'hidden' },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  aboutText: { fontSize: 14, color: '#333' },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  legalText: { flex: 1, fontSize: 14, color: '#333', fontWeight: '500' },

  wvSafe: { flex: 1, backgroundColor: '#fff' },
  wvHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  wvTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  wvLoadingBar: { height: 3, backgroundColor: '#1AAA94', width: '60%' },

  uploadBody: { flex: 1, padding: 16 },
  videoPicker: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: '#ddd', borderRadius: 12, padding: 24, marginBottom: 16, gap: 8 },
  videoPickerText: { fontSize: 14, color: '#999', textAlign: 'center' },
  videoPickerTextSelected: { color: '#1AAA94', fontWeight: '600' },
  videoNote: { fontSize: 11, color: '#E91E8C' },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 6, marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 14, color: '#111', backgroundColor: '#fafafa', marginBottom: 4 },
  textArea: { height: 110, textAlignVertical: 'top' },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#E6F7F3', borderRadius: 8, padding: 10, marginTop: 12 },
  noteText: { flex: 1, fontSize: 12, color: '#1AAA94', lineHeight: 17 },
  submitVideoBtn: { backgroundColor: '#E91E8C', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  submitVideoBtnDisabled: { backgroundColor: '#F8BBD0' },
  submitVideoBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  // Reporter Upload Access styles
  reporterUnlockedCard: {
    backgroundColor: '#E6F7F3',
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },
  reporterUnlockedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  reporterUnlockedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reporterUnlockedTitle: { fontSize: 14, fontWeight: '700', color: '#1AAA94' },
  reporterUnlockedDesc: { fontSize: 12, color: '#555', marginTop: 2 },
  directUploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#1AAA94', borderRadius: 14, paddingVertical: 15,
    marginTop: 12, elevation: 3,
  },
  directUploadTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  revokeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    backgroundColor: '#FFF8F8',
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  revokeBtnText: { color: '#D32F2F', fontSize: 12, fontWeight: '600' },
  // Reporter name field (after PS2026 unlock)
  reporterNameLabel: { fontSize: 12, fontWeight: '700', color: '#1AAA94', letterSpacing: 0.4 },
  reporterNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#C5D8F0',
  },
  reporterNameInput: {
    flex: 1,
    fontSize: 14,
    color: '#111',
    paddingVertical: 10,
  },
  reporterNameSaveBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1AAA94',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reporterCodeDesc: { fontSize: 12, color: '#666', marginBottom: 10, lineHeight: 17 },
  reporterCodeInput: {
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    padding: 13,
    fontSize: 16,
    color: '#111',
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 6,
    backgroundColor: '#FAFAFA',
  },
  reporterCodeInputError: { borderColor: '#e53935' },
  reporterCodeError: { color: '#e53935', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  reporterUnlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1AAA94',
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 4,
  },
  reporterUnlockBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
