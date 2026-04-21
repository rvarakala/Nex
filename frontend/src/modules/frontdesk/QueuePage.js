import React from 'react';
import DashboardPage from './DashboardPage';

// Queue page is a focused view of the dashboard's queue table.
// Reuses the DashboardPage for now — the queue is the most important chunk and already rendered there.
// Can be split into its own richer view (bulk actions, filters) in Sprint M01.B.
export default function QueuePage() {
  return <DashboardPage />;
}
