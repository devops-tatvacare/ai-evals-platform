/**
 * App Types & Metadata
 * Central definitions for multi-app support
 */

export type AppId = 'voice-rx' | 'kaira-bot';

export interface AppMetadata {
  id: AppId;
  name: string;
  icon: string;
  description: string;
  searchPlaceholder: string;
  newItemLabel: string;
}

export const APPS: Record<AppId, AppMetadata> = {
  'voice-rx': {
    id: 'voice-rx',
    name: 'Voice Rx',
    icon: '/voice-rx-icon.jpeg',
    description: 'Audio file evaluation tool',
    searchPlaceholder: 'Search evaluations...',
    newItemLabel: 'New',
  },
  'kaira-bot': {
    id: 'kaira-bot',
    name: 'Kaira Bot',
    icon: '/kaira-icon.svg',
    description: 'Health chat bot assistant',
    searchPlaceholder: 'Search chats...',
    newItemLabel: 'New Chat',
  },
};

export const DEFAULT_APP: AppId = 'voice-rx';
