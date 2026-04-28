import { API_BASE } from '../config/api';

export function getToken(): string | null {
    return localStorage.getItem('auth_token');
}

export function setToken(token: string) {
    localStorage.setItem('auth_token', token);
}

export function removeToken() {
    localStorage.removeItem('auth_token');
}

export function isAuthenticated(): boolean {
    return !!getToken();
}

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    // Only set JSON Content-Type when there is a body (GET must not send application/json).
    const body = options.body;
    if (!headers.has('Content-Type') && body != null && !(body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers,
            credentials: 'include'
        });

        if (response.status === 401) {
            // Token expired or invalid
            removeToken();
            // Redirect to login if we are not already there
            if (window.location.pathname !== '/auth') {
                window.location.href = '/auth';
            }
        }

        return response;
    } catch (error) {
        console.error("[API ERROR]", error);
        throw error;
    }
}

export function getAuthHeaders(): Record<string, string> {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
