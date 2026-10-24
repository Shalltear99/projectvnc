import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Button } from './Button';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

export interface AuthFormProps {
  mode: 'login' | 'register';
}

interface FieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (email.trim() === '') {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (password === '') {
    errors.password = 'Password is required.';
  } else if (password.length < 8) {
    errors.password = 'Use at least 8 characters.';
  }
  return errors;
}

export function AuthForm({ mode }: AuthFormProps): JSX.Element {
  const router = useRouter();
  const { login, register } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === 'login';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate(email, password);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }
      const nextParam = router.query.next;
      const target = typeof nextParam === 'string' && nextParam.startsWith('/') ? nextParam : '/dashboard';
      await router.replace(target);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(
          caught.isNetworkError
            ? 'Cannot reach the control plane. Check that the API is running and try again.'
            : caught.message,
        );
      } else {
        setFormError(caught instanceof Error ? caught.message : 'Something went wrong.');
      }
      setSubmitting(false);
    }
    // On success the component unmounts with the redirect; leaving `submitting`
    // true keeps the button disabled so a double submit cannot race the cookie.
  };

  return (
    // method="post" is a deliberate hardening, not a styling detail: if the user
    // submits before React hydrates (slow connection, big bundle, Enter key), the
    // browser performs a NATIVE submit. With the default GET that would put the
    // password into the URL, the address bar and browser history. A native POST
    // puts it in the request body, where it belongs, and the handler above
    // intercepts it normally once hydration is done.
    <form
      method="post"
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          disabled={submitting}
          className={['field', errors.email ? 'field-invalid' : ''].join(' ')}
          placeholder="you@example.com"
        />
        {errors.email ? (
          <p id="email-error" className="mt-1.5 text-xs text-status-bad">
            {errors.email}
          </p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'password-error' : 'password-hint'}
          disabled={submitting}
          className={['field', errors.password ? 'field-invalid' : ''].join(' ')}
          placeholder={isLogin ? 'Your password' : 'At least 8 characters'}
        />
        {errors.password ? (
          <p id="password-error" className="mt-1.5 text-xs text-status-bad">
            {errors.password}
          </p>
        ) : (
          <p id="password-hint" className="hint">
            {isLogin ? 'Session cookie is httpOnly and scoped to the API.' : 'Minimum 8 characters.'}
          </p>
        )}
      </div>

      {formError ? (
        <div
          role="alert"
          className="rounded-lg border border-status-bad/30 bg-status-bad/10 px-3 py-2 text-[13px] text-status-bad"
        >
          {formError}
        </div>
      ) : null}

      <Button type="submit" variant="primary" block loading={submitting} disabled={submitting}>
        {submitting ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign in' : 'Create account'}
      </Button>

      <p className="pt-1 text-center text-[13px] text-slate-500">
        {isLogin ? (
          <>
            No account yet?{' '}
            <Link href="/register" className="text-accent underline decoration-accent/40 underline-offset-2">
              Create one
            </Link>
          </>
        ) : (
          <>
            Already registered?{' '}
            <Link href="/login" className="text-accent underline decoration-accent/40 underline-offset-2">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
