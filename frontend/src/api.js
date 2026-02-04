import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

let isRefreshing = false;
let failedQueue = [];
let onAccessTokenRefreshed = null;
let onSessionExpired = null;

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (err) {
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        
        localStorage.setItem('token', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        
        processQueue(null, data.accessToken);
        
        if (onAccessTokenRefreshed) {
          onAccessTokenRefreshed(data.accessToken);
        }
        
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        if (onSessionExpired) {
          onSessionExpired();
        }
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('userMeta');
        const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
        if (isAdminRoute) {
          window.location.href = '/admin';
        } else {
          window.location.href = '/';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export const logout = () => {
  const refreshToken = localStorage.getItem('refreshToken');
  if (refreshToken) {
    axios.post('/api/auth/logout', { refreshToken }).catch(() => {});
  }
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('userMeta');
  if (typeof window !== 'undefined') {
    const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
    if (isAdminRoute) {
      window.location.href = '/admin';
    } else {
      window.location.href = '/';
    }
  }
};

export const setTokenRefreshCallback = (callback) => {
  onAccessTokenRefreshed = callback;
};

export const setSessionExpiredCallback = (callback) => {
  onSessionExpired = callback;
};

export default api;
