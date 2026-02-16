/**
 * Notice Box Component
 * Parses and renders notice/alert boxes from Kaira responses
 * Composes using the Alert component internally
 *
 * Syntax: <notice type="..." tone="..." color="...">Message</notice>
 */

import { AlertCircle, Info, CheckCircle, AlertTriangle, type LucideIcon } from 'lucide-react';
import { Alert, type AlertVariant } from '@/components/ui';

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
 * Map notice tone to Alert variant
 */
function toneToVariant(tone: string): AlertVariant {
  switch (tone) {
    case 'success': return 'success';
    case 'warning': return 'warning';
    case 'error': return 'error';
    case 'info':
    default: return 'info';
  }
}

/**
 * Get custom icon override for notice tone (Alert has defaults, but we keep parity)
 */
function toneToIcon(tone: string): LucideIcon {
  switch (tone) {
    case 'success': return CheckCircle;
    case 'warning': return AlertTriangle;
    case 'error': return AlertCircle;
    case 'info':
    default: return Info;
  }
}

/**
 * Render a single notice using Alert
 */
function Notice({ notice }: { notice: NoticeData }) {
  const variant = toneToVariant(notice.tone);
  const icon = toneToIcon(notice.tone);

  return (
    <Alert
      variant={variant}
      icon={icon}
      className="mb-2 text-[12px]"
    >
      <span className="text-[12px] leading-relaxed font-medium">{notice.message}</span>
    </Alert>
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
