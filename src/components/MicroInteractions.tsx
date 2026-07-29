import {
  Children,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";

type CommonProps = {
  children: ReactNode;
  className?: string;
};

export function FadeContent({
  children,
  className = "",
  delay = 0,
}: CommonProps & { delay?: number }) {
  return (
    <div
      className={`motion-fade-content ${className}`.trim()}
      style={{ "--motion-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function AnimatedList({
  children,
  className = "",
}: CommonProps) {
  return (
    <div className={`motion-list ${className}`.trim()}>
      {Children.map(children, (child, index) => (
        <div
          className="motion-list-item"
          style={
            {
              "--motion-index": Math.min(index, 8),
            } as CSSProperties
          }
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export function SpotlightSurface({
  children,
  className = "",
}: CommonProps) {
  const updateSpotlight = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    target.style.setProperty(
      "--spotlight-x",
      `${event.clientX - bounds.left}px`,
    );
    target.style.setProperty(
      "--spotlight-y",
      `${event.clientY - bounds.top}px`,
    );
    target.style.setProperty("--spotlight-opacity", "1");
  };

  const hideSpotlight = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty("--spotlight-opacity", "0");
  };

  return (
    <div
      className={`motion-spotlight ${className}`.trim()}
      onPointerMove={updateSpotlight}
      onPointerLeave={hideSpotlight}
    >
      {children}
    </div>
  );
}

export function ShinyStatus({
  children,
  className = "",
}: CommonProps) {
  return (
    <span className={`motion-shiny-status ${className}`.trim()}>
      {children}
    </span>
  );
}
