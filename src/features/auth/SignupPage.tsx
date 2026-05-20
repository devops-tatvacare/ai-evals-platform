import { useState, useEffect, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Eye, EyeOff, Loader2, Lock, Mail, User as UserIcon } from 'lucide-react';
import {
  Alert,
  AuroraBackdrop,
  BrandMark,
  Button,
  GradientText,
  Input,
  PasswordStrengthIndicator,
  validatePasswordStrength,
} from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/services/api/authApi';
import { ApiError } from '@/services/api/apiError';
import { firstAccessibleRoute, routes } from '@/config/routes';
import { describeAuthError } from './authErrors';
import type { ValidateInviteResult } from '@/types/auth.types';

const PRIVACY_URL = '#';
const TERMS_URL = '#';
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 38, mass: 0.9 };

function isEmailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (!allowedDomains.length) return true;
  const lower = email.trim().toLowerCase();
  return allowedDomains.some((d) => lower.endsWith(d.toLowerCase()));
}

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('invite') ?? '';
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();

  const [isValidating, setIsValidating] = useState(true);
  const [inviteInfo, setInviteInfo] = useState<ValidateInviteResult | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [duplicateEmail, setDuplicateEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allowedDomains = inviteInfo?.allowedDomains ?? [];

  useEffect(() => {
    if (!token) {
      setIsValidating(false);
      return;
    }
    authApi
      .validateInvite(token)
      .then((result) => {
        setInviteInfo(result);
        setIsValidating(false);
      })
      .catch(() => {
        setIsValidating(false);
      });
  }, [token]);

  const emailTrimmed = email.trim();
  const emailDomainValid = !emailTrimmed || isEmailDomainAllowed(email, allowedDomains);
  const { valid: passwordStrong } = validatePasswordStrength(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const canSubmit =
    emailTrimmed.length > 0 &&
    displayName.trim().length > 0 &&
    passwordStrong &&
    passwordsMatch &&
    emailDomainValid &&
    !isSubmitting;

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError('');
    setDuplicateEmail(false);
    try {
      const result = await authApi.signup({
        token,
        email: emailTrimmed,
        password,
        displayName: displayName.trim(),
      });
      useAuthStore.getState().setAccessToken(result.accessToken);
      await useAuthStore.getState().loadUser();
      const user = useAuthStore.getState().user;
      navigate(firstAccessibleRoute(user?.appAccess ?? []));
    } catch (err) {
      if (err instanceof ApiError && /already exists/i.test(err.message)) {
        setDuplicateEmail(true);
      }
      setError(describeAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const fade = prefersReducedMotion
    ? { initial: false as const }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: SPRING };

  const rightPanelFade = prefersReducedMotion
    ? { initial: false as const }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING, delay: 0.06 } };

  const isInvalid = !isValidating && (!token || !inviteInfo?.valid);
  const emailPlaceholder = allowedDomains[0] ? `you@${allowedDomains[0].replace(/^@/, '')}` : 'you@company.com';

  return (
    <div data-theme="dark" className="relative min-h-screen overflow-hidden bg-[var(--login-backdrop-bg)]">
      <AuroraBackdrop />

      <div className="relative z-[var(--z-base)] grid min-h-screen grid-cols-1 md:grid-cols-[1.15fr_1fr]">
        <motion.section
          {...fade}
          className="relative flex flex-col justify-between px-6 py-8 md:px-12 md:py-12"
        >
          <div className="flex items-center gap-3">
            <BrandMark size="lg" src="/tatva_logo.jpeg" alt="TatvaCare" />
            <span className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] md:text-[18px]">
              TatvaCare <span className="mx-1 text-[var(--text-muted)] font-normal">·</span> AI Platform
            </span>
          </div>

          <div className="mt-14 md:mt-0">
            <p className="mb-4 inline-block text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Join your team
            </p>
            <h1 className="max-w-[22ch] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text-primary)] md:text-[32px]">
              Create your account and start <GradientText>operating</GradientText> AI with your team.
            </h1>
            <p className="mt-4 max-w-[46ch] text-[14px] leading-[1.6] text-[var(--text-muted)]">
              {inviteInfo?.valid && inviteInfo.tenantName
                ? `You've been invited to join ${inviteInfo.tenantName}.`
                : 'One platform for evaluations, agentic workflows, and analytics across every team.'}
            </p>
          </div>

          <FooterLine className="mt-10" />
        </motion.section>

        <motion.section
          {...rightPanelFade}
          className="relative flex flex-col justify-center border-t border-[var(--border-subtle)] bg-[var(--login-panel-bg)] px-6 py-10 backdrop-blur-md md:border-l md:border-t-0 md:px-12 md:py-12"
        >
          <div className="mx-auto w-full max-w-[400px]">
            {isValidating && <ValidatingState />}

            {isInvalid && <InvalidInviteState />}

            {!isValidating && inviteInfo?.valid && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <h2 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text-primary)] md:text-[26px]">
                    Create your account
                  </h2>
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
                    Joining{' '}
                    <span className="font-medium text-[var(--text-primary)]">
                      {inviteInfo.tenantName}
                    </span>
                    {inviteInfo.roleName && (
                      <>
                        {' '}as{' '}
                        <span className="font-medium text-[var(--text-primary)]">
                          {inviteInfo.roleName}
                        </span>
                      </>
                    )}
                    .
                  </p>
                </div>

                <AnimatePresence initial={false}>
                  {error && (
                    <motion.div
                      initial={prefersReducedMotion ? false : { opacity: 0, height: 0, y: -4 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0, y: -4 }}
                      transition={SPRING}
                      className="overflow-hidden"
                    >
                      <Alert variant="error">
                        {error}
                        {duplicateEmail && (
                          <>
                            {' '}
                            <Link to={routes.login} className="font-medium underline">
                              Sign in
                            </Link>
                          </>
                        )}
                      </Alert>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="signup-name" className="sr-only">
                      Full name
                    </label>
                    <Input
                      id="signup-name"
                      type="text"
                      required
                      autoFocus
                      autoComplete="name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Full name"
                      disabled={isSubmitting}
                      icon={<UserIcon className="h-4 w-4" />}
                    />
                  </div>

                  <div>
                    <label htmlFor="signup-email" className="sr-only">
                      Email
                    </label>
                    <Input
                      id="signup-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (duplicateEmail) {
                          setDuplicateEmail(false);
                          setError('');
                        }
                      }}
                      placeholder={emailPlaceholder}
                      disabled={isSubmitting}
                      icon={<Mail className="h-4 w-4" />}
                    />
                    {allowedDomains.length > 0 && emailDomainValid && (
                      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                        Only {allowedDomains.join(', ')} emails are accepted
                      </p>
                    )}
                    {emailTrimmed && !emailDomainValid && (
                      <p className="mt-1.5 text-[11px] text-[var(--color-error)]">
                        Email must be from: {allowedDomains.join(', ')}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="signup-password" className="sr-only">
                      Password
                    </label>
                    <Input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      disabled={isSubmitting}
                      icon={<Lock className="h-4 w-4" />}
                      rightSlot={
                        <EyeToggle
                          shown={showPassword}
                          onToggle={() => setShowPassword((v) => !v)}
                          prefersReducedMotion={!!prefersReducedMotion}
                        />
                      }
                    />
                    <PasswordStrengthIndicator password={password} className="mt-2" />
                  </div>

                  <div>
                    <label htmlFor="signup-confirm" className="sr-only">
                      Confirm password
                    </label>
                    <Input
                      id="signup-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      disabled={isSubmitting}
                      icon={<Lock className="h-4 w-4" />}
                      rightSlot={
                        <EyeToggle
                          shown={showConfirm}
                          onToggle={() => setShowConfirm((v) => !v)}
                          prefersReducedMotion={!!prefersReducedMotion}
                        />
                      }
                    />
                    <AnimatePresence initial={false}>
                      {passwordsMismatch && (
                        <motion.p
                          key="mismatch"
                          initial={prefersReducedMotion ? false : { opacity: 0, y: -2 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -2 }}
                          transition={SPRING}
                          className="mt-1.5 text-[11px] text-[var(--color-error)]"
                        >
                          Passwords do not match
                        </motion.p>
                      )}
                      {passwordsMatch && (
                        <motion.p
                          key="match"
                          initial={prefersReducedMotion ? false : { opacity: 0, y: -2 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -2 }}
                          transition={SPRING}
                          className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--color-success)]"
                        >
                          <Check className="h-3 w-3" />
                          Passwords match
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <motion.div whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }} transition={SPRING}>
                  <Button
                    type="submit"
                    variant="primary-gradient"
                    size="lg"
                    disabled={!canSubmit}
                    isLoading={isSubmitting}
                    icon={isSubmitting ? undefined : ArrowRight}
                    className="w-full flex-row-reverse"
                  >
                    {isSubmitting ? 'Creating account…' : 'Create account'}
                  </Button>
                </motion.div>

                <p className="text-center text-[12px] text-[var(--text-muted)]">
                  Already have an account?{' '}
                  <Link to={routes.login} className="font-medium text-[var(--text-brand)] hover:underline">
                    Sign in
                  </Link>
                </p>
              </form>
            )}
          </div>
        </motion.section>
      </div>
    </div>
  );
}

interface EyeToggleProps {
  shown: boolean;
  onToggle: () => void;
  prefersReducedMotion: boolean;
}

function EyeToggle({ shown, onToggle, prefersReducedMotion }: EyeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      className="rounded-[var(--radius-default)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={shown ? 'eye-off' : 'eye'}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
          transition={prefersReducedMotion ? { duration: 0.1 } : SPRING}
          className="block"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function ValidatingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      <p className="text-[13px] text-[var(--text-muted)]">Validating your invite…</p>
    </div>
  );
}

function InvalidInviteState() {
  const navigate = useNavigate();
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text-primary)] md:text-[26px]">
          Invite link unavailable
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
          This link is invalid, has expired, or has reached its usage limit. Ask your admin to send a new invite.
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => navigate(routes.login)}
      >
        Go to sign in
      </Button>
    </div>
  );
}

interface FooterLineProps {
  className?: string;
}

function FooterLine({ className }: FooterLineProps) {
  const version = typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : null;
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.01em] text-[var(--text-muted)] ${className ?? ''}`.trim()}>
      <span>© {new Date().getFullYear()} TatvaCare</span>
      <Separator />
      <span>All rights reserved</span>
      {version && (
        <>
          <Separator />
          <span>v{version}</span>
        </>
      )}
      <Separator />
      <a href={PRIVACY_URL} className="transition-colors hover:text-[var(--text-primary)]">
        Privacy
      </a>
      <Separator />
      <a href={TERMS_URL} className="transition-colors hover:text-[var(--text-primary)]">
        Terms
      </a>
    </div>
  );
}

function Separator() {
  return <span aria-hidden="true" className="text-[var(--border-subtle)]">·</span>;
}
