import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import './dashboard-layout.css'
import agrowLogo from '../assets/landing/agrow.svg'
import exitPortalLogo from '../assets/exit-logo/exit-portal-logo.png'
import miniAgrowLogo from '../assets/sidebar/agrow-sidebar-toggle.png'
import { useAppPreferences } from '../context/appPreferences'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const API_AUTH_BASE_URL = `${API_BASE_URL}/api/v1/auth`

const ROLE_LABELS = {
  admin: 'Admin',
  free: 'Free User',
  paid: 'Paid User',
}

const NAVIGATION_ITEMS = [
  {
    to: '/dashboard',
    title: 'Dashboard',
    subtitle: 'GIS overview',
    icon: (
      <svg viewBox='0 0 24 24' fill='currentColor'>
        <path d='M3 3h8v10H3zm0 12h8v6H3zm10-12h8v6h-8zm0 8h8v10h-8z' />
      </svg>
    ),
  },
  {
    to: '/dashboard/heatmap-analysis',
    title: 'Heatmap Analysis',
    subtitle: 'Land suitability',
    icon: (
      <svg viewBox='0 0 24 24' fill='currentColor'>
        <path d='M4 11h3v10H4zm6-7h3v17h-3zm6 10h3v7h-3z' />
      </svg>
    ),
  },
  {
    to: '/dashboard/ai-predictions',
    title: 'AI Predictions',
    subtitle: 'Intelligent advisor',
    icon: (
      <svg viewBox='0 0 24 24' fill='currentColor'>
        <path d='M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z' />
        <path d='M12 6v12M6 12h12' />
      </svg>
    ),
  },
  {
    to: '/dashboard/crop-statistics',
    title: 'Crop Statistics',
    subtitle: 'Yield reference metrics',
    icon: (
      <svg
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      >
        <rect x='3' y='3' width='18' height='18' rx='2' />
        <path d='M7 14l3-3 4 4 4-4' />
      </svg>
    ),
  },
  {
    to: '/dashboard/settings',
    title: 'Settings',
    subtitle: 'Model parameters',
    icon: (
      <svg
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      >
        <circle cx='12' cy='12' r='3' />
        <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
      </svg>
    ),
  },
]

const formatRoleLabel = (role) => {
  const normalizedRole = String(role || 'free').trim().toLowerCase()

  if (ROLE_LABELS[normalizedRole]) {
    return ROLE_LABELS[normalizedRole]
  }

  return normalizedRole
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const getEmailInitial = (email) => {
  const trimmedEmail = String(email || '').trim()

  return trimmedEmail ? trimmedEmail.charAt(0).toUpperCase() : '?'
}

function NavigationLinks({ ariaLabel, onNavigate }) {
  return (
    <nav className='stacked-nav-container' aria-label={ariaLabel}>
      {NAVIGATION_ITEMS.map((item, index) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/dashboard'}
          className={({ isActive }) =>
            isActive ? 'stack-link active' : 'stack-link'
          }
          style={{ zIndex: index }}
          onClick={onNavigate}
        >
          <div className='stack-icon-wrapper'>{item.icon}</div>
          <div className='stack-text-wrapper'>
            <span className='stack-title'>{item.title}</span>
            <span className='stack-subtitle'>{item.subtitle}</span>
          </div>
        </NavLink>
      ))}
    </nav>
  )
}

function AccountRole({ userEmail, userRoleLabel }) {
  return (
    <div className='sidebar-user-footer' aria-label='Current user role'>
      <div className='user-avatar'>{getEmailInitial(userEmail)}</div>
      <div className='user-info-wrapper'>
        <span className='user-role-label'>Account Role</span>
        <span className='user-role'>{userRoleLabel}</span>
      </div>
    </div>
  )
}

function ExitPortalLink({ className = '', onLogout, onNavigate }) {
  const handleClick = (event) => {
    onNavigate?.()
    onLogout(event)
  }

  return (
    <Link
      to='/'
      className={`exit-portal-btn ${className}`.trim()}
      onClick={handleClick}
    >
      <img src={exitPortalLogo} alt='' aria-hidden='true' />
      <span>Exit Portal</span>
    </Link>
  )
}

function MobileHeader({ isOpen, menuButtonRef, onClose, onOpen }) {
  return (
    <header className='mobile-header'>
      <Link
        to='/dashboard'
        className='mobile-header-brand'
        aria-label='Agrow dashboard'
        onClick={onClose}
      >
        <img src={agrowLogo} alt='Agrow' />
      </Link>

      <button
        ref={menuButtonRef}
        type='button'
        className='mobile-menu-button'
        onClick={isOpen ? onClose : onOpen}
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isOpen}
        aria-controls='mobile-navigation-drawer'
      >
        <span className='hamburger-icon' aria-hidden='true'>
          <span />
          <span />
          <span />
        </span>
      </button>
    </header>
  )
}

function MobileNavigationDrawer({
  closeButtonRef,
  drawerRef,
  isOpen,
  onClose,
  onLogout,
  userEmail,
  userRoleLabel,
}) {
  return (
    <div
      className={`mobile-navigation-layer ${isOpen ? 'is-open' : ''}`}
      aria-hidden={!isOpen}
    >
      <div
        className='mobile-navigation-overlay'
        onClick={onClose}
        aria-hidden='true'
      />

      <aside
        ref={drawerRef}
        id='mobile-navigation-drawer'
        className='mobile-navigation-drawer'
        role='dialog'
        aria-modal={isOpen}
        aria-label='Mobile navigation'
        inert={!isOpen}
      >
        <div className='mobile-drawer-header'>
          <Link
            to='/dashboard'
            className='mobile-drawer-brand'
            aria-label='Agrow dashboard'
            onClick={onClose}
          >
            <img src={agrowLogo} alt='Agrow' />
          </Link>

          <button
            ref={closeButtonRef}
            type='button'
            className='mobile-menu-close-button'
            onClick={onClose}
            aria-label='Close navigation menu'
          >
            <svg viewBox='0 0 24 24' aria-hidden='true'>
              <path d='M6 6l12 12M18 6 6 18' />
            </svg>
          </button>
        </div>

        <div className='mobile-drawer-scroll'>
          <NavigationLinks
            ariaLabel='Mobile dashboard navigation'
            onNavigate={onClose}
          />

          <div className='mobile-drawer-footer'>
            <AccountRole
              userEmail={userEmail}
              userRoleLabel={userRoleLabel}
            />
            <ExitPortalLink
              className='mobile-exit-portal-btn'
              onLogout={onLogout}
              onNavigate={onClose}
            />
          </div>
        </div>
      </aside>
    </div>
  )
}

export default function DashboardLayout() {
  const { resetAppPreferences } = useAppPreferences()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [userRoleLabel, setUserRoleLabel] = useState(() =>
    formatRoleLabel(sessionStorage.getItem('user_role')),
  )
  const [userEmail, setUserEmail] = useState(
    () => sessionStorage.getItem('user_email') || '',
  )

  const { pathname } = useLocation()
  const menuButtonRef = useRef(null)
  const drawerRef = useRef(null)
  const closeButtonRef = useRef(null)
  const previousPathnameRef = useRef(pathname)

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false)
  }, [])

  const openMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(true)
  }, [])

  useEffect(() => {
    if (previousPathnameRef.current === pathname) {
      return undefined
    }

    previousPathnameRef.current = pathname
    const closeFrame = window.requestAnimationFrame(closeMobileMenu)

    return () => {
      window.cancelAnimationFrame(closeFrame)
    }
  }, [pathname, closeMobileMenu])

  useEffect(() => {
    const desktopMediaQuery = window.matchMedia('(min-width: 768px)')
    const handleDesktopViewport = (event) => {
      if (event.matches) {
        closeMobileMenu()
      }
    }

    if (desktopMediaQuery.addEventListener) {
      desktopMediaQuery.addEventListener('change', handleDesktopViewport)
    } else {
      desktopMediaQuery.addListener(handleDesktopViewport)
    }

    return () => {
      if (desktopMediaQuery.removeEventListener) {
        desktopMediaQuery.removeEventListener('change', handleDesktopViewport)
      } else {
        desktopMediaQuery.removeListener(handleDesktopViewport)
      }
    }
  }, [closeMobileMenu])

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return undefined
    }

    const previouslyFocusedElement = document.activeElement
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.body.classList.add('mobile-navigation-open')

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileMenu()
        return
      }

      if (event.key !== 'Tab' || !drawerRef.current) {
        return
      }

      const focusableElements = Array.from(
        drawerRef.current.querySelectorAll(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )

      if (focusableElements.length === 0) {
        event.preventDefault()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.classList.remove('mobile-navigation-open')

      if (
        previouslyFocusedElement instanceof HTMLElement &&
        previouslyFocusedElement.isConnected &&
        previouslyFocusedElement.getClientRects().length > 0
      ) {
        previouslyFocusedElement.focus()
      }
    }
  }, [isMobileMenuOpen, closeMobileMenu])

  useEffect(() => {
    const token = sessionStorage.getItem('token')

    if (!token) {
      return
    }

    fetch(`${API_AUTH_BASE_URL}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Unable to load user role')
        }

        return response.json()
      })
      .then((user) => {
        sessionStorage.setItem('user_role', user.role || 'free')
        sessionStorage.setItem('user_email', user.email || '')
        setUserEmail(user.email || '')
        setUserRoleLabel(formatRoleLabel(user.role))
      })
      .catch(() => {
        setUserRoleLabel(formatRoleLabel(sessionStorage.getItem('user_role')))
      })
  }, [])

  const getHeaderTitle = () => {
    const normalizedPath = pathname.replace(/\/$/, '')
    switch (normalizedPath) {
      case '/dashboard/heatmap-analysis':
        return 'Heatmap Analysis'
      case '/dashboard/ai-predictions':
        return 'AI Predictions'
      case '/dashboard/crop-statistics':
        return 'Crop Statistics'
      case '/dashboard/settings':
        return 'Settings'
      default:
        return 'Dashboard'
    }
  }

  const isRegionalPage = pathname !== '/dashboard/settings'


  const navigate = useNavigate()

  const handleLogout = (e) => {
    e.preventDefault()
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('user_role')
    sessionStorage.removeItem('user_email')
    sessionStorage.removeItem('token_expiry')
    resetAppPreferences()
    navigate('/')
  }

  return (
    <div
      className={`layout-container ${isSidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}
    >
      <aside className='sidebar-panel'>
        <div className='sidebar-top-row'>
          <Link to='/dashboard' className='portal-branding' aria-label='Agrow homepage'>
            <img src={isSidebarOpen ? agrowLogo : miniAgrowLogo} alt='Agrow' />
          </Link>

          <button
            type='button'
            className='sidebar-toggle-btn'
            onClick={() => setIsSidebarOpen((current) => !current)}
            aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={isSidebarOpen}
          >
            {isSidebarOpen ? '<' : '>'}
          </button>
        </div>

        <NavigationLinks ariaLabel='Dashboard navigation' />
        <AccountRole
          userEmail={userEmail}
          userRoleLabel={userRoleLabel}
        />
      </aside>

      <div className='main-content-wrapper'>
        <MobileHeader
          isOpen={isMobileMenuOpen}
          menuButtonRef={menuButtonRef}
          onClose={closeMobileMenu}
          onOpen={openMobileMenu}
        />

        <header className='header-panel'>
          <div className='header-context-group'>
            <span className='header-status'>{getHeaderTitle()}</span>
            {isRegionalPage && (
              <span className='badge badge-success'>Sabah Region</span>
            )}
          </div>
          <ExitPortalLink onLogout={handleLogout} />
        </header>
        <main className='dynamic-content-area'>
          <Outlet />
        </main>
      </div>

      <MobileNavigationDrawer
        closeButtonRef={closeButtonRef}
        drawerRef={drawerRef}
        isOpen={isMobileMenuOpen}
        onClose={closeMobileMenu}
        onLogout={handleLogout}
        userEmail={userEmail}
        userRoleLabel={userRoleLabel}
      />
    </div>
  )
}
