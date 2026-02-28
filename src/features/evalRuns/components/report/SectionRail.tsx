import { useSectionRail } from '../../hooks/useSectionRail';

interface SectionRailProps {
  pageKey: string;
}

export default function SectionRail({ pageKey }: SectionRailProps) {
  const { sections, activeId, scrollTo } = useSectionRail(
    pageKey,
    '.report-detailed-sections',
    '.run-detail-body',
  );

  if (sections.length < 2) return null;

  return (
    // Sticky wrapper: zero-height so it doesn't affect content flow.
    // Sticks at vertical center of the scroll container.
    <div className="section-rail hidden md:block sticky z-30 h-0" style={{ top: '50%' }}>
      <div
        className="absolute flex flex-col items-center gap-3"
        style={{ left: '-28px', transform: 'translateY(-50%)' }}
      >
        {/* Vertical line behind dots */}
        <div
          className="absolute"
          style={{
            width: '2px',
            top: '0',
            bottom: '0',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--border-subtle)',
            borderRadius: '1px',
          }}
        />

        {sections.map((section) => {
          const isActive = section.id === activeId;
          return (
            <div key={section.id} className="group relative flex items-center">
              <button
                onClick={() => scrollTo(section.id)}
                aria-label={`Scroll to ${section.title}`}
                className="relative z-10 rounded-full cursor-pointer transition-all duration-200"
                style={{
                  width: isActive ? '10px' : '8px',
                  height: isActive ? '10px' : '8px',
                  background: isActive
                    ? 'var(--interactive-primary)'
                    : 'var(--border-default)',
                  boxShadow: isActive
                    ? '0 0 0 4px color-mix(in srgb, var(--interactive-primary) 20%, transparent), 0 0 8px color-mix(in srgb, var(--interactive-primary) 15%, transparent)'
                    : 'none',
                  border: 'none',
                  padding: 0,
                }}
              />
              {/* Tooltip */}
              <div
                className="section-rail-tooltip pointer-events-none absolute left-6 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium"
                style={{
                  background: 'var(--bg-secondary)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  boxShadow: 'var(--shadow-md)',
                  opacity: 0,
                  transform: 'translateX(-4px)',
                  transition: 'opacity 150ms ease, transform 150ms ease',
                }}
              >
                {section.title}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
