/**
 * User-visible copy for the Notifications settings tab. All strings live here
 * so tone/copy edits never touch JSX.
 *
 * Adding a new event type = add the enum on the backend + add a label here
 * + add a backend EVENT_GROUP entry. Two FE places, never more.
 *
 * Event labels are deliberately neutral (no first person) because the same
 * map is rendered on the user-facing tab AND the admin tables/filters.
 */
export const emailSettingsCopy = {
  tabLabel: 'Notifications',
  subtitle: 'Choose which platform emails reach you, and the address they go to.',

  recipientLabel: 'Send emails to',
  recipientHint:
    'Defaults to your account email. Changing this updates every notification you receive.',

  notificationsHeader: 'Email me when',

  recentSendsHeader: 'Recent activity',
  recentSendsSubtitle: 'The last 7 days of emails sent to you.',
  noActivity: 'No emails in the last 7 days.',

  requiredHint: 'Required by admin',

  error: {
    recipientInvalid: 'Enter a valid email address.',
    subscriptionLocked: 'This notification is required by your admin and cannot be changed.',
    listFailed: 'Could not load your notification settings.',
    recentSendsFailed: 'Could not load recent activity.',
  },

  groups: {
    scheduled_job: 'Scheduled jobs',
    workflow: 'Workflows',
  } as Record<string, string>,

  events: {
    'scheduled_job.failed': 'Scheduled job fails',
    'scheduled_job.completed': 'Scheduled job completes',
    'workflow_run.failed': 'Workflow run fails',
    'workflow_run.completed': 'Workflow run completes',
  } as Record<string, string>,

  columns: {
    sentAt: 'Time',
    subject: 'Subject',
    status: 'Status',
  },

  status: {
    sent: 'Sent',
    failed: 'Failed',
    bounced: 'Bounced',
    not_configured: 'Skipped — mail not configured',
  } as Record<string, string>,
} as const;
