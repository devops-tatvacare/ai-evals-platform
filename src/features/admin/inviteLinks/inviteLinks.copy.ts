/**
 * All user-visible copy for the invite-link create slide-over + list columns.
 * No inline strings in components.
 */
import { notificationService } from '@/services/notifications';
import type { InviteEmailStatus } from '@/services/api/adminApi';

export const inviteLinksCopy = {
  // Slide-over chrome
  slideOverTitle: 'Generate invite link',

  // Form field labels + placeholders + help text
  fields: {
    role: {
      label: 'Role',
      placeholder: 'Select a role',
    },
    label: {
      label: 'Label',
      placeholder: 'e.g., Q3 contractors',
      help: 'Visible to admins only. Helps track who you sent this link to.',
    },
    expiresIn: { label: 'Expires in' },
    maxUses: {
      label: 'Max uses',
      placeholder: 'Unlimited',
      help: 'Optional. Caps how many people can redeem this link.',
    },
    recipientEmail: {
      label: 'Email to (optional)',
      placeholder: 'recipient@company.com',
      help: 'Sends the invite to this address as a branded email. Leave empty to copy the link manually.',
    },
    userName: {
      label: 'Recipient name (optional)',
      placeholder: 'Jane Doe',
      help: 'Used in the email greeting. Defaults to the email local part.',
    },
  },

  // Action buttons
  buttons: {
    cancel: 'Cancel',
    submit: 'Generate invite link',
    submitting: 'Generating…',
  },

  // List column headers
  columns: {
    sentTo: 'Sent to',
    lastSendStatus: 'Last send',
  },

  // Toast strings keyed by emailStatus
  toasts: {
    sent: 'Invite link emailed.',
    linkCopied: 'Invite link copied to clipboard.',
    notConfigured:
      'Email is not configured. Link copied — share it manually.',
    recipientRejected:
      'That email domain is not allowed for this tenant. Link copied for manual sharing.',
    sendFailed:
      'Email could not be sent. Link copied — share it manually.',
    domainWarning: 'Domain may not be allowed — server will verify on submit.',
  },
};

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // No fallback toast here — the calling toast already tells the user.
  }
}

// Toast + clipboard reaction for each emailStatus branch.
export async function handleEmailStatusToast(
  status: InviteEmailStatus,
  inviteUrl: string,
): Promise<void> {
  switch (status) {
    case 'sent':
      notificationService.success(inviteLinksCopy.toasts.sent);
      return;
    case 'not_requested':
      await copyToClipboard(inviteUrl);
      notificationService.success(inviteLinksCopy.toasts.linkCopied);
      return;
    case 'not_configured':
      await copyToClipboard(inviteUrl);
      notificationService.warning(inviteLinksCopy.toasts.notConfigured);
      return;
    case 'recipient_rejected':
      await copyToClipboard(inviteUrl);
      notificationService.error(inviteLinksCopy.toasts.recipientRejected);
      return;
    case 'failed':
      await copyToClipboard(inviteUrl);
      notificationService.error(inviteLinksCopy.toasts.sendFailed);
      return;
  }
}
