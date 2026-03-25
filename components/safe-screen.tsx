import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView, type ThemedViewProps } from '@/components/themed-view';

export function SafeScreen({ style, ...props }: ThemedViewProps) {
  const insets = useSafeAreaInsets();
  return <ThemedView {...props} style={[styles.base, { paddingTop: insets.top }, style]} />;
}

const styles = StyleSheet.create({
  base: { flex: 1 },
});

