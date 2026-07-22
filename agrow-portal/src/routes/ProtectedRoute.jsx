import { useState } from 'react'
import {Navigate, Outlet} from 'react-router-dom'

export default function ProtectedRoute(){
    const [isValid] = useState(() => {
        const token = sessionStorage.getItem('token')
        const expiry = sessionStorage.getItem('token_expiry')

        if (!token || !expiry) {
            sessionStorage.clear()
            return false
        }

        const isExpired = Date.now() > parseInt(expiry, 10)
        if (isExpired) {
            sessionStorage.clear()
            return false
        }

        return true
    })

    if (!isValid) {
        return <Navigate to='/' replace />
    }

    return <Outlet/>
}
