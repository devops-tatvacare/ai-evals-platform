/**
 * User-visible copy for the admin notifications surface.
 * Group/event/status labels reuse `emailSettingsCopy` to stay DRY.
 */
export const adminNotificationsCopy = {
  adminTitle: 'Notifications',
  adminSubtitle: 'Defaults, subscribers, and the send log for everyone in this workspace.',

  tab: {
    defaults: 'Defaults',
    subscribers: 'Subscribers',
    sendLog: 'Send log',
  },

  defaults: {
    requiredLabel: 'Required for all users',
    requiredHelp:
      'Every user will receive this notification. Locks the toggle on the user-side screen.',
    alwaysNotifyLabel: 'Always also notify',
    alwaysNotifyHelp:
      'Extra addresses (shared inboxes, oncall) that always receive this event.',
    save: 'Save changes',
    loading: 'Loading defaults…',
    loadFailed: 'Could not load notification defaults.',
    saveFailed: 'Could not save default.',
    fanOutWarning:
      'Default saved, but some users could not be subscribed automatically.',
  },

  subscribers: {
    columns: {
      user: 'User',
      event: 'Notification',
      active: 'Active',
      required: 'Required',
      created: 'Added',
      actions: '',
    },
    requiredBadge: 'Required',
    action: {
      delete: 'Remove subscription',
      cancel: 'Cancel',
      requiredToggle: 'Required',
      promoteRequiredTitle: 'Make this subscription required?',
      promoteRequiredBody:
        'The user will no longer be able to unsubscribe from this notification. Confirm the escalation.',
      promoteRequiredConfirm: 'Make required',
      demoteRequiredTitle: 'Drop the required flag?',
      demoteRequiredBody:
        'The user will be able to unsubscribe from this notification again.',
      demoteRequiredConfirm: 'Drop required',
    },
    confirmDelete:
      'Remove this subscription? The user can re-enable it from their own settings.',
    empty: 'No subscriptions match these filters.',
    loadFailed: 'Could not load subscribers.',
    updated: 'Subscription updated.',
    removed: 'Subscription removed.',
    updateFailed: 'Could not update this subscription.',
    removeFailed: 'Could not remove this subscription.',
    filters: {
      event: 'Notification',
      active: 'Status',
      activeYes: 'Active',
      activeNo: 'Muted',
      allEvents: 'All notifications',
      allStatuses: 'All',
    },
  },

  sendLog: {
    columns: {
      sentAt: 'Time',
      recipient: 'Recipient',
      event: 'Notification',
      status: 'Status',
      correlation: 'Linked to',
      subject: 'Subject',
    },
    empty: 'No emails matching these filters.',
    loadFailed: 'Could not load the send log.',
    filters: {
      status: 'Status',
      event: 'Notification',
      recipient: 'Recipient contains…',
      fromDate: 'From',
      toDate: 'To',
      allStatuses: 'All',
      allEvents: 'All',
    },
    exportCsv: 'Export CSV',
    exportFailed: 'Could not export the send log.',
    preview: {
      title: 'Email preview',
      openLabel: 'View email',
      cancel: 'Close',
      loading: 'Loading preview…',
      loadFailed: 'Could not load this email.',
      noHtml:
        'No rendered HTML on this row. Older sends were logged before the preview cache shipped.',
      providerResponseHeading: 'Provider response',
      errorHeading: 'Error',
    },
  },

  toast: {
    defaultsUpdated: 'Default updated.',
    subscriptionUpdated: 'Subscription updated.',
    subscriptionRemoved: 'Subscription removed.',
  },
} as const;
