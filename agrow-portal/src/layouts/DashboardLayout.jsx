import { Outlet, Link } from 'react-router-dom'

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

                <Link to="/app/dashboard" style={{ textDecoration: 'none' }} >Dashboard</Link>
                <Link to="/app/heatmap-analysis" style={{ textDecoration: 'none' }} >Heatmap Analysis</Link>
                <Link to="/app/ai-predictions" style={{ textDecoration: 'none' }} >AI Predictions</Link>
                <Link to="/app/crop-statistics" style={{ textDecoration: 'none' }} >Crop Statistics</Link>

                <hr style={{ border: 'none', borderTop: '1px solid #ccc', margin: '20px 0' }} />

                <Link to="/" style={{ textDecoration: 'none' }}>Back to Landing</Link>
            </aside>

            <main style={{ flex: 1, padding: '40px', backgroundColor: '#fafafa', overflowY: 'auto' }}>
                <Outlet />
            </main>

        </div>
    )
}
