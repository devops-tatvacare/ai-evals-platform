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
  return content.replace(NOTICE_REGEX, '').trim();
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
  // Use custom color if provided
  if (color && color.startsWith('#')) {
    return {
      bg: 'bg-[var(--notice-bg)]',
      border: 'border-[var(--notice-border)]',
      text: 'text-[var(--text-primary)]',
      icon: 'text-[var(--notice-icon)]',
      style: {
        '--notice-bg': `${color}20`,
        '--notice-border': color,
        '--notice-icon': color,
      } as React.CSSProperties,
    };
  }

  // Default tone-based colors
  switch (tone) {
    case 'success':
      return {
        bg: 'bg-green-50 dark:bg-green-950/20',
        border: 'border-green-300 dark:border-green-700',
        text: 'text-green-900 dark:text-green-100',
        icon: 'text-green-600 dark:text-green-400',
      };
    case 'warning':
      return {
        bg: 'bg-amber-50 dark:bg-amber-950/20',
        border: 'border-amber-300 dark:border-amber-700',
        text: 'text-amber-900 dark:text-amber-100',
        icon: 'text-amber-600 dark:text-amber-400',
      };
    case 'error':
      return {
        bg: 'bg-red-50 dark:bg-red-950/20',
        border: 'border-red-300 dark:border-red-700',
        text: 'text-red-900 dark:text-red-100',
        icon: 'text-red-600 dark:text-red-400',
      };
    case 'info':
    default:
      return {
        bg: 'bg-blue-50 dark:bg-blue-950/20',
        border: 'border-blue-300 dark:border-blue-700',
        text: 'text-blue-900 dark:text-blue-100',
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
        'flex items-start gap-3 px-4 py-3 rounded-lg border mb-3',
        colors.bg,
        colors.border
      )}
      style={colors.style}
    >
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', colors.icon)} />
      <p className={cn('text-[13px] leading-relaxed', colors.text)}>
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
