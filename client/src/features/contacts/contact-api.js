import { useMemo } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../../lib/api.js';

export function useContactMutation() {
  const { user, getCsrfToken } = useAuth();
  return useMemo(() => {
    let token;
    return async (method, url, data) => {
      if (!user?.id) throw new Error('Sign in before changing contacts.');
      token ??= await getCsrfToken();
      try {
        return await api.request({
          method,
          url,
          data,
          timeout: 30000,
          headers: { 'X-CSRF-Token': token },
        });
      } catch (error) {
        if (error.response?.data?.error?.code === 'CSRF_INVALID') token = undefined;
        throw error;
      }
    };
  }, [getCsrfToken, user?.id]);
}
