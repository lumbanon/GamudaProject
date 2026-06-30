import { useEffect, useState } from "react";
import {
  Outlet,
  Link,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import "./dashboard-layout.css";
import agrowLogo from "../assets/landing/agrow.svg";
import exitPortalLogo from "../assets/exit-logo/exit-portal-logo.png";
import { auth, db, isFirebaseConfigured } from "../features/auth/firebase";

const ROLE_LABELS = {
  admin: "Admin",
  free: "Free User",
  paid: "Paid User",
};

const normalizeRole = (role) => {
  const normalizedRole = String(role || "free").toLowerCase();
  return ROLE_LABELS[normalizedRole] ? normalizedRole : "free";
};

const getProfileName = (profile, user) =>
  profile?.displayName ||
  profile?.username ||
  profile?.fullName ||
  profile?.full_name ||
  profile?.name ||
  user?.displayName ||
  user?.email ||
  "Agrow User";

export default function DashboardLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [userName, setUserName] = useState("");

  const { pathname } = useLocation();

  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !db) {
      setUserRole("free");
      setUserName("Agrow User");
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserRole("free");
        setUserName("Agrow User");
        return;
      }

      try {
        const userSnapshot = await getDoc(doc(db, "users", user.uid));
        const profile = userSnapshot.data();
        setUserRole(normalizeRole(profile?.role));
        setUserName(getProfileName(profile, user));
      } catch (err) {
        setUserRole("free");
        setUserName(getProfileName(null, user));
      }
    });

    return unsubscribe;
  }, []);

  const getHeaderTitle = () => {
    const normalizedPath = pathname.replace(/\/$/, "");

    switch (normalizedPath) {
      case "/dashboard/heatmap-analysis":
        return "Heatmap Analysis";
      case "/dashboard/ai-predictions":
        return "AI Predictions";
      case "/dashboard/crop-statistics":
        return "Crop Statistics";
      case "/dashboard/settings":
        return "Settings";
      default:
        return "Dashboard";
    }
  };

  const isRegionalPage = pathname !== "/dashboard/settings";

  const navItems = [
    {
      to: "/dashboard",
      title: "Dashboard",
      subtitle: "GIS overview",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 3h8v10H3zm0 12h8v6H3zm10-12h8v6h-8zm0 8h8v10h-8z" />
        </svg>
      ),
    },
    {
      to: "/dashboard/heatmap-analysis",
      title: "Heatmap Analysis",
      subtitle: "Land suitability",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 11h3v10H4zm6-7h3v17h-3zm6 10h3v7h-3z" />
        </svg>
      ),
    },
    {
      to: "/dashboard/ai-predictions",
      title: "AI Predictions",
      subtitle: "Intelligent advisor",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="M12 6v12M6 12h12" />
        </svg>
      ),
    },
    {
      to: "/dashboard/crop-statistics",
      title: "Crop Statistics",
      subtitle: "Yield reference metrics",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M7 14l3-3 4 4 4-4" />
        </svg>
      ),
    },
    {
      to: "/dashboard/settings",
      title: "Settings",
      subtitle: "Model parameters",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  const navigate = useNavigate();

  const handleLogout = (e) => {
    e.preventDefault();

    localStorage.removeItem("token");
    localStorage.removeItem("firebase_uid");
    localStorage.removeItem("user_role");
    localStorage.removeItem("email_verified");

    navigate("/");
  };

  return (
    <div
      className={`layout-container ${isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}
    >
      <aside className="sidebar-panel">
        <div className="sidebar-top-row">
          <Link to="/" className="portal-branding" aria-label="Agrow homepage">
            <img src={agrowLogo} alt="Agrow" />
          </Link>

          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarOpen((current) => !current)}
            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={isSidebarOpen}
          >
            {isSidebarOpen ? "\u2190" : "\u2192"}
          </button>
        </div>

        <nav className="stacked-nav-container">
          {navItems.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/dashboard"}
              className={({ isActive }) =>
                isActive ? "stack-link active" : "stack-link"
              }
              style={{ zIndex: index }}
            >
              <div className="stack-icon-wrapper">{item.icon}</div>
              <div className="stack-text-wrapper">
                <span className="stack-title">{item.title}</span>
                <span className="stack-subtitle">{item.subtitle}</span>
              </div>
            </NavLink>
          ))}
        </nav>

        {userRole && (
          <div className="sidebar-user-footer">
            <div className="user-avatar">
              {userName.charAt(0).toUpperCase()}
            </div>

            <div className="user-info-wrapper">
              <span className="user-name">{userName}</span>
              <span className="user-role">{ROLE_LABELS[userRole]}</span>
            </div>
          </div>
        )}
      </aside>

      <div className="main-content-wrapper">
        <header className="header-panel">
          <div className="header-context-group">
            <span className="header-status">{getHeaderTitle()}</span>
            {isRegionalPage && (
              <span className="badge badge-success">Sabah Region</span>
            )}
          </div>
          <Link to="/" className="exit-portal-btn" onClick={handleLogout}>
            <img src={exitPortalLogo} alt="" aria-hidden="true" />
            <span>Exit Portal</span>
          </Link>
        </header>
        <main className="dynamic-content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
