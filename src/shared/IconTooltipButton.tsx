import { useId, type ButtonHTMLAttributes } from 'react';

type IconTooltipButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'aria-describedby' | 'title'
> & {
  label: string;
  tooltipTitle: string;
  tooltipDescription: string;
  tooltipId?: string;
  tooltipPlacement?: 'top' | 'bottom';
  anchorClassName?: string;
};

export function IconTooltipButton({
  label,
  tooltipTitle,
  tooltipDescription,
  tooltipId,
  tooltipPlacement = 'bottom',
  anchorClassName = '',
  className = 'icon-btn',
  type = 'button',
  children,
  ...buttonProps
}: IconTooltipButtonProps) {
  const generatedId = useId();
  const descriptionId = tooltipId ?? generatedId;

  return (
    <span className={`tooltip-anchor ${anchorClassName}`.trim()}>
      <button {...buttonProps} type={type} className={className}
        aria-label={label} aria-describedby={descriptionId}>
        {children}
      </button>
      <span id={descriptionId} role="tooltip"
        className={`tooltip-content tooltip-content-${tooltipPlacement}`}>
        <span className="tooltip-card">
          <span className="tooltip-title">{tooltipTitle}</span>
          <span className="tooltip-description">{tooltipDescription}</span>
        </span>
      </span>
    </span>
  );
}
