import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedTextInputProps = TextInputProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedTextInput({ style, lightColor, darkColor, ...props }: ThemedTextInputProps) {
  const textColor = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const bg = useThemeColor({}, 'background');

  return (
    <TextInput
      {...props}
      style={[styles.input, { color: textColor, backgroundColor: bg }, style]}
      placeholderTextColor={props.placeholderTextColor ?? '#9BA1A6'}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: '#99999955',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});

