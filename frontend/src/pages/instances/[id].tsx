import type { GetServerSideProps } from 'next';

/**
 * Legacy session URL.
 *
 * The workspace moved to /dashboard/vnc/[instanceId] when the UI was redesigned.
 * This route is kept as a permanent server-side redirect so existing bookmarks,
 * shared links and the browser history of anyone mid-session keep working
 * instead of 404ing.
 */
export default function LegacyInstanceRedirect(): null {
  return null;
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const id = context.params?.id;
  const instanceId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : null;

  if (!instanceId) {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }

  return {
    redirect: {
      destination: `/dashboard/vnc/${encodeURIComponent(instanceId)}`,
      permanent: false,
    },
  };
};
