import type { AppProps } from 'next/app';
import Head from 'next/head';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/Toast';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps): JSX.Element {
  return (
    <AuthProvider>
      <ToastProvider>
        <Head>
          <title>CloudJava VNC</title>
        </Head>
        <Component {...pageProps} />
      </ToastProvider>
    </AuthProvider>
  );
}
