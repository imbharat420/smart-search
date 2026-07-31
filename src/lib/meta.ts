import { useEffect } from 'react'

// Titles and descriptions are written on mount, which is enough for sharing and
// for the browser tab but not for crawlers that do not run JS. Real SSR (or
// prerendering the eight routes at build time) is the fix and is documented as
// roadmap in docs/scope-and-limitations.md rather than faked here.
export function usePageMeta(title: string, description?: string): void {
  useEffect(() => {
    document.title = title
    if (!description) return

    let tag = document.head.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!tag) {
      tag = document.createElement('meta')
      tag.name = 'description'
      document.head.appendChild(tag)
    }
    tag.content = description
  }, [title, description])
}
