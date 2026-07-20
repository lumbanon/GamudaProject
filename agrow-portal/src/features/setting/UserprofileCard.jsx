import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  changeCurrentUserPassword,
  deleteCurrentUser,
  getCurrentUser,
  updateCurrentUser,
} from './settingsApi'
import eyeIcon from '../../assets/setting/eye.svg'
import eyeSlashIcon from '../../assets/setting/eye-slash.svg'
import './setting.css'

const ALLOWED_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'ymail.com',
])

export default function ProfileCard() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [visiblePasswords, setVisiblePasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isPasswordSaving, setIsPasswordSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadUser() {
      setIsLoading(true)
      setError('')

      try {
        const currentUser = await getCurrentUser({ signal: controller.signal })
        setUser(currentUser)
        setFullName(currentUser.fullName || '')
        setEmail(currentUser.email || '')
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Unable to load your account.')
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void loadUser()
    return () => controller.abort()
  }, [])

  function cancelEditing() {
    setFullName(user?.fullName || '')
    setEmail(user?.email || '')
    setIsEditing(false)
    setError('')
    setSuccess('')
  }

  function cancelPasswordChange() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setVisiblePasswords({ current: false, new: false, confirm: false })
    setIsChangingPassword(false)
    setError('')
    setSuccess('')
  }

  function togglePasswordVisibility(field) {
    setVisiblePasswords((currentVisibility) => ({
      ...currentVisibility,
      [field]: !currentVisibility[field],
    }))
  }

  async function handleSave(event) {
    event.preventDefault()
    if (isSaving) return

    const emailDomain = email.trim().toLowerCase().split('@').pop()
    if (!ALLOWED_EMAIL_DOMAINS.has(emailDomain)) {
      setError(
        'Use an email from Gmail, Hotmail, Outlook, Yahoo, iCloud, Live, or Proton.',
      )
      setSuccess('')
      return
    }

    setIsSaving(true)
    setError('')
    setSuccess('')

    try {
      const updatedUser = await updateCurrentUser({ fullName, email })
      setUser(updatedUser)
      setFullName(updatedUser.fullName || '')
      setEmail(updatedUser.email || '')
      setIsEditing(false)
      setSuccess('Account information updated.')
    } catch (requestError) {
      setError(requestError.message || 'Unable to update your account.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      'Delete your account permanently? This action cannot be undone.',
    )
    if (!confirmed) return

    setIsDeleting(true)
    setError('')
    setSuccess('')

    try {
      await deleteCurrentUser()
      localStorage.removeItem('token')
      localStorage.removeItem('user_role')
      localStorage.removeItem('user_email')
      navigate('/login', { replace: true })
    } catch (requestError) {
      setError(requestError.message || 'Unable to delete your account.')
      setIsDeleting(false)
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault()
    if (isPasswordSaving) return

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.')
      setSuccess('')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      setSuccess('')
      return
    }

    if (currentPassword === newPassword) {
      setError('New password must be different from your current password.')
      setSuccess('')
      return
    }

    setIsPasswordSaving(true)
    setError('')
    setSuccess('')

    try {
      await changeCurrentUserPassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setVisiblePasswords({ current: false, new: false, confirm: false })
      setIsChangingPassword(false)
      setSuccess('Password changed successfully.')
    } catch (requestError) {
      setError(requestError.message || 'Unable to change your password.')
    } finally {
      setIsPasswordSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className='settings-card profile-card' aria-busy='true'>
        <p className='profile-status'>Loading account...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className='settings-card profile-card'>
        <p className='profile-message profile-message-error' role='alert'>
          {error || 'Unable to load your account.'}
        </p>
      </div>
    )
  }

  return (
    <div className='settings-card profile-card'>
      <div className='profile-header'>
        <div className='profile-avatar' aria-hidden='true'>👤</div>
        <div>
          <h2 className='profile-name'>{user.fullName || 'Name unavailable'}</h2>
          <p className='profile-role'>{user.role || 'Role unavailable'}</p>
          <p className='profile-email'>{user.email || 'Email unavailable'}</p>
        </div>
      </div>

      <hr className='profile-divider' />

      {isEditing && (
        <form className='profile-edit-form' onSubmit={handleSave}>
          <label className='profile-field' htmlFor='profile-full-name'>
            Full name
            <input
              id='profile-full-name'
              type='text'
              value={fullName}
              maxLength={255}
              disabled={isSaving}
              required
              onChange={(event) => setFullName(event.target.value)}
            />
          </label>

          <label className='profile-field' htmlFor='profile-email'>
            Email
            <input
              id='profile-email'
              type='email'
              value={email}
              maxLength={320}
              disabled={isSaving}
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <div className='profile-form-actions'>
            <button
              className='btn-edit-profile'
              type='submit'
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save changes'}
            </button>
            <button
              className='btn-profile-secondary'
              type='button'
              disabled={isSaving}
              onClick={cancelEditing}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isChangingPassword && (
        <form className='profile-edit-form' onSubmit={handlePasswordChange}>
          <div className='profile-field'>
            <label htmlFor='current-password'>Current password</label>
            <div className='profile-password-input'>
              <input
                autoComplete='current-password'
                disabled={isPasswordSaving}
                id='current-password'
                maxLength={72}
                required
                type={visiblePasswords.current ? 'text' : 'password'}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <PasswordVisibilityButton
                isVisible={visiblePasswords.current}
                disabled={isPasswordSaving}
                onToggle={() => togglePasswordVisibility('current')}
              />
            </div>
          </div>

          <div className='profile-field'>
            <label htmlFor='new-password'>New password</label>
            <div className='profile-password-input'>
              <input
                aria-describedby='new-password-help'
                autoComplete='new-password'
                disabled={isPasswordSaving}
                id='new-password'
                maxLength={72}
                minLength={6}
                required
                type={visiblePasswords.new ? 'text' : 'password'}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <PasswordVisibilityButton
                isVisible={visiblePasswords.new}
                disabled={isPasswordSaving}
                onToggle={() => togglePasswordVisibility('new')}
              />
            </div>
          </div>
          <small className='profile-field-help' id='new-password-help'>
            Use at least 6 characters and choose a different password.
          </small>

          <div className='profile-field'>
            <label htmlFor='confirm-new-password'>Confirm new password</label>
            <div className='profile-password-input'>
              <input
                autoComplete='new-password'
                disabled={isPasswordSaving}
                id='confirm-new-password'
                maxLength={72}
                minLength={6}
                required
                type={visiblePasswords.confirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <PasswordVisibilityButton
                isVisible={visiblePasswords.confirm}
                disabled={isPasswordSaving}
                onToggle={() => togglePasswordVisibility('confirm')}
              />
            </div>
          </div>

          <div className='profile-form-actions'>
            <button
              className='btn-edit-profile'
              disabled={isPasswordSaving}
              type='submit'
            >
              {isPasswordSaving ? 'Changing...' : 'Change password'}
            </button>
            <button
              className='btn-profile-secondary'
              disabled={isPasswordSaving}
              type='button'
              onClick={cancelPasswordChange}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!isEditing && !isChangingPassword && (
        <div className='profile-account-actions'>
          <button
            className='btn-edit-profile'
            type='button'
            disabled={isDeleting}
            onClick={() => {
              setIsEditing(true)
              setError('')
              setSuccess('')
            }}
          >
            Edit Profile
          </button>
          <button
            className='btn-profile-secondary'
            type='button'
            disabled={isDeleting}
            onClick={() => {
              setIsChangingPassword(true)
              setError('')
              setSuccess('')
            }}
          >
            Change Password
          </button>
        </div>
      )}

      <button
        className='btn-delete-profile'
        type='button'
        disabled={isSaving || isPasswordSaving || isDeleting}
        onClick={handleDelete}
      >
        {isDeleting ? 'Deleting account...' : 'Delete Account'}
      </button>

      {error && (
        <p className='profile-message profile-message-error' role='alert'>
          {error}
        </p>
      )}
      {success && (
        <p className='profile-message profile-message-success' role='status'>
          {success}
        </p>
      )}
    </div>
  )
}

function PasswordVisibilityButton({ disabled, isVisible, onToggle }) {
  return (
    <button
      aria-label={isVisible ? 'Hide password' : 'Show password'}
      aria-pressed={isVisible}
      className='profile-password-toggle'
      disabled={disabled}
      type='button'
      onClick={onToggle}
    >
      <img
        alt=''
        aria-hidden='true'
        src={isVisible ? eyeSlashIcon : eyeIcon}
      />
    </button>
  )
}
