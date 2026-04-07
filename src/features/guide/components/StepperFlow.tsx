interface Step {
  title: string;
  description: string;
}

interface StepperFlowProps {
  steps: Step[];
}

export default function StepperFlow({ steps }: StepperFlowProps) {
  return (
    <div className="my-4 flex flex-col items-start gap-0 sm:flex-row sm:items-center">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-0">
          <div className="flex min-w-[132px] flex-col items-center gap-2 sm:items-start">
            <div className="flex items-center gap-3">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: "var(--accent)", color: "var(--text-on-color)" }}
              >
                {i + 1}
              </div>
              <div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: "var(--text)" }}
                >
                  {step.title}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {step.description}
                </div>
              </div>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div
              className="hidden sm:block w-8 h-px mx-2 shrink-0"
              style={{ background: "var(--border)" }}
            />
          )}
          {i < steps.length - 1 && (
            <div
              className="sm:hidden w-px h-6 ml-4"
              style={{ background: "var(--border)" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
