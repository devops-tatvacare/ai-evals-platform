/**
 * Notice Box Component
 * Parses and renders notice/alert boxes from Kaira responses
 * 
 * Syntax: <notice type="..." tone="..." color="...">Message</notice>
 */

import { AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/utils';

interface NoticeData {
  type: string;
  tone: string;
  color: string;
  message: string;
}

interface NoticeBoxProps {
  content: string;
}

// Regex to match notice tags
const NOTICE_REGEX = /<notice\s+type="([^"]+)"\s+tone="([^"]+)"\s+color="([^"]+)"\s*>(.*?)<\/notice>/gs;

/**
 * Check if content contains notice boxes
 */
export function hasNotices(content: string): boolean {
  NOTICE_REGEX.lastIndex = 0;
  return NOTICE_REGEX.test(content);
}

/**
 * Remove notice boxes from content (for markdown rendering)
 */
export function removeNotices(content: string): string {
  // Remove notices and clean up extra whitespace/newlines
  return content
    .replace(NOTICE_REGEX, '')
    .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
    .trim();
}

/**
 * Extract notice boxes from content
 */
export function extractNotices(content: string): NoticeData[] {
  const notices: NoticeData[] = [];
  let match;
  
  NOTICE_REGEX.lastIndex = 0;
  while ((match = NOTICE_REGEX.exec(content)) !== null) {
    notices.push({
      type: match[1],
      tone: match[2],
      color: match[3],
      message: match[4].trim(),
    });
  }
  
  return notices;
}

/**
 * Get icon for notice type
 */
function getNoticeIcon(tone: string) {
  switch (tone) {
    case 'info':
      return Info;
    case 'success':
      return CheckCircle;
    case 'warning':
      return AlertTriangle;
    case 'error':
      return AlertCircle;
    default:
      return Info;
  }
}

/**
 * Get color classes for notice tone
 */
function getNoticeColors(tone: string, color?: string) {
  // Use custom color if provided (convert hex to RGB for better control)
  if (color && color.startsWith('#')) {
    // For custom colors, use a more subtle approach
    return {
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      border: 'border-amber-400 dark:border-amber-600',
      text: 'text-amber-950 dark:text-amber-50',
      icon: 'text-amber-600 dark:text-amber-400',
    };
  }

  // Default tone-based colors with better contrast
  switch (tone) {
    case 'success':
      return {
        bg: 'bg-green-50 dark:bg-green-950/30',
        border: 'border-green-400 dark:border-green-600',
        text: 'text-green-950 dark:text-green-50',
        icon: 'text-green-600 dark:text-green-400',
      };
    case 'warning':
      return {
        bg: 'bg-amber-50 dark:bg-amber-950/30',
        border: 'border-amber-400 dark:border-amber-600',
        text: 'text-amber-950 dark:text-amber-50',
        icon: 'text-amber-600 dark:text-amber-400',
      };
    case 'error':
      return {
        bg: 'bg-red-50 dark:bg-red-950/30',
        border: 'border-red-400 dark:border-red-600',
        text: 'text-red-950 dark:text-red-50',
        icon: 'text-red-600 dark:text-red-400',
      };
    case 'info':
    default:
      return {
        bg: 'bg-blue-50 dark:bg-blue-950/30',
        border: 'border-blue-400 dark:border-blue-600',
        text: 'text-blue-950 dark:text-blue-50',
        icon: 'text-blue-600 dark:text-blue-400',
      };
  }
}

/**
 * Render a single notice box
 */
function Notice({ notice }: { notice: NoticeData }) {
  const Icon = getNoticeIcon(notice.tone);
  const colors = getNoticeColors(notice.tone, notice.color);

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-2.5 py-2 rounded border-l-4 mb-2',
        colors.bg,
        colors.border
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', colors.icon)} />
      <p className={cn('text-[12px] leading-relaxed font-medium', colors.text)}>
        {notice.message}
      </p>
    </div>
  );
}

/**
 * Render notice boxes from content
 */
export function NoticeBox({ content }: NoticeBoxProps) {
  const notices = extractNotices(content);

  if (notices.length === 0) {
    return null;
  }

  return (
    <>
      {notices.map((notice, index) => (
        <Notice key={index} notice={notice} />
      ))}
    </>
  );
}
