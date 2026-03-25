import { ru } from '@/i18n/ru';

export type Dictionary = typeof ru;

export const dict = ru;

export function t(path: string): string {
  const parts = path.split('.');
  let cur: any = dict;
  for (const p of parts) cur = cur?.[p];
  return typeof cur === 'string' ? cur : path;
}

