/**
 * NewsCardSkeleton — shimmering placeholder while news posts load
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

export function NewsCardSkeleton() {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1100,
        useNativeDriver: false,
      })
    ).start();
  }, []);

  const bg = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['#EEEEEE', '#F5F5F5', '#EEEEEE'],
  });

  return (
    <View style={styles.row}>
      {[0, 1].map(i => (
        <View key={i} style={styles.card}>
          <Animated.View style={[styles.img, { backgroundColor: bg }]} />
          <View style={styles.body}>
            <Animated.View style={[styles.line, { backgroundColor: bg, width: '90%' }]} />
            <Animated.View style={[styles.line, { backgroundColor: bg, width: '60%', marginTop: 6 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function NewsCardSkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <View>
      {Array.from({ length: rows }).map((_, i) => (
        <NewsCardSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', elevation: 1 },
  img: { width: '100%', height: 110 },
  body: { padding: 8, minHeight: 60 },
  line: { height: 10, borderRadius: 4 },
});
