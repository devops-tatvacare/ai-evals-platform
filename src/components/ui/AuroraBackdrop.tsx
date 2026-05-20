import { motion, useReducedMotion, useTime, useTransform } from 'framer-motion';
import { cn } from '@/utils';

interface AuroraBackdropProps {
  className?: string;
}

interface BlobConfig {
  color: string;
  base: { top: string; left: string };
  size: string;
  speedX: number;
  speedY: number;
  ampX: number;
  ampY: number;
  phaseX: number;
  phaseY: number;
  scaleSpeed: number;
  scaleAmp: number;
}

const BLOBS: BlobConfig[] = [
  {
    color: 'var(--login-aurora-primary)',
    base: { top: '-15%', left: '-10%' },
    size: 'h-[70vmax] w-[70vmax]',
    speedX: 0.00018,
    speedY: 0.00023,
    ampX: 80,
    ampY: 60,
    phaseX: 0,
    phaseY: 1.2,
    scaleSpeed: 0.00009,
    scaleAmp: 0.06,
  },
  {
    color: 'var(--login-aurora-secondary)',
    base: { top: '20%', left: '45%' },
    size: 'h-[75vmax] w-[75vmax]',
    speedX: 0.00012,
    speedY: 0.00017,
    ampX: 100,
    ampY: 70,
    phaseX: 2.1,
    phaseY: 0.7,
    scaleSpeed: 0.00011,
    scaleAmp: 0.08,
  },
  {
    color: 'var(--login-aurora-tertiary)',
    base: { top: '50%', left: '-5%' },
    size: 'h-[60vmax] w-[60vmax]',
    speedX: 0.00021,
    speedY: 0.00014,
    ampX: 90,
    ampY: 80,
    phaseX: 4.3,
    phaseY: 2.8,
    scaleSpeed: 0.00013,
    scaleAmp: 0.07,
  },
];

function Blob({ config, animated }: { config: BlobConfig; animated: boolean }) {
  const time = useTime();
  // Two-sine composition produces continuous, non-repeating organic drift.
  const x = useTransform(time, (t) =>
    animated
      ? Math.sin(t * config.speedX + config.phaseX) * config.ampX +
        Math.sin(t * config.speedX * 0.31 + config.phaseY) * (config.ampX * 0.25)
      : 0,
  );
  const y = useTransform(time, (t) =>
    animated
      ? Math.cos(t * config.speedY + config.phaseY) * config.ampY +
        Math.cos(t * config.speedY * 0.27 + config.phaseX) * (config.ampY * 0.25)
      : 0,
  );
  const scale = useTransform(time, (t) =>
    animated ? 1 + Math.sin(t * config.scaleSpeed + config.phaseX) * config.scaleAmp : 1,
  );
  return (
    <motion.div
      className={cn('absolute rounded-full will-change-transform', config.size)}
      style={{
        ...config.base,
        x,
        y,
        scale,
        backgroundImage: `radial-gradient(closest-side, ${config.color}, transparent 70%)`,
        filter: 'blur(70px)',
      }}
    />
  );
}

export function AuroraBackdrop({ className }: AuroraBackdropProps) {
  const prefersReducedMotion = useReducedMotion();
  const animated = !prefersReducedMotion;
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden bg-[var(--login-backdrop-bg)]',
        className,
      )}
    >
      {BLOBS.map((config, i) => (
        <Blob key={i} config={config} animated={animated} />
      ))}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            'linear-gradient(var(--login-grid-line) 1px, transparent 1px)',
            'linear-gradient(90deg, var(--login-grid-line) 1px, transparent 1px)',
          ].join(', '),
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse at center, #000 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, #000 30%, transparent 80%)',
        }}
      />
    </div>
  );
}
