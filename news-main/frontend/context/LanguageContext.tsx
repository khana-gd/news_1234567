import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Language = 'en' | 'kn';

const translations = {
  en: {
    home: 'Home', search: 'Search', trending: 'Trending',
    video: 'Video', user: 'User',
    topStories: 'Top Stories', topNews: 'Top News',
    readMore: 'Read More', readFull: 'Read Full Article',
    report: 'Report', reportPost: 'Report Post',
    login: 'Login / Register', logout: 'Logout',
    submitPost: 'Submit News', titleLabel: 'Title', contentLabel: 'Content',
    pickImage: 'Pick Image', sending: 'Sending...', sent: 'Submitted!',
    language: 'Language', english: 'English', kannada: 'Kannada',
    noNews: 'No news found', loading: 'Loading...', error: 'Failed to load news',
    profile: 'Profile', loginRequired: 'Please login to submit news',
    categories: 'Categories', allNews: 'All', searchNews: 'Search News',
    searchPlaceholder: 'Search news...', trendingNews: 'Trending News',
    videoNews: 'Video News', watchVideo: 'Watch Video',
    reportReason: 'Why are you reporting this?',
    inappropriate: 'Inappropriate', spam: 'Spam',
    fake: 'Fake News', other: 'Other',
    cancel: 'Cancel', submit: 'Submit',
    noResults: 'No results found', tryAgain: 'Try Again',
    loggedIn: 'Logged In', loggedOut: 'Logged Out',
    submitNewsDesc: 'Submit a news story for review',
    loginDesc: 'Login as reporter to submit news',
    share: 'Share', bookmark: 'Bookmark',
    latestNews: 'Latest News', breakingNews: 'Breaking News',
    loadMore: 'Load More', by: 'By',
    settings: 'Settings', about: 'About App',
    appVersion: 'Version 1.0.0',
    titleRequired: 'Title is required',
    contentRequired: 'Content is required',
    submitSuccess: 'News submitted for review!',
    submitError: 'Failed to submit. Try again.',
    reportSuccess: 'Report submitted. Thank you!',
    featured: 'Featured',
    submitNews: 'Submit News',
    menu: 'Menu',
    reporters: 'Reporters',
  },
  kn: {
    home: 'ಮನೆ', search: 'ಹುಡುಕಿ', trending: 'ಟ್ರೆಂಡಿಂಗ್',
    video: 'ವಿಡಿಯೋ', user: 'ಬಳಕೆದಾರ',
    topStories: 'ಮುಖ್ಯ ಸುದ್ದಿಗಳು', topNews: 'ಮುಖ್ಯ ಸುದ್ದಿ',
    readMore: 'ಮತ್ತಷ್ಟು ಓದಿ', readFull: 'ಪೂರ್ಣ ಲೇಖನ ಓದಿ',
    report: 'ವರದಿ', reportPost: 'ಪೋಸ್ಟ್ ವರದಿ ಮಾಡಿ',
    login: 'ಲಾಗಿನ್ / ನೋಂದಾಯಿಸಿ', logout: 'ಲಾಗ್‌ಔಟ್',
    submitPost: 'ಸುದ್ದಿ ಸಲ್ಲಿಸಿ', titleLabel: 'ಶೀರ್ಷಿಕೆ', contentLabel: 'ವಿಷಯ',
    pickImage: 'ಚಿತ್ರ ಆಯ್ಕೆ ಮಾಡಿ', sending: 'ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ...', sent: 'ಸಲ್ಲಿಸಲಾಗಿದೆ!',
    language: 'ಭಾಷೆ', english: 'ಇಂಗ್ಲಿಷ್', kannada: 'ಕನ್ನಡ',
    noNews: 'ಸುದ್ದಿ ಕಂಡುಬಂದಿಲ್ಲ', loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...', error: 'ಸುದ್ದಿ ಲೋಡ್ ಆಗಲಿಲ್ಲ',
    profile: 'ಪ್ರೊಫೈಲ್', loginRequired: 'ಸುದ್ದಿ ಸಲ್ಲಿಸಲು ಲಾಗಿನ್ ಮಾಡಿ',
    categories: 'ವಿಭಾಗಗಳು', allNews: 'ಎಲ್ಲ', searchNews: 'ಸುದ್ದಿ ಹುಡುಕಿ',
    searchPlaceholder: 'ಸುದ್ದಿ ಹುಡುಕಿ...', trendingNews: 'ಟ್ರೆಂಡಿಂಗ್ ಸುದ್ದಿ',
    videoNews: 'ವಿಡಿಯೋ ಸುದ್ದಿ', watchVideo: 'ವಿಡಿಯೋ ನೋಡಿ',
    reportReason: 'ನೀವು ಏಕೆ ವರದಿ ಮಾಡುತ್ತಿದ್ದೀರಿ?',
    inappropriate: 'ಅನುಚಿತ', spam: 'ಸ್ಪ್ಯಾಮ್',
    fake: 'ಸುಳ್ಳು ಸುದ್ದಿ', other: 'ಇತರೆ',
    cancel: 'ರದ್ದು ಮಾಡಿ', submit: 'ಸಲ್ಲಿಸಿ',
    noResults: 'ಫಲಿತಾಂಶ ಕಂಡುಬಂದಿಲ್ಲ', tryAgain: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
    loggedIn: 'ಲಾಗ್ ಇನ್', loggedOut: 'ಲಾಗ್ ಔಟ್',
    submitNewsDesc: 'ಪರಿಶೀಲನೆಗಾಗಿ ಸುದ್ದಿ ಸಲ್ಲಿಸಿ',
    loginDesc: 'ಸುದ್ದಿ ಸಲ್ಲಿಸಲು ವರದಿಗಾರರಾಗಿ ಲಾಗಿನ್ ಮಾಡಿ',
    share: 'ಹಂಚಿಕೊಳ್ಳಿ', bookmark: 'ಬುಕ್‌ಮಾರ್ಕ್',
    latestNews: 'ತಾಜಾ ಸುದ್ದಿ', breakingNews: 'ಬ್ರೇಕಿಂಗ್ ನ್ಯೂಸ್',
    loadMore: 'ಮತ್ತಷ್ಟು ಲೋಡ್ ಮಾಡಿ', by: 'ಮೂಲ',
    settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು', about: 'ಅಪ್ಲಿಕೇಶನ್ ಬಗ್ಗೆ',
    appVersion: 'ಆವೃತ್ತಿ 1.0.0',
    titleRequired: 'ಶೀರ್ಷಿಕೆ ಅಗತ್ಯ',
    contentRequired: 'ವಿಷಯ ಅಗತ್ಯ',
    submitSuccess: 'ಸುದ್ದಿ ಪರಿಶೀಲನೆಗೆ ಸಲ್ಲಿಸಲಾಗಿದೆ!',
    submitError: 'ಸಲ್ಲಿಕೆ ವಿಫಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    reportSuccess: 'ವರದಿ ಸಲ್ಲಿಸಲಾಗಿದೆ. ಧನ್ಯವಾದ!',
    featured: 'ವಿಶೇಷ',
    submitNews: 'ಸುದ್ದಿ ಸಲ್ಲಿಸಿ',
    menu: 'ಮೆನು',
    reporters: 'ವರದಿಗಾರರು',
  },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof translations['en']) => string;
  languageCategoryId: number | null;
  detectLanguageCategory: (categories: any[]) => void;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key as string,
  languageCategoryId: null,
  detectLanguageCategory: () => {},
});

export const useLanguage = () => useContext(LanguageContext);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  const [languageCategoryId, setLanguageCategoryId] = useState<number | null>(null);
  const [allCategories, setAllCategories] = useState<any[]>([]);

  useEffect(() => {
    AsyncStorage.getItem('app_language').then(saved => {
      if (saved === 'en' || saved === 'kn') setLanguageState(saved);
    });
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    AsyncStorage.setItem('app_language', lang);
    if (allCategories.length > 0) {
      findCategoryForLanguage(lang, allCategories);
    }
  }, [allCategories]);

  const findCategoryForLanguage = (lang: Language, _cats: any[]) => {
    // Karnataka (ID 19) = the correct Kannada language category, verified from WordPress API
    setLanguageCategoryId(lang === 'kn' ? 19 : null);
  };

  const detectLanguageCategory = useCallback((categories: any[]) => {
    setAllCategories(categories);
    findCategoryForLanguage(language, categories);
  }, [language]);

  const t = (key: keyof typeof translations['en']): string => {
    return translations[language][key] || translations['en'][key] || String(key);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, languageCategoryId, detectLanguageCategory }}>
      {children}
    </LanguageContext.Provider>
  );
}
