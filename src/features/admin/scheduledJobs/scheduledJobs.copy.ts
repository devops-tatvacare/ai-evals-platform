/**
 * User-visible copy for the scheduled-jobs notifications section.
 * All strings live here so review + tone changes never touch JSX.
 */
export const notificationsCopy = {
  sectionTitle: 'Notifications',
  sectionSubtitle: 'Email recipients when this scheduled job fails.',
  ownerCheckboxLabel: 'Email me when this job fails',
  ownerHelpNoEmail:
    'The job creator does not have an email on file. Save again from this account to capture it.',
  extraEmailsLabel: 'Also notify',
  extraEmailsHelp: 'Up to 10 addresses. Domains must be allowed by tenant settings.',
  emailChipPlaceholder: 'Add another email…',
  errorInvalidEmail: 'Enter a valid email address.',
  errorTooMany: 'Limit reached — remove an entry to add another.',
  warningDomainNotAllowed: 'Domain may not be allowed — server will verify on submit.',
};
