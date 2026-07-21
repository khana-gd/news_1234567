import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Animated, StyleSheet, Image,
  ScrollView, Linking, Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useLanguage } from '../context/LanguageContext';
import { Category } from '../utils/api';
import { BRAND } from '../constants/theme';

const SIDEBAR_WIDTH = 280;
const { height: SCREEN_H } = Dimensions.get('window');

const SUBMIT_NEWS_URL = 'https://mypublicsamachar.com/submit-story/';

interface SidebarMenuProps {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onCategorySelect: (catId: number | null) => void;
}

export default function SidebarMenu({
  visible, categories, onClose, onCategorySelect,
}: SidebarMenuProps) {
  const { language } = useLanguage();
  const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(overlayAnim, { toValue: 0.55, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -SIDEBAR_WIDTH, duration: 220, useNativeDriver: true }),
        Animated.timing(overlayAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  // @ts-ignore _value is fine for early-render skip
  if (!visible && slideAnim._value === -SIDEBAR_WIDTH) return null;

  const menuItems = [
    { id: null, name: language === 'kn' ? 'ಮನೆ (ಎಲ್ಲ ಸುದ್ದಿ)' : 'Home (All News)', icon: 'home' as const },
    ...categories
      .filter(c => c.slug !== 'uncategorized' && c.count > 0)
      .slice(0, 14)
      .map(c => ({ id: c.id, name: c.name, icon: 'article' as const })),
  ];

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      <Animated.View
        style={[styles.overlay, { opacity: overlayAnim }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      </Animated.View>

      <Animated.View style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}>
        {/* Drawer Header — REAL LOGO */}
        <View style={styles.drawerHeader}>
          <View style={styles.drawerBrandRow}>
            <Image
              source={require('../assets/images/logo.png')}
              style={styles.drawerLogoImg}
              resizeMode="contain"
            />
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.drawerBrandName}>My Public</Text>
              <Text style={styles.drawerBrandName}>Samachara</Text>
              <Text style={styles.drawerTagline}>Karnataka&apos;s Voice</Text>
            </View>
          </View>
          <TouchableOpacity testID="sidebar-close-btn" onPress={onClose} style={styles.drawerCloseBtn}>
            <MaterialIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.drawerBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>
            {language === 'kn' ? 'ವಿಭಾಗಗಳು' : 'Categories'}
          </Text>

          {menuItems.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              testID={`sidebar-menu-item-${idx}`}
              style={styles.menuItem}
              onPress={() => {
                onCategorySelect(item.id);
                router.push('/');
                onClose();
              }}
              activeOpacity={0.75}
            >
              <MaterialIcons name={item.icon} size={18} color={BRAND.primary} />
              <Text style={styles.menuItemText}>{item.name}</Text>
              <MaterialIcons name="chevron-right" size={16} color="#ccc" />
            </TouchableOpacity>
          ))}

          <View style={styles.divider} />

          {/* App / Account section */}
          <Text style={styles.sectionLabel}>
            {language === 'kn' ? 'ಆಪ್' : 'App'}
          </Text>

          <TouchableOpacity
            testID="sidebar-settings-btn"
            style={styles.menuItem}
            onPress={() => { onClose(); router.push('/(tabs)/user'); }}
            activeOpacity={0.75}
          >
            <MaterialIcons name="settings" size={18} color={BRAND.primary} />
            <Text style={styles.menuItemText}>{language === 'kn' ? 'ಸೆಟ್ಟಿಂಗ್ಸ್' : 'Settings'}</Text>
            <MaterialIcons name="chevron-right" size={16} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity
            testID="sidebar-preferences-btn"
            style={styles.menuItem}
            onPress={() => { onClose(); router.push('/preferences'); }}
            activeOpacity={0.75}
          >
            <MaterialIcons name="tune" size={18} color={BRAND.primary} />
            <Text style={styles.menuItemText}>{language === 'kn' ? 'ಆದ್ಯತೆಗಳು' : 'Preferences'}</Text>
            <MaterialIcons name="chevron-right" size={16} color="#ccc" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            testID="sidebar-submit-btn"
            style={styles.submitNewsBtn}
            onPress={() => { Linking.openURL(SUBMIT_NEWS_URL); onClose(); }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="edit" size={20} color="#fff" />
            <Text style={styles.submitNewsBtnText}>
              {language === 'kn' ? 'ಸುದ್ದಿ ಸಲ್ಲಿಸಿ' : 'Submit News'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="sidebar-youtube-btn"
            style={styles.ytBtn}
            onPress={() => { Linking.openURL('https://www.youtube.com/@MyPublicSamachar'); onClose(); }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="play-circle-filled" size={20} color="#FF0000" />
            <Text style={styles.ytBtnText}>
              {language === 'kn' ? 'ಯೂಟ್ಯೂಬ್ ಚಾನೆಲ್' : 'YouTube Channel'}
            </Text>
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  drawer: {
    position: 'absolute',
    top: 0, left: 0,
    width: SIDEBAR_WIDTH,
    height: SCREEN_H,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 12,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingTop: 50,
    backgroundColor: BRAND.primary,
  },
  drawerBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  drawerLogoImg: { width: 46, height: 46, borderRadius: 10 },
  drawerBrandName: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 17 },
  drawerTagline: { color: 'rgba(255,255,255,0.85)', fontSize: 10, marginTop: 2 },
  drawerCloseBtn: { padding: 4 },
  drawerBody: { flex: 1 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#999',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  menuItemText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#222' },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: 12, marginHorizontal: 16 },
  submitNewsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: BRAND.accent,
    marginHorizontal: 16, borderRadius: 12, paddingVertical: 13, marginBottom: 10,
  },
  submitNewsBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  ytBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFF3F3', borderWidth: 1, borderColor: '#FFCDD2',
    marginHorizontal: 16, borderRadius: 12, paddingVertical: 12,
  },
  ytBtnText: { color: '#D32F2F', fontWeight: '700', fontSize: 14 },
});
