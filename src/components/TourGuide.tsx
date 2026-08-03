import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'ssh-manager-tour-done';

interface TourStep {
  target: string;
  title: string;
  content: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

const steps: TourStep[] = [
  {
    target: '[data-tour="sidebar"]',
    title: 'Connection Sidebar',
    content: 'Manage all your SSH connections here. Right-click to create groups, and organize connections by drag-and-drop or context menu.',
    placement: 'right',
  },
  {
    target: '[data-tour="new-connection"]',
    title: 'Add Connection',
    content: 'Click here to add a new SSH connection. Fill in the host, port, username, and authentication method.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="quick-connect"]',
    title: 'Quick Connect',
    content: 'Jump into a server quickly without saving the configuration. Perfect for one-time access.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="ai-toggle"]',
    title: 'AI Assistant',
    content: 'Toggle the AI sidebar for intelligent help. You can select text in the terminal and send it to AI for analysis.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="terminal-area"]',
    title: 'Terminal Workspace',
    content: 'This is where you interact with remote servers. Select text to send to AI, use Ctrl+C/V for copy/paste, and right-click for more options.',
    placement: 'left',
  },
  {
    target: '[data-tour="ai-sidebar"]',
    title: 'AI Chat',
    content: 'Configure your own API keys from OpenAI, Anthropic, Google, DeepSeek, or custom providers. The AI can read files, run commands, and help you troubleshoot.',
    placement: 'left',
  },
  {
    target: '[data-tour="sidebar-tree"]',
    title: 'File Browser',
    content: 'Right-click any connection and select "Open File Browser" to browse, upload, and download files — just like MobaXterm.',
    placement: 'right',
  },
  {
    target: '[data-tour="import-export"]',
    title: 'Import & Export',
    content: 'Backup or migrate your connections easily. Export to JSON and import on another machine.',
    placement: 'left',
  },
];

export function hasCompletedTour(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetTour() {
  localStorage.removeItem(STORAGE_KEY);
}

function getPlacementStyle(
  placement: TourStep['placement'],
  targetRect: DOMRect,
  tooltipW: number,
  tooltipH: number
): React.CSSProperties {
  const gap = 12;
  const style: React.CSSProperties = {};

  switch (placement) {
    case 'bottom':
      style.top = targetRect.bottom + gap + window.scrollY;
      style.left = targetRect.left + targetRect.width / 2 - tooltipW / 2 + window.scrollX;
      break;
    case 'top':
      style.top = targetRect.top - tooltipH - gap + window.scrollY;
      style.left = targetRect.left + targetRect.width / 2 - tooltipW / 2 + window.scrollX;
      break;
    case 'right':
      style.top = targetRect.top + targetRect.height / 2 - tooltipH / 2 + window.scrollY;
      style.left = targetRect.right + gap + window.scrollX;
      break;
    case 'left':
      style.top = targetRect.top + targetRect.height / 2 - tooltipH / 2 + window.scrollY;
      style.left = targetRect.left - tooltipW - gap + window.scrollX;
      break;
  }

  // Clamp to viewport
  const padding = 12;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  if (style.top !== undefined && style.top < padding) style.top = padding;
  if (style.top !== undefined && style.top + tooltipH > viewH - padding) style.top = viewH - tooltipH - padding;
  if (style.left !== undefined && style.left < padding) style.left = padding;
  if (style.left !== undefined && style.left + tooltipW > viewW - padding) style.left = viewW - tooltipW - padding;

  return style;
}

function getArrowStyle(placement: TourStep['placement']): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    border: '8px solid transparent',
  };

  switch (placement) {
    case 'bottom':
      return { ...base, top: -16, left: '50%', transform: 'translateX(-50%)', borderBottomColor: '#1e1e2e' };
    case 'top':
      return { ...base, bottom: -16, left: '50%', transform: 'translateX(-50%)', borderTopColor: '#1e1e2e' };
    case 'right':
      return { ...base, left: -16, top: '50%', transform: 'translateY(-50%)', borderRightColor: '#1e1e2e' };
    case 'left':
      return { ...base, right: -16, top: '50%', transform: 'translateY(-50%)', borderLeftColor: '#1e1e2e' };
  }
}

export default function TourGuide() {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});
  const tooltipRef = useRef<HTMLDivElement>(null);

  const startTour = useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  const stopTour = useCallback(() => {
    setActive(false);
    localStorage.setItem(STORAGE_KEY, 'true');
  }, []);

  // Auto-start on first visit
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasCompletedTour()) {
        startTour();
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [startTour]);

  // Position tooltip
  useEffect(() => {
    if (!active) return;

    const updatePosition = () => {
      const step = steps[stepIndex];
      const target = document.querySelector(step.target);
      if (!target || !tooltipRef.current) return;

      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const tw = tooltipRect.width || 300;
      const th = tooltipRect.height || 140;

      setTooltipStyle(getPlacementStyle(step.placement, targetRect, tw, th));
      setArrowStyle(getArrowStyle(step.placement));

      // Highlight target
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [active, stepIndex]);

  const handleNext = () => {
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      stopTour();
    }
  };

  const handlePrev = () => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  if (!active) return null;

  const step = steps[stepIndex];

  return (
    <>
      {/* Overlay */}
      <div className="tour-overlay" onClick={stopTour} />

      {/* Tooltip */}
      <div className="tour-tooltip" ref={tooltipRef} style={tooltipStyle}>
        <div className="tour-arrow" style={arrowStyle} />
        <div className="tour-tooltip-header">
          <span className="tour-step-counter">
            {stepIndex + 1} / {steps.length}
          </span>
          <button className="tour-close-btn" onClick={stopTour}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="tour-tooltip-title">{step.title}</div>
        <div className="tour-tooltip-content">{step.content}</div>
        <div className="tour-tooltip-footer">
          <button className="tour-btn tour-btn-skip" onClick={stopTour}>
            Skip
          </button>
          <div className="tour-dots">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`tour-dot ${i === stepIndex ? 'active' : ''}`}
              />
            ))}
          </div>
          <div className="tour-nav-btns">
            {stepIndex > 0 && (
              <button className="tour-btn tour-btn-prev" onClick={handlePrev}>
                Back
              </button>
            )}
            <button className="tour-btn tour-btn-next" onClick={handleNext}>
              {stepIndex === steps.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}