import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';

type Props = {
  visible: boolean;
  onClose: () => void;
  language: string;
};

type Step = 'pick' | 'details' | 'uploading' | 'done' | 'error';

const CATEGORIES = [
  'General', 'Local News', 'Karnataka', 'Politics',
  'Sports', 'Entertainment', 'Crime', 'Weather',
];

// ── No upload limits: YouTube handles any file size or duration ───────────

export default function UploadVideoModal({ visible, onClose, language }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isKn = language === 'kn';

  const [step, setStep]           = useState<Step>('pick');
  const [videoAsset, setAsset]    = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [title, setTitle]         = useState('');
  const [description, setDesc]     = useState('');
  const [category, setCategory]   = useState('General');
  const [location, setLocation]   = useState('');
  const [gpsLoading, setGpsLoad]  = useState(false);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  const [progress, setProgress]   = useState(0);
  const [progressMsg, setProgMsg] = useState('');

  // Auto-fetch GPS when landing on details step
  useEffect(() => {
    if (step === 'details' && !location) {
      fetchGPS();
    }
  }, [step]);

  const fetchGPS = async () => {
    setGpsLoad(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGpsLoad(false); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const rev = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (rev.length > 0) {
        const { city, district, region, subregion } = rev[0];
        const place = city || district || subregion || region || '';
        if (place) setLocation(place);
      }
    } catch {}
    setGpsLoad(false);
  };

  const reset = () => {
    setStep('pick'); setAsset(null); setTitle('');
    setDesc(''); setCategory('General'); setLocation('');
    setErrorMsg(null); setProgress(0); setProgMsg('');
  };
  const resetAndClose = () => { reset(); onClose(); };

  // ── Step 1: pick video ────────────────────────────────────────────────────
  const pickVideo = async () => {
    setErrorMsg(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(
        isKn ? '\u0c85\u0ca8\u0cc1\u0cae\u0ca4\u0cbf \u0c85\u0c97\u0ca4\u0ccd\u0caf' : 'Permission Required',
        isKn ? '\u0cb5\u0cbf\u0ca1\u0cbf\u0caf\u0ccb \u0c86\u0caf\u0ccd\u0c95\u0cc6 \u0cae\u0cbe\u0ca1\u0cb2\u0cc1 \u0c97\u0ccd\u0caf\u0cbe\u0cb2\u0cb0\u0cbf \u0c85\u0ca8\u0cc1\u0cae\u0ca4\u0cbf \u0c85\u0c97\u0ca4\u0ccd\u0caf'
            : 'Please allow gallery access to pick a video.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
      // No duration/size limits — YouTube Data API handles any size
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      setAsset(asset);
      setStep('details');
    }
  };

  // ── Navigate to editor ───────────────────────────────────────────────────
  const openEditor = useCallback(() => {
    if (!videoAsset) return;
    resetAndClose();
    router.push({
      pathname: '/video-editor' as any,
      params: {
        uri: videoAsset.uri,
        title: title || '',
        description: description || '',
        location: location || '',
      },
    });
  }, [videoAsset, title, description, location, router]);

  // ── Step 2: upload via axios with real progress ──────────────────────────
  const handleUpload = async () => {
    if (!videoAsset || !title.trim()) {
      setErrorMsg(isKn ? '\u0cb6\u0cc0\u0cb0\u0ccd\u0cb7\u0cbf\u0c95\u0cc6 \u0c85\u0c97\u0ca4\u0ccd\u0caf' : 'Please enter a title.');
      return;
    }
    setStep('uploading');
    setProgress(0);
    setProgMsg(isKn ? '\u0cb8\u0cbf\u0ca6\u0ccd\u0ca7\u0caa\u0ca1\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cc1\u0ca4\u0ccd\u0ca4\u0cbf\u0ca6\u0cc6...' : 'Preparing upload...');
    setErrorMsg(null);

    try {
      const filename = videoAsset.uri.split('/').pop() || `vid_${Date.now()}.mp4`;
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';

      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', description.trim() || '');
      formData.append('location', location.trim() || '');
      formData.append('video', {
        uri: videoAsset.uri,
        type: videoAsset.mimeType || 'video/mp4',
        name: filename,
      } as any);

      const resp = await axios.post(`${backendUrl}/api/submit-video`, formData, {
        // No manual Content-Type — React Native sets multipart/form-data + boundary automatically
        timeout: 600000, // 10 min
        onUploadProgress: (evt) => {
          const total = evt.total ?? 0;
          if (total > 0) {
            const pct = Math.min(99, Math.round((evt.loaded * 100) / total));
            setProgress(pct);
            if      (pct < 25) setProgMsg(isKn ? '\u0c85\u0caa\u0ccd\u200c\u0cb2\u0ccb\u0ca1\u0ccd \u0c86\u0cb0\u0c82\u0cad...'     : 'Starting upload...');
            else if (pct < 55) setProgMsg(isKn ? '\u0c85\u0caa\u0ccd\u200c\u0cb2\u0ccb\u0ca1\u0ccd \u0c86\u0c97\u0cc1\u0ca4\u0ccd\u0ca4\u0cbf\u0ca6\u0cc6...'    : 'Uploading...');
            else if (pct < 88) setProgMsg(isKn ? '\u0cac\u0cb9\u0cc1\u0ca4\u0cc7\u0c95 \u0cae\u0cc1\u0c97\u0cbf\u0ca6\u0cc6...'      : 'Almost done...');
            else               setProgMsg(isKn ? '\u0cb8\u0cb0\u0ccd\u0cb5\u0cb0\u0ccd \u0caa\u0ccd\u0cb0\u0c95\u0ccd\u0cb0\u0cbf\u0caf\u0cc6\u0c97\u0ccb\u0cb3\u0cbf\u0cb8\u0cc1\u0ca4\u0ccd\u0ca4\u0cbf\u0ca6\u0cc6...' : 'Processing on server...');
          }
        },
      });

      setProgress(100);
      if (resp.data?.success) {
        setProgMsg(isKn ? '\u0caf\u0cb6\u0cb8\u0ccd\u0cb5\u0cbf!' : 'Success!');
        await new Promise(r => setTimeout(r, 600));
        setStep('done');
      } else {
        setErrorMsg(isKn ? '\u0c85\u0caa\u0ccd\u200c\u0cb2\u0ccb\u0ca1\u0ccd \u0cb5\u0cbf\u0cab\u0cb2. \u0cae\u0ca4\u0ccd\u0ca4\u0cc6 \u0caa\u0ccd\u0cb0\u0caf\u0ca4\u0ccd\u0ca8\u0cbf\u0cb8\u0cbf.' : 'Upload failed. Please try again.');
        setStep('error');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Upload failed';
      setErrorMsg(`${isKn ? '\u0ca6\u0ccb\u0cb7' : 'Error'}: ${msg}`);
      setStep('error');
      setProgress(0);
    }
  };

  const fmtDur  = (s?: number | null) => { if (!s) return ''; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
  const fmtSize = (b?: number | null) => { if (!b) return ''; return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`; };
  const fileName = videoAsset?.uri.split('/').pop() || '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={resetAndClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor="#0D8975" />
        <LinearGradient colors={['#0D8975', '#1AAA94', '#1976D2']} style={StyleSheet.absoluteFill} />

        {/* Header */}
        <View style={styles.hdr}>
          <TouchableOpacity onPress={resetAndClose} style={styles.closeBtn} activeOpacity={0.7}>
            <MaterialIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.hdrTitle}>{isKn ? '\u0cb8\u0cc1\u0ca6\u0ccd\u0ca6\u0cbf \u0cb5\u0cb0\u0ca6\u0cbf \u0cae\u0cbe\u0ca1\u0cbf' : 'Report News'}</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── PICK ── */}
            {step === 'pick' && (
              <View style={styles.centered}>
                <View style={styles.iconCircle}>
                  <Ionicons name="videocam" size={56} color="rgba(255,255,255,0.9)" />
                </View>
                <Text style={styles.bigTxt}>
                  {isKn ? '\u0cb5\u0cbf\u0ca1\u0cbf\u0caf\u0ccb \u0c86\u0caf\u0ccd\u0c95\u0cc6 \u0cae\u0cbe\u0ca1\u0cbf' : 'Choose a Video'}
                </Text>
                <Text style={styles.subTxt}>
                  {isKn ? 'ಯಾವುದೇ ಗಾತ್ರ · ಯಾವ ಅವಧಿ ಬೇಕಾದರೂ' : 'Any size · Any duration — No limits'}
                </Text>
                <TouchableOpacity style={styles.pickBtn} onPress={pickVideo} activeOpacity={0.85}>
                  <MaterialIcons name="video-library" size={22} color="#1AAA94" />
                  <Text style={styles.pickBtnTxt}>
                    {isKn ? '\u0c97\u0ccd\u0caf\u0cbe\u0cb2\u0cb0\u0cbf\u0caf\u0cbf\u0c82\u0ca6 \u0c86\u0caf\u0ccd\u0c95\u0cc6' : 'Choose from Gallery'}
                  </Text>
                </TouchableOpacity>
                {errorMsg ? <Text style={styles.errTxt}>{errorMsg}</Text> : null}
              </View>
            )}

            {/* ── DETAILS / ERROR ── */}
            {(step === 'details' || step === 'error') && videoAsset && (
              <View>
                {/* Video chip */}
                <View style={styles.videoChip}>
                  <MaterialIcons name="videocam" size={20} color="#7C9FD4" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chipName} numberOfLines={1}>{fileName}</Text>
                    <Text style={styles.chipMeta}>
                      {[fmtDur(videoAsset.duration), fmtSize(videoAsset.fileSize)].filter(Boolean).join(' \u00b7 ')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setAsset(null); setStep('pick'); }}
                    style={styles.changeBtn}
                  >
                    <Text style={styles.changeTxt}>{isKn ? '\u0cac\u0ca6\u0cb2\u0cbf\u0cb8\u0cbf' : 'Change'}</Text>
                  </TouchableOpacity>
                </View>

                {/* Title */}
                <Text style={styles.fieldLbl}>{isKn ? 'ಶೀರ್ಷಿಕೆ *' : 'TITLE *'}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={isKn ? 'ಸುದ್ದಿ ಶೀರ್ಷಿಕೆ...' : 'Enter news headline...'}
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={150}
                  returnKeyType="next"
                />

                {/* Description */}
                <Text style={styles.fieldLbl}>{isKn ? 'ವಿವರಣೆ' : 'DESCRIPTION (optional, up to 500 words)'}</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  placeholder={isKn ? 'ಸುದ್ದಿ ವಿವರ, ಸಂದರ್ಭ...' : 'Describe the news story, context, important details...'}
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  value={description}
                  onChangeText={setDesc}
                  maxLength={3000}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                  returnKeyType="done"
                />
                <Text style={styles.charCount}>{description.length}/3000</Text>

                {/* Location */}
                <Text style={styles.fieldLbl}>{isKn ? '\u0cb8\u0ccd\u0ca5\u0cb3' : 'LOCATION'}</Text>
                <View style={styles.locationRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder={isKn ? '\u0cb8\u0ccd\u0ca5\u0cb3 \u0ca8\u0cae\u0cc2\u0ca6\u0cbf...' : 'City or area...'}
                    placeholderTextColor="rgba(255,255,255,0.38)"
                    value={location}
                    onChangeText={setLocation}
                    maxLength={80}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={styles.gpsBtn}
                    onPress={fetchGPS}
                    activeOpacity={0.8}
                  >
                    {gpsLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <MaterialIcons name="my-location" size={20} color="#fff" />
                    }
                  </TouchableOpacity>
                </View>
                <Text style={styles.gpsHint}>
                  {isKn ? '\u0c9c\u0cbf\u0caa\u0cbf\u0c8e\u0cb8\u0ccd \u0cae\u0cc2\u0cb2\u0c95 \u0cb8\u0ccd\u0cb5\u0caf\u0c82 \u0caa\u0ca4\u0ccd\u0ca4\u0cc6 \u0cae\u0cbe\u0ca1\u0cb2\u0cbe\u0c97\u0cc1\u0ca4\u0ccd\u0ca4\u0ca6\u0cc6' : 'Tap \uD83D\uDCCD to auto-detect via GPS'}
                </Text>

                {/* Category */}
                <Text style={[styles.fieldLbl, { marginTop: 14 }]}>{isKn ? '\u0cb5\u0cbf\u0cad\u0cbe\u0c97' : 'CATEGORY'}</Text>
                <View style={styles.catGrid}>
                  {CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.catChip, category === cat && styles.catOn]}
                      onPress={() => setCategory(cat)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.catTxt, category === cat && styles.catTxtOn]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {errorMsg ? <Text style={styles.errTxt}>{errorMsg}</Text> : null}

                {/* ── SINGLE ACTION: Always go through editor for logo burning ── */}
                <TouchableOpacity
                  style={[styles.wpUploadBtn, !title.trim() && { opacity: 0.45 }]}
                  onPress={openEditor}
                  disabled={!title.trim()}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="movie-filter" size={22} color="#fff" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wpUploadTxt}>
                      {isKn ? 'ಸಂಪಾದಿಸಿ & ಅಪ್‌ಲೋಡ್' : 'Edit & Brand Video'}
                    </Text>
                    <Text style={styles.editSubTxt}>
                      {isKn ? 'ಲೋಗೋ ಬರ್ನ್ → YouTube / ವೆಬ್‌ಸೈಟ್ ಆಯ್ಕೆ' : 'Burn logo → Choose: YouTube or Website'}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {/* ── UPLOADING ── */}
            {step === 'uploading' && (
              <View style={styles.centered}>
                {/* Percentage ring */}
                <View style={styles.pctRing}>
                  <Text style={styles.pctTxt}>{progress}%</Text>
                </View>

                {/* Progress bar */}
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${progress}%` as any }]} />
                </View>

                <Text style={styles.bigTxt}>
                  {isKn ? '\u0c85\u0caa\u0ccd\u200c\u0cb2\u0ccb\u0ca1\u0ccd \u0c86\u0c97\u0cc1\u0ca4\u0ccd\u0ca4\u0cbf\u0ca6\u0cc6...' : 'Uploading...'}
                </Text>
                <Text style={styles.subTxt}>{progressMsg}</Text>
                <Text style={styles.hintTxt}>
                  {isKn ? '\u0c85\u0caa\u0ccd \u0ca4\u0cc6\u0cb0\u0cc6\u0ca6\u0cbf\u0ca1\u0cbf' : 'Keep the app open'}
                </Text>
              </View>
            )}

            {/* ── DONE ── */}
            {step === 'done' && (
              <View style={styles.centered}>
                <View style={styles.successRing}>
                  <MaterialIcons name="check-circle" size={72} color="#4CAF50" />
                </View>
                <Text style={styles.bigTxt}>{isKn ? 'ಯಶಸ್ವಿ!' : 'Video Uploaded!'}</Text>
                <Text style={styles.subTxt}>
                  {isKn
                    ? 'ನಿಮ್ಮ ವಿಡಿಯೋ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ LIVE ಆಗಿದೆ! ವಿಡಿಯೋ ವಿಭಾಗದಲ್ಲಿ ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತದೆ.'
                    : 'Your video is LIVE on the website! Pull to refresh the Video section to see it.'}
                </Text>
                <TouchableOpacity style={styles.doneBtn} onPress={resetAndClose} activeOpacity={0.85}>
                  <Text style={styles.doneTxt}>{isKn ? 'ಮುಗಿಸಿ' : 'Done'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1 },
  hdr:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.18)' },
  closeBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  hdrTitle:   { fontSize: 17, fontWeight: '800', color: '#fff' },
  body:       { padding: 24, paddingBottom: 60, flexGrow: 1 },
  centered:   { alignItems: 'center', gap: 16, paddingVertical: 40 },
  iconCircle: { width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  bigTxt:     { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subTxt:     { fontSize: 14, color: 'rgba(255,255,255,0.68)', textAlign: 'center', lineHeight: 20 },
  pickBtn:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 30, paddingHorizontal: 28, paddingVertical: 14, marginTop: 8, elevation: 2 },
  pickBtnTxt: { fontSize: 15, fontWeight: '700', color: '#1AAA94' },
  videoChip:  { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 14, marginBottom: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  chipName:   { fontSize: 13, color: '#fff', fontWeight: '600' },
  chipMeta:   { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  changeBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
  changeTxt:  { fontSize: 12, color: '#fff', fontWeight: '700' },
  fieldLbl:   { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.62)', marginBottom: 8, letterSpacing: 1 },
  input:      { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, padding: 14, color: '#fff', fontSize: 15, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  inputMultiline: { minHeight: 180, paddingTop: 12, marginBottom: 4 },
  charCount:    { fontSize: 11, color: 'rgba(255,255,255,0.45)', textAlign: 'right', marginBottom: 14 },
  locationRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  gpsBtn:     { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  gpsHint:    { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 },
  catGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  catChip:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  catOn:      { backgroundColor: '#fff', borderColor: '#fff' },
  catTxt:     { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  catTxtOn:   { color: '#1AAA94' },
  errTxt:     { color: '#FF8A80', fontSize: 13, textAlign: 'center', marginBottom: 12, lineHeight: 19 },
  btnRow:     { marginTop: 4 },
  wpUploadBtn:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#1AAA94', borderRadius: 30, paddingVertical: 16, elevation: 3, marginBottom: 0 },
  wpUploadTxt:{ color: '#fff', fontWeight: '800', fontSize: 16 },
  editSubTxt: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 2 },
  editBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 30, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  editBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  submitBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  submitTxt:  { color: 'rgba(255,255,255,0.7)', fontWeight: '600', fontSize: 13 },
  pctRing:    { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 4, borderColor: 'rgba(76,175,80,0.65)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  pctTxt:     { fontSize: 32, fontWeight: '900', color: '#fff' },
  barTrack:   { width: '100%', height: 12, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 6, overflow: 'hidden', marginBottom: 10 },
  barFill:    { height: '100%', backgroundColor: '#4CAF50', borderRadius: 6 },
  hintTxt:    { fontSize: 12, color: 'rgba(255,255,255,0.42)', textAlign: 'center', marginTop: -4 },
  successRing:{ width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(76,175,80,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  doneBtn:    { backgroundColor: '#fff', borderRadius: 30, paddingHorizontal: 48, paddingVertical: 14, marginTop: 12 },
  doneTxt:    { color: '#1AAA94', fontWeight: '800', fontSize: 16 },
});
