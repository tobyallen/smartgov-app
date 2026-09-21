'use client';

import ReactMarkdown, { type Components } from 'react-markdown';

// Shared by both chat surfaces (citizen chat, admin chat) — the model's
// text parts are markdown (it reaches for "- item" lists on its own,
// unprompted, confirmed live on "list contractors"), but were being
// rendered as a bare <span>, so a real list came through as one flat
// line of literal hyphens. No @tailwindcss/typography plugin in this
// project (Tailwind 4, CSS-based config, checked before reaching for
// `prose` classes that would otherwise silently do nothing) — element
// styles are hand-rolled here instead, deliberately minimal: this is a
// chat bubble, not a document, so no headings/images/raw HTML support.
const components: Components = {
  p: ({ children }) => <p className="my-1">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
    </a>
  ),
};

export function ChatMessageText({ text }: { text: string }) {
  return <ReactMarkdown components={components}>{text}</ReactMarkdown>;
}
