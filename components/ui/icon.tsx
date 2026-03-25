import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type AppIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function AppIcon(props: ComponentProps<typeof MaterialCommunityIcons>) {
  return <MaterialCommunityIcons {...props} />;
}

