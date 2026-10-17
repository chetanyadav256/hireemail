import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 5000,
  headers: { Accept: 'application/json' },
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    if (
      error.response?.status === 401 &&
      !url.endsWith('/auth/login') &&
      !url.endsWith('/auth/register') &&
      !url.endsWith('/auth/me')
    ) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    return Promise.reject(error);
  },
);

export function getApiErrorMessage(error) {
  if (error.response?.status === 503) return 'The API is running, but its database is not ready.';
  if (error.code === 'ECONNABORTED') return 'The connection timed out. Try again in a moment.';
  if (error.response?.data?.error?.message) return error.response.data.error.message;
  return 'Unable to reach the API. Start the server and try again.';
}
