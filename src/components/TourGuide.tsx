import { useState, useEffect, useCallback, useRef } from 'react';
import { useI18nStore } from '../store/useI18nStore';
import { t } from '../i18n/translations';

const STORAGE_KEY = 'ssh-manager-tour-done';

interface TourStep {
  target: string;
  title: string;
  content: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

function getSteps(tr: (key: string) => string): TourStep[] {
  return [
    {
      target: '[data-tour="sidebar"]',
      title: tr('tour.step1Title'),
      content: tr('tour.step1Content'),
      placement: 'right',
    },
    {
      target: '[data-tour="new-connection"]',
      title: tr('tour.step2Title'),
      content: tr('tour.step2Content'),
      placement: 'bottom',
    },
    {
      target: '[data-tour="quick-connect"]',
      title: tr('tour.step3Title'),
      content: tr('tour.step3Content'),
      placement: 'bottom',
    },
    {
      target: '[data-tour="ai-toggle"]',
      title: tr('tour.step4Title'),
      content: tr('tour.step4Content'),
      placement: 'bottom',
    },
    {
      target: '[data-tour="terminal-area"]',
      title: tr('tour.step5Title'),
      content: tr('tour.step5Content'),
      placement: 'left',
    },
    {
      target: '[data-tour="ai-sidebar"]',
      title: tr('tour.step6Title'),
      content: tr('tour.step6Content'),
      placement: 'left',
    },
    {
      target: '[data-tour="sidebar-tree"]',
      title: tr('tour.step7Title'),
      content: tr('tour.step7Content'),
      placement: 'right',
    },
    {
      target: '[data-tour="import-export"]',
      title: tr('tour.step8Title'),
      content: tr('tour.step8Content'),
      placement: 'left',
    },
  ];
}

export function hasCompletedTour(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetTour() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('tour-restart'));
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
  const { lang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

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

  // Listen for manual restart from resetTour()
  useEffect(() => {
    const handleRestart = () => {
      startTour();
    };
    window.addEventListener('tour-restart', handleRestart);
    return () => window.removeEventListener('tour-restart', handleRestart);
  }, [startTour]);

  // Position tooltip
  useEffect(() => {
    if (!active) return;

    const updatePosition = () => {
      const step = getSteps(tr)[stepIndex];
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
    if (stepIndex < getSteps(tr).length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      stopTour();
    }
  };

  const handlePrev = () => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  if (!active) return null;

  const step = getSteps(tr)[stepIndex];

  return (
    <>
      {/* Overlay */}
      <div className="tour-overlay" onClick={stopTour} />

      {/* Tooltip */}
      <div className="tour-tooltip" ref={tooltipRef} style={tooltipStyle}>
        <div className="tour-arrow" style={arrowStyle} />
        <div className="tour-tooltip-header">
          <span className="tour-step-counter">
            {stepIndex + 1} / {getSteps(tr).length}
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
            {tr('tour.skip')}
          </button>
          <div className="tour-dots">
            {getSteps(tr).map((_, i) => (
              <div
                key={i}
                className={`tour-dot ${i === stepIndex ? 'active' : ''}`}
              />
            ))}
          </div>
          <div className="tour-nav-btns">
            {stepIndex > 0 && (
              <button className="tour-btn tour-btn-prev" onClick={handlePrev}>
                {tr('tour.back')}
              </button>
            )}
            <button className="tour-btn tour-btn-next" onClick={handleNext}>
              {stepIndex === getSteps(tr).length - 1 ? tr('tour.finish') : tr('tour.next')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}