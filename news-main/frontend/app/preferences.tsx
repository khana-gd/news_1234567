import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Modal, FlatList, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../utils/api';

const KARNATAKA_DISTRICTS = [
  'Any District (ಯಾವುದಾದರೂ ಜಿಲ್ಲೆ)',
  'Bagalkot', 'Ballari', 'Belagavi', 'Bengaluru Rural', 'Bengaluru Urban',
  'Bidar', 'Chamarajanagar', 'Chikkaballapur', 'Chikkamagaluru', 'Chitradurga',
  'Dakshina Kannada', 'Davanagere', 'Dharwad', 'Gadag', 'Hassan',
  'Haveri', 'Kalaburagi', 'Kodagu', 'Kolar', 'Koppal',
  'Mandya', 'Mysuru', 'Raichur', 'Ramanagara', 'Shivamogga',
  'Tumakuru', 'Udupi', 'Uttara Kannada', 'Vijayapura', 'Yadgir', 'Vijayanagara',
];

export default function PreferencesScreen() {
  const [userName, setUserName] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState(KARNATAKA_DISTRICTS[0]);
  const [showDistrictPicker, setShowDistrictPicker] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: number; name: string; slug: string }>>([]);
  const [selectedCats, setSelectedCats] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('user_name').then(n => { if (n) setUserName(n); });
    api.getCategories().then(cats => {
      setCategories(cats.filter(c => c.slug !== 'uncategorized').slice(0, 20));
    }).catch(() => {});
  }, []);

  const toggleCategory = (catId: number) => {
    setSelectedCats(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    await AsyncStorage.setItem('user_district', selectedDistrict);
    await AsyncStorage.setItem('user_categories', JSON.stringify(selectedCats));
    await AsyncStorage.setItem('onboarding_complete', 'true');
    setSaving(false);
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar backgroundColor="#fff" barStyle="dark-content" />

      <View style={s.header}>
        <Text style={s.headerTitle}>Your Preferences</Text>
        <Text style={s.headerSubtitle}>ನಿಮ್ಮ ಆದ್ಯತೆಗಳು</Text>
      </View>

      <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
        {userName ? (
          <View style={s.greetCard}>
            <Text style={s.greetText}>
              Hello, <Text style={s.greetName}>{userName}!</Text>
              {'  '}ನಿಮ್ಮ ಅನುಭವ ವ್ಯಕ್ತಿಗತಗೊಳಿಸೋಣ.
            </Text>
          </View>
        ) : null}

        {/* District */}
        <Text style={s.label}>Your District</Text>
        <Text style={s.labelKn}>ನಿಮ್ಮ ಜಿಲ್ಲೆ</Text>
        <TouchableOpacity style={s.districtBtn} onPress={() => setShowDistrictPicker(true)} activeOpacity={0.85}>
          <MaterialIcons name="location-on" size={20} color="#1AAA94" />
          <Text style={s.districtBtnText} numberOfLines={1}>{selectedDistrict}</Text>
          <MaterialIcons name="arrow-drop-down" size={24} color="#1AAA94" />
        </TouchableOpacity>

        {/* Categories */}
        <Text style={[s.label, { marginTop: 24 }]}>Preferred News Categories</Text>
        <Text style={s.labelKn}>ಆದ್ಯತೆಯ ವಿಭಾಗಗಳು (ಒಂದು ಅಥವಾ ಹಲವು)</Text>

        {categories.length === 0 ? (
          <Text style={s.loadingCats}>ಲೋಡ್ ಆಗುತ್ತಿದೆ...</Text>
        ) : (
          <View style={s.catsGrid}>
            {categories.map(cat => {
              const sel = selectedCats.includes(cat.id);
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[s.catChip, sel && s.catChipSelected]}
                  onPress={() => toggleCategory(cat.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.catChipText, sel && s.catChipTextSelected]}>{cat.name}</Text>
                  {sel && <MaterialIcons name="check" size={13} color="#fff" />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Start Reading News →'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.skipBtn} onPress={handleSave}>
          <Text style={s.skipText}>Skip →</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* District Picker Modal */}
      <Modal visible={showDistrictPicker} animationType="slide" onRequestClose={() => setShowDistrictPicker(false)}>
        <SafeAreaView style={s.pickerSafe}>
          <View style={s.pickerHeader}>
            <Text style={s.pickerTitle}>Select Your District</Text>
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
                <MaterialIcons
                  name={item.includes('Any') ? 'public' : 'location-on'}
                  size={18}
                  color={selectedDistrict === item ? '#1AAA94' : '#999'}
                />
                <Text style={[s.districtItemText, selectedDistrict === item && s.districtItemTextSel]}>
                  {item}
                </Text>
                {selectedDistrict === item && <MaterialIcons name="check" size={18} color="#1AAA94" />}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  headerTitle: { fontSize: 24, fontWeight: '900', color: '#1AAA94' },
  headerSubtitle: { fontSize: 13, color: '#888', marginTop: 2 },
  body: { flex: 1, paddingHorizontal: 20 },
  greetCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF8FA', borderRadius: 12, padding: 14, marginTop: 16, marginBottom: 4, borderWidth: 1, borderColor: '#FCE4EC' },
  greetText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },
  greetName: { fontWeight: '800', color: '#1AAA94' },
  label: { fontSize: 15, fontWeight: '800', color: '#111', marginTop: 20, marginBottom: 1 },
  labelKn: { fontSize: 12, color: '#888', marginBottom: 10 },
  districtBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: '#1AAA94', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#F8FBFF' },
  districtBtnText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1AAA94' },
  loadingCats: { fontSize: 13, color: '#999', marginBottom: 16 },
  catsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: '#E0E0E0', backgroundColor: '#fff' },
  catChipSelected: { backgroundColor: '#1AAA94', borderColor: '#1AAA94' },
  catChipText: { fontSize: 13, fontWeight: '600', color: '#555' },
  catChipTextSelected: { color: '#fff' },
  saveBtn: { backgroundColor: '#E91E8C', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  saveBtnDisabled: { backgroundColor: '#F8BBD0' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  skipBtn: { alignItems: 'center', paddingVertical: 8, marginBottom: 4 },
  skipText: { color: '#999', fontSize: 14 },
  pickerSafe: { flex: 1, backgroundColor: '#fff' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  districtItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  districtItemSel: { backgroundColor: '#E6F7F3' },
  districtItemText: { flex: 1, fontSize: 15, color: '#333' },
  districtItemTextSel: { fontWeight: '700', color: '#1AAA94' },
});
