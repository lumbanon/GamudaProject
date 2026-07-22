const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export async function getCurrentUser({ signal } = {}) {
  const user = await apiRequest('/api/v1/auth/me', { signal })
  return fromApiUser(user)
}

export async function updateCurrentUser({ fullName, email }) {
  const user = await apiRequest('/api/v1/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
    }),
  })

  sessionStorage.setItem('token', user.access_token)
  sessionStorage.setItem('user_role', user.role || '')
  sessionStorage.setItem('user_email', user.email || '')

  return fromApiUser(user)
}

export async function changeCurrentUserPassword({
  currentPassword,
  newPassword,
}) {
  return apiRequest('/api/v1/auth/me/password', {
    method: 'PATCH',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
}

export async function deleteCurrentUser() {
  await apiRequest('/api/v1/auth/me', { method: 'DELETE' })
}

function fromApiUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
  }
}

async function apiRequest(path, options = {}) {
  const token = sessionStorage.getItem('token')
  let response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (requestError) {
    if (requestError.name === 'AbortError') throw requestError
    throw new Error(
      'Unable to reach the Agrow service. Check your connection and try again.',
      { cause: requestError },
    )
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Your session has expired. Please sign in again.')
    }

    if (typeof payload?.detail === 'string') {
      throw new Error(payload.detail)
    }

    if (Array.isArray(payload?.detail)) {
      const validationMessage = payload.detail
        .map((error) => error?.msg)
        .filter(Boolean)
        .join(' ')

      if (validationMessage) throw new Error(validationMessage)
    }

    throw new Error('Unable to complete the account request.')
  }

  return payload
}
