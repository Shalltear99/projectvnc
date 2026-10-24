import Document, { Head, Html, Main, NextScript } from 'next/document';
import type { DocumentContext } from 'next/document';

/** Dark-only product: the theme is declared here, not toggled at runtime. */
export default class MyDocument extends Document {
  static override async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx);
    return { ...initialProps };
  }

  override render(): JSX.Element {
    return (
      <Html lang="en" className="dark">
        <Head>
          <meta charSet="utf-8" />
          <meta name="theme-color" content="#0F172A" />
          <meta name="color-scheme" content="dark" />
          <meta
            name="description"
            content="CloudJava VNC — rent isolated Java desktops and play retro Java games in the browser."
          />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        </Head>
        <body className="bg-surface-base text-slate-200 antialiased">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
