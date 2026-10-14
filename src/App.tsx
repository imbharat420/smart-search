import type { CSSProperties } from 'react'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from './components/layout/AppShell'

// Each page is its own chunk, loaded only when its route is visited — the
// previous static imports put every page (including Admin's charts and
// tables) in the one bundle everyone pays for on first load.
const Landing = lazy(() => import('./pages/Landing').then((m) => ({ default: m.Landing })))
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })))
const Inspiration = lazy(() =>
  import('./pages/Inspiration').then((m) => ({ default: m.Inspiration })),
)
const Discover = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Discover })))
const TripDetail = lazy(() =>
  import('./pages/TripDetail').then((m) => ({ default: m.TripDetail })),
)
const Assistant = lazy(() => import('./pages/Assistant').then((m) => ({ default: m.Assistant })))
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })))
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="h-screen w-full animate-pulse bg-accent" />}>
        <Routes>
          {/* Landing is the full-bleed marketing page, so it renders without the rail. */}
          <Route path="/" element={<Landing />} />
          <Route element={<AppShell />}>
            <Route path="/search" element={<Search />} />
            <Route path="/inspiration" element={<Inspiration />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/trip/:slug" element={<TripDetail />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>

      {/* sonner injects its stylesheet after ours, so the colours go through its own
          variables; classNames only carry type and shape. */}
      <Toaster
        position="bottom-right"
        richColors={false}
        style={
          {
            '--normal-bg': 'var(--card)',
            '--normal-text': 'var(--foreground)',
            '--normal-border': 'var(--border)',
            '--border-radius': 'var(--radius)',
          } as CSSProperties
        }
        toastOptions={{
          classNames: {
            title: 'text-sm font-semibold tracking-tight',
            description: 'text-sm text-muted-foreground',
            actionButton: 'font-semibold',
            cancelButton: 'font-medium',
          },
        }}
      />
    </BrowserRouter>
  )
}
