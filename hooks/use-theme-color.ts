/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  // RN 0.83 widened ColorSchemeName to include 'unspecified'. Collapse anything
  // that isn't 'dark' to 'light' so we don't break indexing into Colors.
  const raw = useColorScheme();
  const theme: 'light' | 'dark' = raw === 'dark' ? 'dark' : 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}
