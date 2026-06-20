import { Outlet, Link, NavLink, useLocation } from 'react-router-dom'
import './dashboard-layout.css'
import agrowLogo from '../assets/landing/agrow.svg'
import exitPortalLogo from '../assets/exit-logo/exit-portal-logo.png'

export default function DashboardLayout() {

    const { pathname } = useLocation();

    const getHeaderTitle = () => {

        const normalizedPath = pathname.replace(/\/$/, "")
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

    const navItems = [
        {
            to: "/dashboard",
            title: "Dashboard",
            subtitle: "GIS overview",
            icon: (
                <svg viewBox='0 0 24 24' fill='currentColor'>
                    <path d="M3 3h8v10H3zm0 12h8v6H3zm10-12h8v6h-8zm0 8h8v10h-8z" />
                </svg>
            )
        },
        {
            to: "/dashboard/heatmap-analysis",
            title: "Heatmap Analysis",
            subtitle: "Land suitability",
            icon: (
                <svg viewBox='0 0 24 24' fill='currentColor'>
                    <path d="M4 11h3v10H4zm6-7h3v17h-3zm6 10h3v7h-3z" />
                </svg>
            )
        },
        {
            to: "/dashboard/ai-predictions",
            title: "AI Predictions",
            subtitle: "Intelligent advisor",
            icon: (
                <svg viewBox='0 0 24 24' fill='currentColor'>
                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                    <path d="M12 6v12M6 12h12" />
                </svg>
            )
        },
        {
            to: "/dashboard/crop-statistics",
            title: "Crop Statistics",
            subtitle: "Yield reference metrics",
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M7 14l3-3 4 4 4-4" />
                </svg>
            )
        },
        {
            to: "/dashboard/settings",
            title: "Settings",
            subtitle: "Model parameters",
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            )
        },
    ]

    return (

        <div className="layout-container">
            <aside className="sidebar-panel">
                <div className="portal-branding" aria-label="Agrow">
                    <img src={agrowLogo} alt="Agrow" />
                </div>

                <nav className="stacked-nav-container">
                    {navItems.map((item, index) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === "/dashboard"}
                            className={({ isActive }) => isActive ? 'stack-link active' : 'stack-link'}
                            style={{ zIndex: index }}
                        >
                            <div className="stack-icon-wrapper">
                                {item.icon}
                            </div>
                            <div className="stack-text-wrapper">
                                <span className="stack-title">{item.title}</span>
                                <span className="stack-subtitle">{item.subtitle}</span>
                            </div>
                        </NavLink>
                    ))}
                </nav>

            </aside>

            <div className="main-content-wrapper">
                <header className="header-panel">
                    <div className="header-context-group">
                        <span className="header-status">{getHeaderTitle()}</span>
                        {isRegionalPage && (
                            <span className="badge badge-success">Sabah Region</span>
                        )}
                    </div>
                    <Link to="/" className="exit-portal-btn">
                        <img src={exitPortalLogo} alt="" aria-hidden="true" />
                        <span>Exit Portal</span>
                    </Link>
                </header>
                <main className="dynamic-content-area">
                    <Outlet />
                </main>
            </div>
        </div>


    )
}
