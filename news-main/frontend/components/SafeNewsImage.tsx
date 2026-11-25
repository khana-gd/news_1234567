import React, { useState } from 'react';
import { View, Image, StyleSheet, ImageStyle, StyleProp } from 'react-native';

const BUNDLED_PLACEHOLDER = require('../assets/images/header-logo.png');

interface SafeNewsImageProps {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  testID?: string;
}

export default function SafeNewsImage({
  uri,
  style,
  resizeMode = 'cover',
  testID,
}: SafeNewsImageProps) {
  const [hasError, setHasError] = useState(false);

  const isValidUri =
    uri &&
    typeof uri === 'string' &&
    uri.trim().length > 0 &&
    !uri.endsWith('.svg') &&
    !uri.includes('fallback-thumb.svg');

  if (!isValidUri || hasError) {
    return (
      <View style={[styles.placeholderContainer, style]}>
        <Image
          source={BUNDLED_PLACEHOLDER}
          style={styles.placeholderLogo}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <Image
      testID={testID}
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setHasError(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholderContainer: {
    backgroundColor: '#0F2027',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  placeholderLogo: {
    width: '70%',
    height: '50%',
    opacity: 0.85,
  },
});
