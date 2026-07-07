'use client';

import dynamic from 'next/dynamic';

const PortalDashboard = dynamic(() => import('../modules/dashboard/PortalDashboard'), {
  ssr: false,
});

export default function Home() {
  return <PortalDashboard />;
}
