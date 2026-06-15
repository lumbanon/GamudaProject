import { Link } from 'react-router-dom'

export default function LandingPage(){
    return(
        <div>
            <h1>this is landing page</h1>
            <Link to="/dashboard" style={{ textDecoration: 'none' }}><span>go to portal</span></Link>
        </div>
    )
}