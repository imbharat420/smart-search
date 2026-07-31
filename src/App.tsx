import type { CSSProperties } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from './components/layout/AppShell'
import { Landing } from './pages/Landing'
import { Search } from './pages/Search'
import { Inspiration } from './pages/Inspiration'
import { Discover } from './pages/Discover'
import { TripDetail } from './pages/TripDetail'
import { Assistant } from './pages/Assistant'
import { Admin } from './pages/Admin'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
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
