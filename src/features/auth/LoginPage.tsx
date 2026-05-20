import { useState, type FormEventHandler } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import {
  Alert,
  AuroraBackdrop,
  BrandMark,
  Button,
  GradientText,
  Input,
} from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { firstAccessibleRoute } from '@/config/routes';
import { describeAuthError } from './authErrors';

const PRIVACY_URL = '#';
const TERMS_URL = '#';
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 38, mass: 0.9 };

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isLoading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsLoading(true);
    setError('');
    try {
      await login({ email, password });
      const user = useAuthStore.getState().user;
      navigate(firstAccessibleRoute(user?.appAccess ?? []));
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const fade = prefersReducedMotion
    ? { initial: false as const }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: SPRING };

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
              The AI operations control plane
            </p>
            <h1 className="max-w-[22ch] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text-primary)] md:text-[32px]">
              Evaluate, orchestrate, and <GradientText>operate</GradientText> AI in production.
            </h1>
            <p className="mt-4 max-w-[46ch] text-[14px] leading-[1.6] text-[var(--text-muted)]">
              One platform for evaluations, agentic workflows, and analytics across every team.
            </p>
          </div>

          <FooterLine className="mt-10" />
        </motion.section>

        <motion.section
          {...(prefersReducedMotion
            ? { initial: false as const }
            : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING, delay: 0.06 } })}
          className="relative flex flex-col justify-center border-t border-[var(--border-subtle)] bg-[var(--login-panel-bg)] px-6 py-10 backdrop-blur-md md:border-l md:border-t-0 md:px-12 md:py-12"
        >
          <form onSubmit={handleSubmit} className="mx-auto w-full max-w-[360px] space-y-5">
            <div>
              <h2 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text-primary)] md:text-[26px]">
                Welcome back
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
                Sign in to continue to the platform.
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
                  <Alert variant="error">{error}</Alert>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-3">
              <div>
                <label htmlFor="login-email" className="sr-only">
                  Email
                </label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  disabled={isLoading}
                  icon={<Mail className="h-4 w-4" />}
                />
              </div>

              <div>
                <label htmlFor="login-password" className="sr-only">
                  Password
                </label>
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  disabled={isLoading}
                  icon={<Lock className="h-4 w-4" />}
                  rightSlot={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="rounded-[var(--radius-default)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={showPassword ? 'eye-off' : 'eye'}
                          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                          transition={prefersReducedMotion ? { duration: 0.1 } : SPRING}
                          className="block"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </motion.span>
                      </AnimatePresence>
                    </button>
                  }
                />
              </div>
            </div>

            <motion.div whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }} transition={SPRING}>
              <Button
                type="submit"
                variant="primary-gradient"
                size="lg"
                disabled={!canSubmit}
                isLoading={isLoading}
                icon={isLoading ? undefined : ArrowRight}
                className="w-full flex-row-reverse"
              >
                {isLoading ? 'Signing in…' : 'Sign in'}
              </Button>
            </motion.div>
          </form>
        </motion.section>
      </div>
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
