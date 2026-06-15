import { Outlet, Link } from 'react-router-dom'
import './dashboard-layout.css'

export default function DashboardLayout() {
    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', fontFamily: 'sans-serif' }}>
            <aside style={{
                width: '250px',
                background: '#f0f4f1',
                borderRight: '2px solid #e0e6e1',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '15px',
            }}>
                <h2 style={{ margin: '0 0 20px 0', color: '#000000', }}>Agrow Portal</h2>

                <Link to="/dashboard" style={{ textDecoration: 'none' }} >Dashboard</Link>
                <Link to="/dashboard/heatmap-analysis" style={{ textDecoration: 'none' }} >Heatmap Analysis</Link>
                <Link to="/dashboard/ai-predictions" style={{ textDecoration: 'none' }} >AI Predictions</Link>
                <Link to="/dashboard/crop-statistics" style={{ textDecoration: 'none' }} >Crop Statistics</Link>
                <Link to="/dashboard/settings" style={{ textDecoration: 'none' }} >Setting</Link>

                <hr style={{ border: 'none', borderTop: '1px solid #ccc', margin: '20px 0' }} />
            </aside>

            <div className="main-content-wrapper">
                <header className="header-panel">
                    <span className="header-status">Current</span>
                    <div className="header-profile">
                        <Link to="/" style={{ textDecoration: 'none' }}><span>Exit portal</span></Link>
                    </div>
                </header>
                <main style={{ flex: 1, padding: '20px', backgroundColor: '#fafafa', overflowY: 'auto' }}>
                    <Outlet />
                </main>
            </div>


        </div>
    )
}
