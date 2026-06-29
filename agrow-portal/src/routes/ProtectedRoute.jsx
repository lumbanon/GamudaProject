import {Navigate, Outlet} from 'react-router-dom'

export default function ProtectedRoute(){
    const token = localStorage.getItem('token')
    const emailVerified = localStorage.getItem('email_verified') === 'true'

    if(!token || !emailVerified) {
        return <Navigate to='/' replace/>
    }

    return <Outlet/>
}
