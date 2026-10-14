import { useEffect, useState } from 'react'
import { Check, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import type { ChatSessionMeta } from '../../types'
import { cn } from '../../lib/utils'

interface ChatHistoryPanelProps {
  open: boolean
  sessions: ChatSessionMeta[]
  activeId: string
  busy: boolean
  onClose: () => void
  onSelect: (sessionId: string) => void
  onNew: () => void
  onPin: (sessionId: string, pinned: boolean) => void
  onRename: (sessionId: string, title: string) => void
  onDelete: (sessionId: string) => void
}

// "2m ago" / "3h ago" / "Yesterday" / a date — enough to scan the list by, and
// deliberately coarse: the exact minute of a chat from last week helps nobody.
function since(iso?: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * The conversation drawer: every stored chat, searchable, pinned ones first.
 *
 * An overlay rather than a third column because the Assistant screen is already
 * a two-column grid — thread and discovery rails — and the list is something you
 * open, pick from and leave, not something to read alongside the chat.
 *
 * Delete asks twice in place (the icon becomes a red check for a few seconds)
 * instead of a modal: it is one small row, and window.confirm would be the only
 * browser dialog in the whole app.
 */
export function ChatHistoryPanel({
  open,
  sessions,
  activeId,
  busy,
  onClose,
  onSelect,
  onNew,
  onPin,
  onRename,
  onDelete,
}: ChatHistoryPanelProps) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  // A closed drawer drops its transient states so it reopens clean.
  useEffect(() => {
    if (open) return
    setQuery('')
    setEditing(null)
    setConfirming(null)
  }, [open])

  // The delete confirmation un-arms itself: a tap that was a mis-tap should not
  // leave a live red button waiting under the thumb a minute later.
  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(null), 4000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? sessions.filter((s) => (s.title ?? '').toLowerCase().includes(needle))
    : sessions
  const pinned = visible.filter((s) => s.pinned)
  const recent = visible.filter((s) => !s.pinned)

  function commitRename(id: string) {
    const title = draftTitle.trim()
    setEditing(null)
    if (title) onRename(id, title)
  }

  function row(session: ChatSessionMeta) {
    const id = session.sessionId
    const active = id === activeId
    const isEditing = editing === id

    return (
      <li key={id} className="group relative">
        {isEditing ? (
          <div className="flex items-center gap-1 rounded-lg border bg-card px-2 py-1.5">
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename(id)
                if (event.key === 'Escape') setEditing(null)
              }}
              maxLength={120}
              className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              aria-label="Chat name"
            />
            <button
              type="button"
              onClick={() => commitRename(id)}
              aria-label="Save name"
              className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Check className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSelect(id)}
              className={cn(
                'w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60',
                active && 'bg-accent',
              )}
            >
              <span className="block truncate pr-16 text-sm font-medium">
                {session.title || 'Untitled chat'}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {[since(session.updatedAt), session.turnCount ? `${session.turnCount} turns` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>

            {/* Row actions surface on hover/focus; pinned state stays visible. */}
            <span
              className={cn(
                'absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-background/80 opacity-0 backdrop-blur transition-opacity focus-within:opacity-100 group-hover:opacity-100',
                session.pinned && 'opacity-100',
              )}
            >
              <button
                type="button"
                onClick={() => onPin(id, !session.pinned)}
                title={session.pinned ? 'Unpin' : 'Pin'}
                aria-label={session.pinned ? 'Unpin chat' : 'Pin chat'}
                className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
              >
                {session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(id)
                  setDraftTitle(session.title ?? '')
                }}
                title="Rename"
                aria-label="Rename chat"
                className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirming === id) {
                    setConfirming(null)
                    onDelete(id)
                  } else {
                    setConfirming(id)
                  }
                }}
                title={confirming === id ? 'Tap again to delete' : 'Delete'}
                aria-label={confirming === id ? 'Confirm delete chat' : 'Delete chat'}
                className={cn(
                  'cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground',
                  confirming === id && 'bg-red-600/10 text-red-600 hover:text-red-600',
                )}
              >
                {confirming === id ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
              </button>
            </span>
          </>
        )}
      </li>
    )
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Chat history">
      <button
        type="button"
        aria-label="Close chat history"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <aside className="animate-rise absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col gap-3 border-r bg-background p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Your chats</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <label className="flex items-center gap-2 rounded-full border bg-card px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
        </label>

        <button
          type="button"
          disabled={busy}
          onClick={onNew}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60"
        >
          <Plus className="size-4" aria-hidden="true" />
          New chat
        </button>

        <div className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">
          {visible.length === 0 ? (
            <p className="px-2.5 py-4 text-sm text-muted-foreground">
              {needle
                ? 'No chats match that search.'
                : 'Nothing here yet — conversations appear as soon as you ask something.'}
            </p>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <p className="px-2.5 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                    Pinned
                  </p>
                  <ul className="flex flex-col gap-0.5">{pinned.map(row)}</ul>
                </>
              )}
              <p className="px-2.5 pb-1 pt-2 text-xs font-semibold text-muted-foreground">Chats</p>
              <ul className="flex flex-col gap-0.5">{recent.map(row)}</ul>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
