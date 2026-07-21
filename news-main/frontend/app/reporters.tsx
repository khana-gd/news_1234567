import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLanguage } from '../context/LanguageContext';

export default function ReportersScreen() {
  const { language } = useLanguage();
  const [followed, setFollowed] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('followed_reporters').then(val => {
        setFollowed(val ? JSON.parse(val) : []);
      }).catch(() => {});
    }, [])
  );

  const unfollow = async (name: string) => {
    Alert.alert(
      language === 'kn' ? 'ಅನುಸರಣೆ ರದ್ದು' : 'Unfollow',
      language === 'kn' ? `${name} ಅನುಸರಣೆ ರದ್ದು ಮಾಡಲೇ?` : `Stop following ${name}?`,
      [
        { text: language === 'kn' ? 'ರದ್ದು' : 'Cancel', style: 'cancel' },
        {
          text: language === 'kn' ? 'ಹುಡಿ' : 'Unfollow',
          style: 'destructive',
          onPress: async () => {
            const updated = followed.filter(r => r !== name);
            setFollowed(updated);
            await AsyncStorage.setItem('followed_reporters', JSON.stringify(updated));
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#DDE8F8', '#EBE4F9', '#F5F0FF', '#FAFAFA']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={s.safe} edges={['top']}>
        <StatusBar backgroundColor="transparent" translucent barStyle="dark-content" />

        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#1AAA94" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>
            {language === 'kn' ? 'ವರದಿಗಾರರು ಮತ್ತು ಅನುಸರುಗಳು' : 'Reporters & Following'}
          </Text>
          <Ionicons name="people-outline" size={24} color="#1AAA94" />
        </View>

        {followed.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="person-add-outline" size={72} color="#D0D8EC" />
            <Text style={s.emptyTitle}>
              {language === 'kn' ? 'ಇನ್ನೂ ಯಾರನೂ ಅನುಸರಿಸುತ್ತಿಲ್ಲ' : 'Not following anyone yet'}
            </Text>
            <Text style={s.emptyDesc}>
              {language === 'kn'
                ? 'ಸುದ್ದಿ ಕಾರ್ಡ್ಗಳಲ್ಲಿ ಯಾವುದೇ ವರದಿಗಾರರ ಪಕ್ಕದ + ಚಿಕ್ಕನ ಗುಂಡಿ ಅನುಸರಿಸಿ'
                : 'Tap the + button next to a reporter’s name on any news card to follow them.'}
            </Text>
            <TouchableOpacity style={s.goHomeBtn} onPress={() => router.replace('/(tabs)')}>
              <Text style={s.goHomeBtnText}>
                {language === 'kn' ? 'ಮನೆ ಪುಟಕ್ಕೆ ಹೋಗಿ' : 'Browse News'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={followed}
            keyExtractor={item => item}
            contentContainerStyle={s.list}
            ListHeaderComponent={
              <Text style={s.listHeader}>
                {language === 'kn'
                  ? `${followed.length} ವರದಿಗಾರರನ್ನು ಅನುಸರಿಸುತ್ತಿದ್ದೀರಿ`
                  : `Following ${followed.length} reporter${followed.length > 1 ? 's' : ''}`}
              </Text>
            }
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={s.avatarWrap}>
                  <Ionicons name="person" size={22} color="#1AAA94" />
                </View>
                <Text style={s.reporterName}>{item}</Text>
                <TouchableOpacity style={s.unfollowBtn} onPress={() => unfollow(item)}>
                  <Ionicons name="person-remove-outline" size={14} color="#D32F2F" />
                  <Text style={s.unfollowText}>
                    {language === 'kn' ? 'ರದ್ದು' : 'Unfollow'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  backBtn: { padding: 2 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#1AAA94' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#333', textAlign: 'center' },
  emptyDesc: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 21 },
  goHomeBtn: { backgroundColor: '#1AAA94', borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  goHomeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { padding: 16, gap: 10 },
  listHeader: { fontSize: 13, color: '#888', marginBottom: 8 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)',
  },
  avatarWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E6F7F3', alignItems: 'center', justifyContent: 'center' },
  reporterName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#222' },
  unfollowBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#FFCDD2', backgroundColor: '#FFF8F8' },
  unfollowText: { color: '#D32F2F', fontSize: 12, fontWeight: '600' },
});
