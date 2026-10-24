import { useEffect, useRef } from 'react';
import type { Clip } from '@gridcast/types';

declare global {
  interface Window {
    twttr?: { widgets?: { load: (el?: HTMLElement) => void } };
  }
}

let loading: Promise<void> | undefined;

/** X's own embed widget (PRD: clips are embedded, never re-hosted). Loaded on first use. */
function loadWidgets(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve();
  loading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return loading;
}

export function ClipEmbed({ clip }: { clip: Clip }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void loadWidgets().then(() => alive && ref.current && window.twttr?.widgets?.load(ref.current));
    return () => {
      alive = false;
    };
  }, [clip.url]);
  const url = clip.url.replace('://x.com/', '://twitter.com/');
  return (
    <div ref={ref} className="mt-2 overflow-hidden rounded-md" onClick={(e) => e.stopPropagation()}>
      <blockquote
        className="twitter-tweet"
        data-theme="dark"
        data-dnt="true"
        data-conversation="none"
      >
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline"
        >
          Watch the clip on X
        </a>
      </blockquote>
    </div>
  );
}
