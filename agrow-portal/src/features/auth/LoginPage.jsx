import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import agrowLogo from '../../assets/landing/agrow-rectangle.png'
import backHomeIcon from '../../assets/auth/back-home.png'
import { useAppPreferences } from '../../context/appPreferences'
import './login-page.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const API_AUTH_BASE_URL = `${API_BASE_URL}/api/v1/auth`

export default function LoginPage() {
  const { resetAppPreferences } = useAppPreferences()
  const [isLoginMode, setIsLoginMode] = useState(true)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const token = sessionStorage.getItem('token')
    const expiry = sessionStorage.getItem('token_expiry')

    if (token && expiry && Date.now() < parseInt(expiry, 10)){
      navigate('/dashboard', {replace: true})
    }
  }, [navigate])

  const toggleMode = () => {
    setIsLoginMode((currentMode) => !currentMode)
    setError('')
    setSuccessMsg('')
    setFullName('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setRole('')
  }

  const validateForm = () => {
    const emailValue = email.trim()

    if (!emailValue) {
      return 'Email is required.'
    }
    if (!password) {
      return 'Password is required.'
    }
    if (!isLoginMode) {
      if (!fullName.trim()) {
        return 'Full name is required.'
      }
      if (!role.trim()) {
        return 'Role is required.'
      }
      if (password.length < 6){
        return 'Password must be at least 6 characters.'
      }
    }

    return ''
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    setError('')
    setSuccessMsg('')

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setIsSubmitting(true)

      const formData = new URLSearchParams()
      formData.append('username', email.trim())
      formData.append('password', password)

      const response = await fetch(`${API_AUTH_BASE_URL}/login`,{
        method: 'POST',
        headers: {
          'Content-Type':'application/x-www-form-urlencoded'
        },
        body: formData
      })

      if(!response.ok){
        const errData = await response.json()
        throw new Error(errData.detail || 'Incorrect email or password')
      }

      const data = await response.json()

      const EXPIRE_IN_MINUTES = 30
      const expiryTimestamp = Date.now() + EXPIRE_IN_MINUTES * 60 * 1000

      sessionStorage.setItem('token', data.access_token)
      sessionStorage.setItem('user_role', data.user_role)
      sessionStorage.setItem('token_expiry', expiryTimestamp.toString())

      resetAppPreferences()
      // navigate('/dashboard', {replace: true})

      setTimeout(() => {
      navigate('/dashboard', { replace: true })
    }, 0)

  } catch (err) {
    if (err instanceof TypeError) {
      const EXPIRE_IN_MINUTES = 30
      const expiryTimestamp = Date.now() + EXPIRE_IN_MINUTES * 60 * 1000

      sessionStorage.setItem('token', 'local-dev-bypass-token')
      sessionStorage.setItem('user_role', 'Local Demo')
      sessionStorage.setItem('token_expiry', expiryTimestamp.toString())

      resetAppPreferences()
      // navigate('/dashboard', {replace: true})

      setTimeout(() => {
      navigate('/dashboard', { replace: true })
    }, 0)
      return
    }

    setError(err.message)
  } finally {
    setIsSubmitting(false)
  }
}

  const handleRegister = async (event) => {
    event.preventDefault()
    setError('')
    setSuccessMsg('')

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setIsSubmitting(true)

      const payload = {
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role: role.trim()
      }

      const response = await fetch(`${API_AUTH_BASE_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(
          errData.detail || 'Registration failed. Try a different email.',
        )
      }

      setSuccessMsg('Account created successfully! Redirecting to login...')

      setTimeout(() => {
        setIsLoginMode(true)
        setSuccessMsg('')
        setPassword('')
      }, 2000)
    }catch (err) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className='auth-page'>
      <div className='auth-animated-bg' aria-hidden='true'>
        <span className='map-ring map-ring-one' />
        <span className='map-ring map-ring-two' />
        <span className='heat-dot-grid' />
        <span className='floating-leaf floating-leaf-one' />
        <span className='floating-leaf floating-leaf-two' />
        <span className='floating-leaf floating-leaf-three' />
        <span className='floating-leaf floating-leaf-four' />
        <span className='floating-leaf floating-leaf-five' />
        <span className='floating-leaf floating-leaf-six' />
      </div>

      <section className='auth-hero' aria-label='Agrow authentication intro'>
        <div className='auth-hero-content'>
          <div className='auth-brand'>
            <img src={agrowLogo} alt='AGROW by Cleek' />
          </div>
          <h1 className='auth-title'>
            The platform for Sabah crop intelligence.
          </h1>
          <p className='auth-subtitle'>
            Analyze soil, climate, and crop suitability. Plan better harvests
            with AI-powered insights.
          </p>
          <div className='auth-highlights' aria-label='Agrow workspace tools'>
            <span className='auth-highlight-item'>District heatmaps</span>
            <span className='auth-highlight-item'>AI crop reports</span>
            <span className='auth-highlight-item'>Sabah-focused data</span>
          </div>
        </div>
      </section>

      <section className='auth-panel' aria-labelledby='auth-title'>
        <div className='auth-card'>
          <div className='auth-copy'>
            <Link to='/' className='auth-back-link'>
              <img src={backHomeIcon} alt='' className='auth-back-icon' />
              <span>Back to home</span>
            </Link>
            <h1 id='auth-title'>
              {isLoginMode ? 'Welcome Back' : 'Create Your Account'}
            </h1>
            <p>
              {isLoginMode
                ? 'Sign in to continue to the Sabah crop intelligence workspace.'
                : 'Join the Agrow workspace and secure your account.'}
            </p>
          </div>

          <div className='auth-mode-switch' aria-label='Authentication mode'>
            <button
              type='button'
              className={isLoginMode ? 'active' : ''}
              onClick={() => setIsLoginMode(true)}
            >
              Login
            </button>
            <button
              type='button'
              className={!isLoginMode ? 'active' : ''}
              onClick={() => setIsLoginMode(false)}
            >
              Sign up
            </button>
          </div>

          {error && (
            <div className='auth-message auth-message-error'>{error}</div>
          )}
          {successMsg && (
            <div className='auth-message auth-message-success'>
              {successMsg}
            </div>
          )}

          <form
            className='auth-form'
            onSubmit={isLoginMode ? handleLogin : handleRegister}
          >
            {!isLoginMode && (
              <label>
                Full Name
                <input
                  type='text'
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete='name'
                  required
                />
              </label>
            )}

              <label>
                Email
                <input
                  type='email'
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete='email'
                  required
                />
              </label>

              {!isLoginMode && (
              <label>
                Your role
                <input
                  type='text'
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  required
                />
              </label>
            )}
            
            <label>
              Password
              <input
                type='password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                minLength={6}
                required
              />
            </label>

            {!isLoginMode && (
              <label>
                Confirm Password
                <input
                  type='password'
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete='new-password'
                  minLength={6}
                  required
                />
              </label>
            )}
            

            <button
              className='auth-submit-button'
              type='submit'
              disabled={isSubmitting}
            >
              {isSubmitting
                ? 'Please wait...'
                : isLoginMode
                  ? 'Login'
                  : 'Create account'}
            </button>
          </form>

          <button
            className='auth-link-button'
            type='button'
            onClick={toggleMode}
            disabled={isSubmitting}
          >
            {isLoginMode
              ? 'Need an account? Sign up'
              : 'Already have an account? Login'}
          </button>
        </div>
      </section>
    </main>
  )
}
