import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"

export default function LoginPage() {

    const [isLoginMode, setIsLoginMode] = useState(true)

    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('')

    const [error, setError] = useState('')
    const [successMsg, setSuccessMsg] = useState('')

    const navigate = useNavigate()

    const toggleMode = () => {
        setIsLoginMode(!isLoginMode)
        setError('')
        setSuccessMsg('')
        setFullName('')
        setEmail('')
        setPassword('')
    }

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('')

        const formData = new URLSearchParams()
        formData.append('username', email)
        formData.append('password', password)

        try {
            const response = await fetch('http://127.0.0.1:8000/api/v1/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            })

            if (!response.ok) {
                const errData = await response.json()
                throw new Error(errData.detail ||'Incorrect email or password')
            }
            const data = await response.json()

            localStorage.setItem('token', data.access_token)
            localStorage.setItem('user_role', data.user_role)

            navigate('/dashboard')
        } catch (err) {
            setError(err.message)
        }
    }

    const handleRegister = async (e) => {
        e.preventDefault()
        setError('')
        setSuccessMsg('')

        const payload = {
            full_name : fullName, email: email, password: password, role: role
        }

        try {
            const response = await fetch('http://127.0.0.1:8000/api/v1/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            })

            if (!response.ok) {
                const errData = await response.json()
                throw new Error(errData.detail || 'Registration failed. Try a different email.')
            }

            setSuccessMsg('Account created successfully! Redirecting to login...')

            setTimeout(() => {
                setIsLoginMode(true)
                setSuccessMsg('')
                setPassword('')
            }, 2000)
        } catch (err) {
            setError(err.message)
        }
    }

    return (
        <div>
            <div style={{ maxWidth: '400px', margin: '50px auto', padding: '20px' }}>
            <Link to="/"><p>←back to home</p></Link>

            <h2>
                {isLoginMode ? 'Login' : 'Register' }
            </h2>

            <p>
                {isLoginMode ? 'Fill up login form' : 'Register now' }
            </p>

            {error && <div>{error}</div>}
            {successMsg && <div>{successMsg}</div>}

            {isLoginMode ? (
                <form onSubmit={handleLogin}>
                    <div>
                        <label>email</label>
                        <input type="email"
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        />
                    </div>
                    <div>
                        <label>password</label>
                        <input type="password"
                        value={password} 
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        />
                    </div>
                    <button type='submit'>Login</button>
                </form>
                
            ):(
                <form onSubmit={handleRegister}>
                    <div>
                        <label>Full name</label>
                        <input type="text"
                        value={fullName} 
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        />
                    </div>
                    <div>
                        <label>email</label>
                        <input type="email"
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        />
                    </div>
                    <div>
                    <div>
                        <label>Your role</label>
                        <input type="text"
                        value={role} 
                        onChange={(e) => setRole(e.target.value)}
                        required
                        />
                    </div>
                        <label>password</label>
                        <input type="password"
                        value={password} 
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        />
                    </div>
                    <button type='submit'>Register</button>
                </form>
            )}

            <div>
                <button onClick={toggleMode}>
                    {isLoginMode
                        ? 'click here to register'
                        : 'click here to login'
                    }
                </button>
            </div>

            </div>
        </div>
    )
}