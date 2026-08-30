import { useId, type ButtonHTMLAttributes } from 'react';

type IconTooltipButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'aria-describedby' | 'title'
> & {
  label: string;
  tooltipTitle: string;
  tooltipDescription: string;
  tooltipId?: string;
};

export function IconTooltipButton({
  label,
  tooltipTitle,
  tooltipDescription,
  tooltipId,
  className = 'icon-btn',
  type = 'button',
  children,
  ...buttonProps
}: IconTooltipButtonProps) {
  const generatedId = useId();
  const descriptionId = tooltipId ?? generatedId;

  return (
    <span className="tooltip-anchor">
      <button {...buttonProps} type={type} className={className}
        aria-label={label} aria-describedby={descriptionId}>
        {children}
      </button>
      <span id={descriptionId} role="tooltip" className="tooltip-content">
        <span className="tooltip-card">
          <span className="tooltip-title">{tooltipTitle}</span>
          <span className="tooltip-description">{tooltipDescription}</span>
        </span>
      </span>
    </span>
  );
}
