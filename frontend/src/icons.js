import React from "react";

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function IconFiles(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2 3.5h5l1 1.5H14v8H2z" />
    </svg>
  );
}

export function IconSparkles(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

export function IconSettings(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.6 3.6l.85.85M11.55 11.55l.85.85M3.6 12.4l.85-.85M11.55 4.45l.85-.85" />
    </svg>
  );
}

export function IconPlay(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3.5l7 4.5-7 4.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStop(props) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconNewFile(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 2.5h6l2 2v9H3z" />
      <path d="M9 2.5v2h2M8 8h-3M8 10.5h-3" />
    </svg>
  );
}

export function IconRefresh(props) {
  return (
    <svg {...base} {...props}>
      <path d="M11.5 2.5A5 5 0 0 0 4 6.5M4.5 13.5A5 5 0 0 0 12 9.5" />
      <path d="M11.5 1v2h-2M4.5 15v-2h2" />
    </svg>
  );
}

export function IconChevronRight(props) {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3.5 1.5L7 5l-3.5 3.5" />
    </svg>
  );
}

export function IconChevronDown(props) {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M1.5 3.5L5 7l3.5-3.5" />
    </svg>
  );
}

export function IconFolder(props) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M2 4.5h5.2l1.3 1.5H14v7.5H2z" opacity="0.9" />
    </svg>
  );
}

export function IconMore(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="4" cy="8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
