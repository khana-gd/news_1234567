import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, Image,
  ScrollView, Modal, FlatList, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLanguage } from '../context/LanguageContext';

const KARNATAKA_DISTRICTS = [
  'Bagalkote', 'Ballari', 'Belagavi', 'Bengaluru Rural', 'Bengaluru Urban',
  'Bidar', 'Chamarajanagara', 'Chikkaballapura', 'Chikkamagaluru', 'Chitradurga',
  'Dakshina Kannada', 'Davanagere', 'Dharwad', 'Gadag', 'Haveri', 'Hassan',
  'Kalaburagi', 'Kodagu', 'Kolar', 'Koppal', 'Mandya', 'Mysuru',
  'Raichur', 'Ramanagara', 'Shivamogga', 'Tumakuru', 'Udupi',
  'Uttara Kannada', 'Vijayapura', 'Yadgir', 'Vijayanagara',
];

export default function OnboardingScreen() {
  const { language, setLanguage } = useLanguage();
  const [step, setStep] = useState(1);
  const [selectedDistrict, setSelectedDistrict] = useState('Bengaluru Urban');
  const [showDistrictPicker, setShowDistrictPicker] = useState(false);

  const [agreed, setAgreed] = useState(false);

  const handleRoleSelect = async (role: 'viewer' | 'reporter') => {
    await AsyncStorage.setItem('user_type', role);
    if (role === 'reporter') {
      Linking.openURL('https://mypublicsamachar.com/wp-login.php').catch(() => {});
    }
    setStep(2);
  };

  const handleLanguageSelect = (lang: 'en' | 'kn') => {
    setLanguage(lang);
    setStep(3);
  };

  const handleDistrictNext = () => {
    setStep(4);
  };

  const handleFinish = async () => {
    await AsyncStorage.setItem('user_district', selectedDistrict);
    await AsyncStorage.setItem('onboarding_complete', 'true');
    router.replace('/(tabs)');
  };

  const isKn = language === 'kn';

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#DFF5EF', '#EAF7F3', '#F5FAF8', '#FAFAFA']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <StatusBar backgroundColor="transparent" translucent barStyle="dark-content" />

        {/* Brand */}
        <View style={s.brand}>
          <Image
            source={require('../assets/images/logo.png')}
            style={s.brandLogo}
            resizeMode="contain"
          />
          <View>
            <Text style={s.brandName}>My Public Samachara</Text>
            <Text style={s.brandTagline}>Karnataka&apos;s Community News</Text>
          </View>
        </View>

        {/* Step Progress */}
        <View style={s.stepRow}>
          {[1, 2, 3, 4].map(n => (
            <React.Fragment key={n}>
              <View style={[s.stepDot, step >= n && s.stepDotActive, step === n && s.stepDotCurrent]}>
                {step > n
                  ? <MaterialIcons name="check" size={12} color="#fff" />
                  : <Text style={[s.stepNum, step >= n && s.stepNumActive]}>{n}</Text>}
              </View>
              {n < 4 && <View style={[s.stepLine, step > n && s.stepLineActive]} />}
            </React.Fragment>
          ))}
        </View>

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* STEP 1 — Role */}
          {step === 1 && (
            <>
              <Text style={s.stepTitle}>Who are you?</Text>
              <Text style={s.stepSub}>ನೀವು ಯಾರು?</Text>

              <TouchableOpacity style={s.card} onPress={() => handleRoleSelect('viewer')} activeOpacity={0.85}>
                <View style={[s.cardIcon, { backgroundColor: '#E6F7F3' }]}>
                  <Ionicons name="newspaper-outline" size={32} color="#1AAA94" />
                </View>
                <View style={s.cardInfo}>
                  <Text style={s.cardTitle}>I&apos;m a Viewer</Text>
                  <Text style={s.cardTitleKn}>ನಾನು ಓದುಗ / ವೀಕ್ಷಕ</Text>
                  <Text style={s.cardDesc}>Read the latest Karnataka news</Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#1AAA94" />
              </TouchableOpacity>

              <TouchableOpacity style={[s.card, s.cardRep]} onPress={() => handleRoleSelect('reporter')} activeOpacity={0.85}>
                <View style={[s.cardIcon, { backgroundColor: '#FCE4EC' }]}>
                  <Ionicons name="mic-outline" size={32} color="#E91E8C" />
                </View>
                <View style={s.cardInfo}>
                  <Text style={[s.cardTitle, { color: '#E91E8C' }]}>I&apos;m a Reporter</Text>
                  <Text style={s.cardTitleKn}>ನಾನು ವರದಿಗಾರ</Text>
                  <Text style={s.cardDesc}>Submit stories & upload videos</Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#E91E8C" />
              </TouchableOpacity>
            </>
          )}

          {/* STEP 2 — Language */}
          {step === 2 && (
            <>
              <Text style={s.stepTitle}>Choose Language</Text>
              <Text style={s.stepSub}>ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ</Text>

              <TouchableOpacity style={s.card} onPress={() => handleLanguageSelect('en')} activeOpacity={0.85}>
                <Text style={s.flag}>🇬🇧</Text>
                <View style={s.cardInfo}>
                  <Text style={s.cardTitle}>English</Text>
                  <Text style={s.cardDesc}>App interface in English</Text>
                </View>
                {language === 'en' && <MaterialIcons name="check-circle" size={24} color="#1AAA94" />}
              </TouchableOpacity>

              <TouchableOpacity style={[s.card, { borderColor: '#FFD0D0' }]} onPress={() => handleLanguageSelect('kn')} activeOpacity={0.85}>
                <Text style={s.flag}>🇮🇳</Text>
                <View style={s.cardInfo}>
                  <Text style={[s.cardTitle, { color: '#C62828' }]}>ಕನ್ನಡ</Text>
                  <Text style={s.cardDesc}>ಅಪ್ಲಿಕೇಶನ್ ಕನ್ನಡದಲ್ಲಿ</Text>
                </View>
                {language === 'kn' && <MaterialIcons name="check-circle" size={24} color="#C62828" />}
              </TouchableOpacity>
            </>
          )}

          {/* STEP 3 — District */}
          {step === 3 && (
            <>
              <Text style={s.stepTitle}>{isKn ? 'ನಿಮ್ಮ ಜಿಲ್ಲೆ' : 'Your District'}</Text>
              <Text style={s.stepSub}>{isKn ? '31 ಜಿಲ್ಲೆಗಳಿಂದ ಆಯ್ಕೆ ಮಾಡಿ' : 'Select from 31 Karnataka districts'}</Text>

              <TouchableOpacity style={s.districtBtn} onPress={() => setShowDistrictPicker(true)} activeOpacity={0.85}>
                <MaterialIcons name="location-on" size={22} color="#1AAA94" />
                <Text style={s.districtBtnText}>{selectedDistrict}</Text>
                <MaterialIcons name="arrow-drop-down" size={26} color="#1AAA94" />
              </TouchableOpacity>

              <View style={s.infoBox}>
                <MaterialIcons name="info-outline" size={15} color="#1AAA94" />
                <Text style={s.infoText}>
                  {isKn
                    ? 'ನಿಮ್ಮ ಜಿಲ್ಲೆಯ ಸ್ಥಳೀಯ ಸುದ್ದಿ ನೋಡಲು ಇದನ್ನು ಬಳಸಲಾಗುತ್ತದೆ'
                    : 'Used to show local news from your district in the feed'}
                </Text>
              </View>

              <TouchableOpacity style={s.startBtn} onPress={handleDistrictNext} activeOpacity={0.85}>
                <MaterialIcons name="arrow-forward" size={20} color="#fff" />
                <Text style={s.startBtnText}>{isKn ? 'ಮುಂದೆ' : 'Continue'}</Text>
              </TouchableOpacity>
            </>
          )}

          {/* STEP 4 — Legal / India IT Rules 2026 */}
          {step === 4 && (
            <>
              <Text style={s.stepTitle}>{isKn ? 'ನೀತಿ ಒಪ್ಪಂದ' : 'User Policy'}</Text>
              <Text style={s.stepSub}>{isKn ? 'ಭಾರತ IT ನಿಯಮಗಳು 2026' : 'India IT Rules 2026 Compliance'}</Text>

              <View style={s.policyBox}>
                <View style={s.policyIconRow}>
                  <MaterialIcons name="gavel" size={20} color="#1AAA94" />
                  <Text style={s.policyBoxTitle}>{isKn ? 'ಬಳಕೆದಾರ ವಿಷಯ ನೀತಿ' : 'User Content Policy'}</Text>
                </View>
                <Text style={s.policyText}>
                  {isKn
                    ? '• ಮಾನಹಾನಿಕರ, ಅಶ್ಲೀಲ ಅಥವಾ ಕಾನೂನುವಿರೋಧಿ ವಿಷಯ ಪ್ರಕಟಿಸುವುದು ನಿಷೇಧಿಸಲಾಗಿದೆ.\n• ಉಲ್ಲಂಘನೆಗಳನ್ನು ತಕ್ಷಣ ತೆಗೆಸಲಾಗುತ್ತದೆ ಮತ್ತು IT ಕಾಯ್ದೆ ಅಡಿ ವರದಿ ಮಾಡಲಾಗುತ್ತದೆ.\n• ನಿಮ್ಮ ವಿಷಯಕ್ಕೆ ನೀವೇ ಜವಾಬ್ದಾರಿ.'
                    : '• You are PROHIBITED from posting defamatory, obscene, or illegal content under Indian law.\n• Violations will be immediately removed and reported to authorities under India\'s IT Act & IT Rules 2026.\n• You are solely responsible for the content you submit.\n• Public Samachar reserves the right to moderate all content.'}
                </Text>
              </View>

              <TouchableOpacity style={s.checkRow} onPress={() => setAgreed(f => !f)} activeOpacity={0.8}>
                <View style={[s.checkbox, agreed && s.checkboxActive]}>
                  {agreed && <MaterialIcons name="check" size={14} color="#fff" />}
                </View>
                <Text style={s.checkText}>
                  {isKn
                    ? 'ನಾನು ವಿಷಯ ನೀತಿಗೆ ಸಹಮತಿಸುತ್ತೇನೆ. ಮಾನಹಾನಿಕರ / ಕಾನೂನುವಿರೋಧಿ ವಿಷಯ ಪ್ರಕಟಿಸಲು ನಿಷೇಧಿಸಲಾಗಿದೆ ಎಂದು ಒಪ್ಪಿಕೊಳ್ಳುತ್ತೇನೆ.'
                    : 'I agree to the User Content Policy. I understand I am prohibited from posting defamatory or illegal content as per India IT Rules 2026.'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.startBtn, !agreed && s.startBtnDisabled]}
                onPress={agreed ? handleFinish : undefined}
                activeOpacity={agreed ? 0.85 : 1}
              >
                <MaterialIcons name="check-circle" size={20} color="#fff" />
                <Text style={s.startBtnText}>{isKn ? 'ಒಪ್ಪಿ ಪ್ರಾರಂಭಿಸಿ' : 'Agree & Start Reading'}</Text>
              </TouchableOpacity>
            </>
          )}

        </ScrollView>

        {/* District Picker Modal */}
        <Modal visible={showDistrictPicker} animationType="slide" onRequestClose={() => setShowDistrictPicker(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>{isKn ? 'ಜಿಲ್ಲೆ ಆಯ್ಕೆ ಮಾಡಿ' : 'Select Your District'}</Text>
              <TouchableOpacity onPress={() => setShowDistrictPicker(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={KARNATAKA_DISTRICTS}
              keyExtractor={d => d}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.districtItem, selectedDistrict === item && s.districtItemSel]}
                  onPress={() => { setSelectedDistrict(item); setShowDistrictPicker(false); }}
                >
                  <MaterialIcons name="location-city" size={18} color={selectedDistrict === item ? '#1AAA94' : '#bbb'} />
                  <Text style={[s.districtItemText, selectedDistrict === item && s.districtItemTextSel]}>{item}</Text>
                  {selectedDistrict === item && <MaterialIcons name="check-circle" size={18} color="#1AAA94" />}
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 4 },
  brandLogo: { width: 56, height: 56, borderRadius: 12 },
  brandName: { fontSize: 18, fontWeight: '900', color: '#1AAA94' },
  brandTagline: { fontSize: 11, color: '#888' },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  stepDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E0E6F0', alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: '#1AAA94' },
  stepDotCurrent: { backgroundColor: '#fff', borderWidth: 2.5, borderColor: '#1AAA94' },
  stepNum: { fontSize: 13, fontWeight: '700', color: '#999' },
  stepNumActive: { color: '#1AAA94' },
  stepLine: { width: 44, height: 2, backgroundColor: '#E0E6F0' },
  stepLineActive: { backgroundColor: '#1AAA94' },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 },
  stepTitle: { fontSize: 24, fontWeight: '900', color: '#1AAA94', marginBottom: 4 },
  stepSub: { fontSize: 13, color: '#888', marginBottom: 22 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: '#D0E4FF', backgroundColor: 'rgba(255,255,255,0.82)', marginBottom: 14 },
  cardRep: { borderColor: '#FFD0E4' },
  cardIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#1AAA94' },
  cardTitleKn: { fontSize: 12, color: '#888', marginBottom: 2 },
  cardDesc: { fontSize: 12, color: '#666' },
  flag: { fontSize: 36 },
  districtBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: '#1AAA94', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16, backgroundColor: 'rgba(255,255,255,0.82)', marginBottom: 14 },
  districtBtnText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1AAA94' },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(227,242,253,0.8)', borderRadius: 10, padding: 12, marginBottom: 24 },
  infoText: { flex: 1, fontSize: 12, color: '#1AAA94', lineHeight: 18 },
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1AAA94', borderRadius: 16, paddingVertical: 17 },
  startBtnDisabled: { backgroundColor: '#90CAF9' },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  // Policy step
  policyBox: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: '#D0E4FF', marginBottom: 18 },
  policyIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  policyBoxTitle: { fontSize: 14, fontWeight: '800', color: '#1AAA94' },
  policyText: { fontSize: 13, color: '#444', lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 24, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#D0E4FF' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#1AAA94', alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  checkboxActive: { backgroundColor: '#1AAA94', borderColor: '#1AAA94' },
  checkText: { flex: 1, fontSize: 13, color: '#333', lineHeight: 19 },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  districtItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  districtItemSel: { backgroundColor: '#E6F7F3' },
  districtItemText: { flex: 1, fontSize: 15, color: '#333' },
  districtItemTextSel: { fontWeight: '700', color: '#1AAA94' },
});
